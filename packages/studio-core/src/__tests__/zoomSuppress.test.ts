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
 * Aiming-mode suppression: the editor merges `zoomSuppressed: true` into
 * ctx.data while the focus overlay is up, and ON_FRAME must skip the zoom
 * transform (render the full frame) without touching anything else. Run the
 * compiled interpreter string against stub canvas/video objects — same harness
 * pattern as browserBar.test.ts.
 */
describe('ON_FRAME zoom suppression', () => {
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
      },
    },
    segments: [{ in: 0, out: 3 }],
    // Hold state covers t=1.5 (arrival at in+0.35, hold to out).
    zoom: [{ id: 'z0', in: 0.5, out: 2.5, level: 2, cx: 0.5, cy: 0.5 }],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }

  function runFrame(zoomSuppressed: boolean): string[] {
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void

    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const calls: string[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return (..._args: unknown[]) => {
            calls.push(key)
          }
        },
        set: () => true,
      },
    )
    const video = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      currentTime: 1.5,
      duration: 3,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const ctx = {
      time: 1.5, // inside the span's hold — level 2 active
      data: zoomSuppressed ? { ...data, zoomSuppressed: true } : data,
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
    return calls
  }

  it('applies the zoom transform normally (scale during the hold)', () => {
    const calls = runFrame(false)
    expect(calls).toContain('scale')
    expect(calls).toContain('drawImage')
  })

  it('skips the zoom transform when data.zoomSuppressed is set (aiming mode)', () => {
    const calls = runFrame(true)
    expect(calls).not.toContain('scale')
    expect(calls).toContain('drawImage') // everything else still renders
  })
})
