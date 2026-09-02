import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

// Shot mode: sourceKind 'image' — the compositor draws an HTMLImageElement-like
// still through the same pipeline (frame card, browser bar, zoom).
function makeShotDoc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:shot',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 5000,
        width: 2880,
        height: 1620,
        fps: 30,
      },
      sourceKind: 'image',
    },
    segments: [{ in: 0, out: 5 }],
    zoom: [{ id: 'z1', in: 1, out: 2, level: 1.5, cx: 0.5, cy: 0.4 }],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('still (screenshot) source', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  it('lowers with isImage in ctx.data', () => {
    const { data, duration } = lowerToComposition(makeShotDoc())
    expect(data.isImage).toBe(true)
    expect(duration).toBe(5)
  })

  it('ON_FRAME draws an image stub (no play/videoWidth) without throwing', () => {
    const { config, data } = lowerToComposition(makeShotDoc())

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
          return () => {
            calls.push(key)
          }
        },
        set: () => true,
      },
    )
    // HTMLImageElement-like: naturalWidth/Height, NO play()/videoWidth.
    const image = { naturalWidth: 2880, naturalHeight: 1620 }
    const ctx = {
      time: 1.6,
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
        video: image,
        cam: null,
      },
    }
    expect(() => onFrame(ctx, content, 1 / 30)).not.toThrow()
    expect(calls).toContain('drawImage')
    expect(calls).toContain('scale') // zoom transform applied at t=1.6 (mid-ramp/hold)
  })
})
