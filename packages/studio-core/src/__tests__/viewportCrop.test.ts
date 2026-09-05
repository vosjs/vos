import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { computeCardLayout } from '../layout'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  CARD_EDGE_OVERDRAW,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc, Rect } from '../types'

// ON_FRAME must draw window takes through the viewport crop: 9-arg drawImage
// with the crop as source rect, and the card layout computed from CROP dims
// (not the video element's full capture dims). Mirrors layout.ts's golden
// contract through the crop path.
describe('ON_FRAME viewport crop', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  // Full capture 2400×1600; viewport crop removes 174 px of chrome at the top.
  const CROP: Rect = { x: 0, y: 174, w: 2400, h: 1426 }

  function makeDoc(crop?: Rect): ProjectDoc {
    return {
      source: {
        videoKey: 'blob:video',
        cursor: [],
        // Cropped takes have meta rewritten to crop dims at doc build.
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 3000,
          width: crop?.w ?? 2400,
          height: crop?.h ?? 1600,
          fps: 30,
          captureSurface: 'window',
          captureWidth: crop?.w ?? 2400,
          captureHeight: crop?.h ?? 1600,
        },
        frameSource: 'html5',
        crop,
      },
      segments: [{ in: 0, out: 3 }],
      zoom: [],
      audio: [],
      cursor: DEFAULT_CURSOR_STYLE,
      cam: DEFAULT_CAM_STYLE,
      frame: {
        ...DEFAULT_FRAME_STYLE,
        browserBar: { ...DEFAULT_FRAME_STYLE.browserBar },
      },
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
  }

  function runFrame(doc: ProjectDoc): unknown[][] {
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void

    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const draws: unknown[][] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return (...args: unknown[]) => {
            if (key === 'drawImage') draws.push(args.slice(1)) // drop the video element
          }
        },
        set: () => true,
      },
    )
    // The video element reports the FULL capture dims — the crop must win.
    const video = {
      videoWidth: 2400,
      videoHeight: 1600,
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
      time: 0.5,
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
    return draws
  }

  it('draws through the crop as a 9-arg source rect with crop-dim layout', () => {
    const doc = makeDoc(CROP)
    const [args] = runFrame(doc)
    expect(args).toHaveLength(8) // sx, sy, sw, sh, dx, dy, dw, dh (video dropped)
    expect(args.slice(0, 4)).toEqual([CROP.x, CROP.y, CROP.w, CROP.h])
    // Destination rect must mirror computeCardLayout fed with CROP dims.
    const l = computeCardLayout(
      doc.frame,
      { width: CROP.w, height: CROP.h },
      1920,
      1080,
    )
    // Grown by the one-pixel overdraw past the clip on every side.
    const ov = CARD_EDGE_OVERDRAW
    expect(args[4]).toBeCloseTo(l.dx - ov)
    expect(args[5]).toBeCloseTo(l.dy - ov)
    expect(args[6]).toBeCloseTo(l.dw + 2 * ov)
    expect(args[7]).toBeCloseTo(l.dh + 2 * ov)
  })

  it('keeps the 4-arg full-frame draw when there is no crop', () => {
    const [args] = runFrame(makeDoc(undefined))
    expect(args).toHaveLength(4)
    const l = computeCardLayout(
      makeDoc(undefined).frame,
      { width: 2400, height: 1600 },
      1920,
      1080,
    )
    expect(args[2]).toBeCloseTo(l.dw + 2 * CARD_EDGE_OVERDRAW)
    expect(args[3]).toBeCloseTo(l.dh + 2 * CARD_EDGE_OVERDRAW)
  })
})
