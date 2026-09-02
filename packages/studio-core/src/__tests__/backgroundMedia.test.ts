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

// Stub-context run of the compiled ON_FRAME string (the browserBar.test.ts
// harness) extended with drawImage arg capture + a pre-seeded videoCache, so
// the background-media layer can be
// asserted: cover-fit rect math, dim scrim, draw order (under the card,
// outside the zoom transform), fail-open when not ready, output-anchored
// modulo seek, and byte-clean lowering when the field is absent.

interface StubBgVideo {
  videoWidth: number
  videoHeight: number
  readyState: number
  seeking?: boolean
  paused: boolean
  currentTime: number
  duration: number
  playbackRate: number
  play: () => void
  pause: () => void
  addEventListener: () => void
  removeEventListener: () => void
}

function bgVideoStub(over: Partial<StubBgVideo> = {}): StubBgVideo {
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
    ...over,
  }
}

function makeDoc(media?: BackgroundMedia | null): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [
        { t: 0, x: 100, y: 100, type: 'move' },
        { t: 500, x: 300, y: 300, type: 'down' },
      ],
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
    zoom: [{ id: 'z1', in: 0.5, out: 1.5, level: 1.6, cx: 0.5, cy: 0.5 }],
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

describe('background media', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function runFrame(
    media?: BackgroundMedia | null,
    opts: { cache?: Map<string, unknown>; time?: number } = {},
  ) {
    const { config, data } = lowerToComposition(makeDoc(media))
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void

    const cache = opts.cache ?? new Map<string, unknown>()
    g.window = {
      __vos__: { isPaused: true, videoCache: cache, pendingDecodes: new Set() },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const calls: string[] = []
    const drawImages: unknown[][] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'drawImage')
            return (...args: unknown[]) => {
              calls.push('drawImage')
              drawImages.push(args)
            }
          return (..._args: unknown[]) => {
            calls.push(key)
          }
        },
        set: (_t, key: string, v: unknown) => {
          if (key === 'fillStyle' && typeof v === 'string')
            calls.push('fillStyle:' + v)
          return true
        },
      },
    )
    const video = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      currentTime: 0.5,
      duration: 3,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const ctx = {
      time: opts.time ?? 0.5,
      data,
      renderer: undefined,
      resolution: {
        width: 1920,
        height: 1080,
        drawingBufferWidth: 1920,
        drawingBufferHeight: 1080,
      },
    }
    const content = {
      refs: {
        c2d,
        canvas: { width: 1920, height: 1080 },
        texture: { needsUpdate: false, dispose: () => undefined },
        video,
        cam: null,
      },
    }
    onFrame(ctx, content, 1 / 30)
    return { calls, drawImages, data }
  }

  it('lowers with no backgroundMedia key when the field is absent (byte parity)', () => {
    const { data } = lowerToComposition(makeDoc())
    expect('backgroundMedia' in (data.frame as Record<string, unknown>)).toBe(
      false,
    )
  })

  it('draws nothing extra when absent — one drawImage (the recording)', () => {
    const { drawImages } = runFrame()
    expect(drawImages.length).toBe(1)
  })

  it('cover-fits a ready video background under the card', () => {
    const el = bgVideoStub() // 800×800 into 1920×1080 → scale 2.4 → 1920×1920 at (0,−420)
    const { drawImages } = runFrame(
      { kind: 'video', key: 'bg.webm', duration: 10, dim: 0 },
      { cache: new Map([['bg.webm', el]]) },
    )
    expect(drawImages.length).toBe(2)
    const [bgEl, x, y, w, h] = drawImages[0]
    expect(bgEl).toBe(el)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(-420)
    expect(w).toBeCloseTo(1920)
    expect(h).toBeCloseTo(1920)
  })

  it('paints the dim scrim after the media draw', () => {
    const { calls } = runFrame(
      { kind: 'video', key: 'bg.webm', duration: 10, dim: 0.3 },
      { cache: new Map([['bg.webm', bgVideoStub()]]) },
    )
    const draw = calls.indexOf('drawImage')
    const scrim = calls.indexOf('fillStyle:rgba(0,0,0,0.3)')
    expect(scrim).toBeGreaterThan(draw)
    expect(calls[scrim + 1]).toBe('fillRect')
  })

  it('skips draw + scrim while the video is not decodable (fail-open to CSS fill)', () => {
    const { drawImages, calls } = runFrame(
      { kind: 'video', key: 'bg.webm', duration: 10, dim: 0.3 },
      { cache: new Map([['bg.webm', bgVideoStub({ readyState: 0 })]]) },
    )
    expect(drawImages.length).toBe(1) // only the recording
    expect(calls).not.toContain('fillStyle:rgba(0,0,0,0.3)')
  })

  it('seeks the paused background to OUTPUT time modulo the loop', () => {
    const el = bgVideoStub()
    runFrame(
      { kind: 'video', key: 'bg.webm', duration: 0.4, dim: 0 },
      { cache: new Map([['bg.webm', el]]), time: 0.5 },
    )
    expect(el.currentTime).toBeCloseTo(0.5 % 0.4, 5)
  })

  it('coalesces scrub seeks — never re-seeks while one is in flight', () => {
    // Re-assigning currentTime mid-seek ABORTS the in-flight seek; a scrub
    // doing that every frame keeps a remote source seeking for the whole drag
    // (background never decodes, pops in late). The sync must defer instead.
    const el = bgVideoStub({ seeking: true, currentTime: 3 })
    runFrame(
      { kind: 'video', key: 'bg.webm', duration: 10, dim: 0 },
      { cache: new Map([['bg.webm', el]]), time: 0.5 },
    )
    expect(el.currentTime).toBe(3) // untouched — corrected after 'seeked' fires
  })

  it('draws the background before (under) the card and outside the zoom transform', () => {
    const { calls } = runFrame(
      { kind: 'video', key: 'bg.webm', duration: 10, dim: 0 },
      { cache: new Map([['bg.webm', bgVideoStub()]]), time: 1.0 }, // mid-zoom-span
    )
    const bgDraw = calls.indexOf('drawImage')
    const zoomTranslate = calls.indexOf('translate')
    expect(zoomTranslate).toBeGreaterThan(-1) // zoom is active at t=1.0
    expect(bgDraw).toBeGreaterThan(-1)
    expect(bgDraw).toBeLessThan(zoomTranslate)
  })

  it('draws an image background (cover, no sync machinery)', () => {
    const img = { complete: true, naturalWidth: 3840, naturalHeight: 2160 }
    const { drawImages } = runFrame(
      { kind: 'image', key: 'bg.jpg', dim: 0 },
      { cache: new Map([['bg.jpg', img]]) },
    )
    expect(drawImages.length).toBe(2)
    const [bgEl, x, y, w, h] = drawImages[0]
    expect(bgEl).toBe(img)
    // 3840×2160 into 1920×1080 → scale 0.5 → exact cover
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(w).toBeCloseTo(1920)
    expect(h).toBeCloseTo(1080)
  })
})
