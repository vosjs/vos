import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { BackgroundMedia, ProjectDoc } from '../types'

// Compositor v2 perf posture: the background/overlay layer textures
// re-upload ONLY when they actually change, so the common case (static gradient,
// no cam) steady-states at the card texture alone. This pins the dirty-tracking:
// a static gradient uploads once, a video background uploads every frame, and a
// cam-less overlay stops uploading after the first frame.

interface TexStub {
  needsUpdate: boolean
  dispose: () => void
}
function tex(): TexStub {
  return { needsUpdate: false, dispose: () => undefined }
}

function makeDoc(media?: BackgroundMedia | null, withCam = false): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      camKey: withCam ? 'blob:cam' : undefined,
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 3000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      ...DEFAULT_FRAME_STYLE,
      browserBar: DEFAULT_BROWSER_BAR,
      ...(media !== undefined ? { backgroundMedia: media } : {}),
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('layer dirty-tracking (compositor v2 V0 perf)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  // A persistent-refs harness: one set of layer refs, driven across N frames so
  // the dirty state (bg.sig / ov.active) carries between frames like at runtime.
  function makeRunner(doc: ProjectDoc, cache = new Map<string, unknown>()) {
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = {
      __vos__: { isPaused: true, videoCache: cache, pendingDecodes: new Set() },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return () => {}
        },
        set: () => true,
      },
    )
    const bgTex = tex()
    const cardTex = tex()
    const ovTex = tex()
    const layer = (t: TexStub) => ({
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: t,
      mesh: null,
    })
    const camEl = {
      videoWidth: 640,
      videoHeight: 480,
      readyState: 2,
      paused: true,
      currentTime: 0,
      duration: 3,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const refs = {
      bg: layer(bgTex),
      card: layer(cardTex),
      ov: layer(ovTex),
      video: {
        videoWidth: 1600,
        videoHeight: 900,
        readyState: 2,
        paused: true,
        currentTime: 0,
        play() {},
        pause() {},
        addEventListener() {},
        removeEventListener() {},
      },
      cam: doc.source.camKey ? camEl : null,
    }
    return {
      bgTex,
      cardTex,
      ovTex,
      frame(time: number) {
        bgTex.needsUpdate = cardTex.needsUpdate = ovTex.needsUpdate = false
        const ctx = {
          time,
          data,
          renderer: undefined,
          resolution: {
            width: 1920,
            height: 1080,
            drawingBufferWidth: 1920,
            drawingBufferHeight: 1080,
          },
        }
        onFrame(ctx, { refs }, 1 / 30)
      },
    }
  }

  it('static gradient background uploads once, then never again', () => {
    const run = makeRunner(makeDoc())
    run.frame(0.5)
    expect(run.bgTex.needsUpdate).toBe(true) // first frame draws
    run.frame(0.6)
    expect(run.bgTex.needsUpdate).toBe(false) // unchanged → no re-upload
    run.frame(0.7)
    expect(run.bgTex.needsUpdate).toBe(false)
  })

  it('the card texture uploads every frame (dynamic content)', () => {
    const run = makeRunner(makeDoc())
    run.frame(0.5)
    expect(run.cardTex.needsUpdate).toBe(true)
    run.frame(0.6)
    expect(run.cardTex.needsUpdate).toBe(true)
  })

  function bgVideoEl() {
    return {
      videoWidth: 800,
      videoHeight: 800,
      readyState: 2,
      paused: true,
      currentTime: 0,
      duration: 10,
      playbackRate: 1,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
  }

  it('a video background uploads every frame (it advances)', () => {
    const el = bgVideoEl()
    const run = makeRunner(
      makeDoc({ kind: 'video', key: 'bg.webm', duration: 10, dim: 0 }),
      new Map([['bg.webm', el]]),
    )
    run.frame(0.5)
    expect(run.bgTex.needsUpdate).toBe(true)
    run.frame(0.6)
    expect(run.bgTex.needsUpdate).toBe(true) // ready media → dirty every frame
  })

  it('a seeking video background holds the last uploaded frame (scrub, no CSS flash)', () => {
    const el = bgVideoEl()
    const run = makeRunner(
      makeDoc({ kind: 'video', key: 'bg.webm', duration: 10, dim: 0 }),
      new Map([['bg.webm', el]]),
    )
    run.frame(0.5)
    expect(run.bgTex.needsUpdate).toBe(true) // ready → painted + uploaded
    el.readyState = 1 // scrub seek in flight — no decodable frame
    run.frame(0.6)
    expect(run.bgTex.needsUpdate).toBe(false) // repaint SKIPPED — texture holds the last frame
    el.readyState = 2 // seek landed
    run.frame(0.7)
    expect(run.bgTex.needsUpdate).toBe(true) // fresh frame → repaint resumes
  })

  it('a cam-less overlay stops uploading after the first frame', () => {
    const run = makeRunner(makeDoc())
    run.frame(0.5)
    expect(run.ovTex.needsUpdate).toBe(true) // first frame clears once
    run.frame(0.6)
    expect(run.ovTex.needsUpdate).toBe(false)
  })

  it('an active cam overlay uploads every frame', () => {
    const run = makeRunner(makeDoc(undefined, true))
    run.frame(0.5)
    run.frame(0.6)
    expect(run.ovTex.needsUpdate).toBe(true) // cam video → always dirty
  })
})
