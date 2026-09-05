import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { computeCardLayout } from '../layout'
import {
  CARD_EDGE_OVERDRAW,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { FrameStyle, ProjectDoc, ZoomSpan } from '../types'

/**
 * The card's straight edges must never show a seam. Two rules ON_FRAME
 * keeps, pinned here against the interpreter string:
 *
 * 1. The shadow's BODY is never painted where the footage goes. It is
 *    drawn off-canvas and only its shadow is offset back, so nothing dark
 *    sits under the footage's anti-aliased rim at a fractional card edge.
 * 2. The footage overdraws the clip by CARD_EDGE_OVERDRAW device pixels,
 *    so the clip is the one edge and the destination rect never anti-
 *    aliases the same edge a second time.
 *
 * Both values are device-sized inside the zoom's scaled user space, so the
 * zoomed frame is checked too.
 */

const VIDEO = { width: 1600, height: 900 }
const g = globalThis as Record<string, unknown>

afterEach(() => {
  delete g.window
  delete g.__vosTimeline
})

function makeDoc(frame: FrameStyle, zoom: ZoomSpan[] = []): ProjectDoc {
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
        width: VIDEO.width,
        height: VIDEO.height,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 3 }],
    zoom,
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

type Run = {
  /** Every shadowed fill: the body's rect and the offset it was cast with. */
  shadowBodies: { rect: number[]; offsetX: number; offsetY: number }[]
  /** The footage draw's destination rect (last four drawImage args). */
  footage: number[]
  /** The card clip rect. */
  clip: number[]
  /** The zoom transform's scale (1 when no scale() was called). */
  scale: number
}

function runFrame(doc: ProjectDoc, W: number, H: number, t = 0.5): Run {
  const { config, data } = lowerToComposition(doc)
  const onFrame = new Function(`return (${config.onFrame as string})`)() as (
    ctx: unknown,
    content: unknown,
    dt: number,
  ) => void
  g.window = { __vos__: { isPaused: true } }
  g.__vosTimeline = { mapTime, sample, lerpArray }

  const run: Run = { shadowBodies: [], footage: [], clip: [], scale: 1 }
  const state: Record<string, unknown> = {}
  let lastRounded: number[] | null = null
  let shadowSet = false
  const c2d = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'measureText') return () => ({ width: 42 })
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop: () => {} })
        return (...args: unknown[]) => {
          if (key === 'roundRect' || key === 'rect')
            lastRounded = args.slice(0, 4) as number[]
          if (key === 'clip' && lastRounded && run.clip.length === 0)
            run.clip = lastRounded
          if (key === 'fill' && shadowSet && lastRounded)
            run.shadowBodies.push({
              rect: lastRounded,
              offsetX: (state.shadowOffsetX as number) ?? 0,
              offsetY: (state.shadowOffsetY as number) ?? 0,
            })
          if (key === 'restore') shadowSet = false
          if (key === 'scale') run.scale = args[0] as number
          if (key === 'drawImage' && args.length >= 5)
            run.footage = args.slice(-4) as number[]
        }
      },
      set: (_t, key: string, value: unknown) => {
        state[key] = value
        if (key === 'shadowColor' && typeof value === 'string') shadowSet = true
        return true
      },
    },
  )
  const video = {
    videoWidth: VIDEO.width,
    videoHeight: VIDEO.height,
    readyState: 2,
    paused: true,
    currentTime: t,
    duration: 3,
    play: () => undefined,
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const ctx = {
    time: t,
    data,
    renderer: undefined,
    resolution: {
      width: W,
      height: H,
      drawingBufferWidth: W,
      drawingBufferHeight: H,
    },
  }
  const content = {
    refs: {
      c2d,
      canvas: { width: W, height: H },
      texture: { needsUpdate: false, dispose: () => undefined },
      video,
      cam: null,
    },
  }
  onFrame(ctx, content, 1 / 30)
  return run
}

const FRAME: FrameStyle = {
  ...DEFAULT_FRAME_STYLE,
  padding: 48,
  shadow: 0.4,
  shadowContact: 0.2,
  browserBar: DEFAULT_BROWSER_BAR,
}

describe('the card edge', () => {
  it('casts both shadows from a body that never touches the canvas', () => {
    const W = 1400
    const H = 560 // 48 × (560 / 1080) = 24.9 px: a fractional card edge
    const l = computeCardLayout(FRAME, VIDEO, W, H)
    const r = runFrame(makeDoc(FRAME), W, H)
    expect(r.scale).toBe(1)
    expect(r.shadowBodies).toHaveLength(2) // ambient + contact
    for (const body of r.shadowBodies) {
      const [x, y, w, h] = body.rect
      // The body is the card's own shape ...
      expect(w).toBeCloseTo(l.cardW, 6)
      expect(h).toBeCloseTo(l.cardH, 6)
      expect(y).toBeCloseTo(l.cardY, 6)
      // ... entirely off the canvas ...
      expect(x + w).toBeLessThan(0)
      // ... and the horizontal offset brings exactly its shadow back.
      expect(x + body.offsetX).toBeCloseTo(l.cardX, 6)
    }
  })

  it('overdraws the footage past the clip by one device pixel', () => {
    const W = 1400
    const H = 560
    const l = computeCardLayout(FRAME, VIDEO, W, H)
    const r = runFrame(makeDoc(FRAME), W, H)
    expect(r.clip[0]).toBeCloseTo(l.cardX, 6)
    expect(r.footage).toHaveLength(4)
    const [dx, dy, dw, dh] = r.footage
    const ov = CARD_EDGE_OVERDRAW
    expect(dx).toBeCloseTo(l.dx - ov, 6)
    expect(dy).toBeCloseTo(l.dy - ov, 6)
    expect(dw).toBeCloseTo(l.dw + 2 * ov, 6)
    expect(dh).toBeCloseTo(l.dh + 2 * ov, 6)
  })

  it('sizes both in device pixels under the zoom transform', () => {
    const W = 1920
    const H = 1080
    const zoom: ZoomSpan[] = [
      { id: 'z0', in: 0, out: 3, level: 2, cx: 0.5, cy: 0.5 },
    ]
    const l = computeCardLayout(FRAME, VIDEO, W, H)
    const r = runFrame(makeDoc(FRAME, zoom), W, H, 1.5)
    const lvl = r.scale
    expect(lvl).toBeGreaterThan(1.001)
    // The shadow offset is device space: the body's user-space displacement
    // times the zoom scale.
    for (const body of r.shadowBodies) {
      const [x, , w] = body.rect
      expect((l.cardX - x) * lvl).toBeCloseTo(body.offsetX, 4)
      // Still off-canvas once the transform scales it about the focus.
      const fx = l.dx + 0.5 * l.dw
      expect(fx + (x + w - fx) * lvl).toBeLessThan(0)
    }
    // The overdraw is one DEVICE pixel: 1 / lvl in user space.
    const ov = CARD_EDGE_OVERDRAW / lvl
    const [dx, , dw] = r.footage
    expect(dx).toBeCloseTo(l.dx - ov, 6)
    expect(dw).toBeCloseTo(l.dw + 2 * ov, 6)
  })
})
