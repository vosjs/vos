import { afterEach, describe, expect, it } from 'vitest'
import {
  lerpArray,
  mapTime,
  rateAt,
  sample,
  totalDuration,
} from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc, TextOverlayClip } from '../types'

/**
 * Past the footage's end, and inside a hold's freeze piece, the footage
 * element must stay PAUSED on its frame while the composition plays. An
 * ended element's play() rewinds it to zero and the drift guard then seeks
 * it back, which read as frames jumping back and forth on an end card; a
 * hold crawling at the clamped 1/16 speed toward that same end was the
 * same bug in slow motion. Stub-context run of the compiled interpreter,
 * the autoplayMute harness pattern.
 */
describe('ON_FRAME holds the footage element still past its footage', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  const title: TextOverlayClip = {
    id: 'endcard-title',
    kind: 'text',
    text: 'Ship it',
    preset: 'title',
    start: 2.5,
    duration: 3.5,
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  }

  function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
    return {
      source: {
        videoKey: 'blob:video',
        cursor: [],
        meta: {
          dpr: 1,
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
      frame: DEFAULT_FRAME_STYLE,
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
      ...over,
    }
  }

  interface VideoStub {
    paused: boolean
    playCalls: number
    currentTime: number
    duration: number
    [key: string]: unknown
  }

  function makeVideo(currentTime: number, paused: boolean): VideoStub {
    const video: VideoStub = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused,
      muted: true,
      volume: 1,
      currentTime,
      duration: 3,
      playbackRate: 1,
      preservesPitch: false,
      playCalls: 0,
      play() {
        video.playCalls++
        // An ended element's play() rewinds: the browser's behaviour.
        if (video.currentTime >= video.duration) video.currentTime = 0
        video.paused = false
        return Promise.resolve()
      },
      pause() {
        video.paused = true
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    return video
  }

  function runFrame(d: ProjectDoc, video: VideoStub, time: number): void {
    const { config, data } = lowerToComposition(d)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = { __vos__: { isPaused: false } }
    g.__vosTimeline = { mapTime, sample, lerpArray, rateAt, totalDuration }
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
    onFrame(
      {
        time,
        data,
        renderer: undefined,
        resolution: {
          width: 1920,
          height: 1080,
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
        },
      },
      {
        refs: {
          c2d,
          canvas: { width: 1920, height: 1080 },
          texture: { needsUpdate: false, dispose: () => undefined },
          video,
          cam: null,
        },
      },
      1 / 30,
    )
  }

  it('inside the footage a playing composition plays the element', () => {
    const video = makeVideo(1, true)
    runFrame(doc({ overlays: [title] }), video, 1)
    expect(video.playCalls).toBe(1)
    expect(video.paused).toBe(false)
  })

  it('past the footage the ended element stays paused on its last frame', () => {
    // The element reached its end and paused itself; the output goes on.
    const video = makeVideo(3, true)
    runFrame(doc({ overlays: [title] }), video, 4)
    expect(video.playCalls).toBe(0)
    expect(video.paused).toBe(true)
    expect(video.currentTime).toBe(3)
    // And one that was still playing is paused there, never restarted.
    const live = makeVideo(2.99, false)
    runFrame(doc({ overlays: [title] }), live, 3.2)
    expect(live.playCalls).toBe(0)
    expect(live.paused).toBe(true)
  })

  it("a hold's freeze piece pauses the element too", () => {
    const video = makeVideo(3, true)
    runFrame(doc({ segments: [{ in: 0, out: 3, hold: 2 }] }), video, 4)
    expect(video.playCalls).toBe(0)
    expect(video.paused).toBe(true)
  })
})
