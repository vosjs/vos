import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

/**
 * Autoplay-policy fallback (the "silent ~3fps first playback" bug): the studio
 * tab opens programmatically, so an unmuted play() rejects with
 * NotAllowedError and the element never plays — ON_FRAME must fall back to
 * MUTED playback (always allowed) and lift the mute once the host reports a
 * user gesture via ctx.data.audioUnlocked. Stub-context run of the compiled
 * interpreter, same harness pattern as browserBar.test.ts.
 */
describe('ON_FRAME autoplay-mute fallback', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  const doc: ProjectDoc = {
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
        hasAudio: true, // mic track → video loads UNMUTED → policy applies
      },
    },
    segments: [{ in: 0, out: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }

  interface VideoStub {
    muted: boolean
    paused: boolean
    playCalls: number
    __voilaAutoMuted?: boolean
    [key: string]: unknown
  }

  function makeVideo(rejectUnmuted: boolean): VideoStub {
    const video: VideoStub = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      muted: false,
      volume: 1,
      currentTime: 0.5,
      duration: 3,
      playbackRate: 1,
      preservesPitch: false,
      playCalls: 0,
      play() {
        video.playCalls++
        if (rejectUnmuted && !video.muted) {
          return Promise.reject(
            new DOMException('no gesture', 'NotAllowedError'),
          )
        }
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

  function runFrame(
    video: VideoStub,
    data: Record<string, unknown>,
    playing: boolean,
  ): void {
    const { config } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = { __vos__: { isPaused: !playing } }
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
    onFrame(
      {
        time: 0.5,
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

  it('falls back to muted playback when unmuted play() is policy-blocked', async () => {
    const video = makeVideo(true)
    const { data } = lowerToComposition(doc)
    runFrame(video, data, true)
    await new Promise((r) => setTimeout(r, 0)) // let the rejection handler run
    expect(video.muted).toBe(true)
    expect(video.__voilaAutoMuted).toBe(true)
    expect(video.paused).toBe(false) // the muted retry actually played
    expect(video.playCalls).toBe(2)
  })

  it('unmutes after the host reports a user gesture (data.audioUnlocked)', async () => {
    const video = makeVideo(true)
    const { data } = lowerToComposition(doc)
    runFrame(video, data, true)
    await new Promise((r) => setTimeout(r, 0))
    runFrame(video, { ...data, audioUnlocked: true }, true)
    expect(video.muted).toBe(false)
    expect(video.__voilaAutoMuted).toBe(false)
  })

  it('leaves an unblocked unmuted video alone', async () => {
    const video = makeVideo(false)
    const { data } = lowerToComposition(doc)
    runFrame(video, data, true)
    await new Promise((r) => setTimeout(r, 0))
    expect(video.muted).toBe(false)
    expect(video.paused).toBe(false)
    expect(video.playCalls).toBe(1)
  })
})
