import { describe, expect, it } from 'vitest'
import {
  CAMERA_CENTRE_RAMP,
  CAMERA_COVER_MIN,
  cameraCentring,
  cameraModel,
  clampFocus,
  computeCardLayout,
  docCardLayout,
  focusBounds,
  focusForViewportCentre,
  levelForFocusFraction,
  zoomView,
  zoomViewport,
} from '../layout'
import { DEFAULT_BROWSER_BAR, DEFAULT_FRAME_STYLE } from '../types'
import type { CardLayout } from '../layout'
import type { FrameStyle } from '../types'

/**
 * GOLDEN CONTRACT: computeCardLayout must mirror ON_FRAME's inline layout math
 * (lowerToComposition's "video destination rect" block) — the values below are
 * hand-derived from that code. If an ON_FRAME layout change breaks these,
 * update BOTH implementations together (see layout.ts header).
 */
describe('computeCardLayout (golden vs ON_FRAME math)', () => {
  it('contain-fits a 16:9 video inside default padding on a 1920×1080 canvas', () => {
    const frame = { ...DEFAULT_FRAME_STYLE } // padding 48, bar off
    const l = computeCardLayout(frame, { width: 1600, height: 900 }, 1920, 1080)
    // s = 1, pad = 48 → avail 1824×984; sc = min(1824/1600, 984/900) = 984/900
    const sc = 984 / 900
    expect(l.dw).toBeCloseTo(1600 * sc, 6)
    expect(l.dh).toBeCloseTo(984, 6)
    expect(l.dx).toBeCloseTo((1920 - 1600 * sc) / 2, 6)
    expect(l.dy).toBeCloseTo(48, 6)
    expect(l.cardY).toBe(l.dy) // no bar → card == video
    expect(l.cardH).toBe(l.dh)
  })

  it('reserves the browser-bar strip above the video (card = bar + video)', () => {
    const frame: FrameStyle = {
      ...DEFAULT_FRAME_STYLE,
      browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'mac-dark', height: 44 },
    }
    const l = computeCardLayout(frame, { width: 1600, height: 900 }, 1920, 1080)
    // availH loses barH: 1080 − 96 − 44 = 940 → sc = 940/900
    expect(l.dh).toBeCloseTo(940, 6)
    expect(l.dy).toBeCloseTo((1080 - 940 + 44) / 2, 6)
    expect(l.cardY).toBeCloseTo(l.dy - 44, 6)
    expect(l.cardH).toBeCloseTo(940 + 44, 6)
  })

  it('scales design-px controls with canvas height (s = H/1080, like ON_FRAME)', () => {
    const frame = { ...DEFAULT_FRAME_STYLE }
    const half = computeCardLayout(
      frame,
      { width: 1600, height: 900 },
      960,
      540,
    )
    const full = computeCardLayout(
      frame,
      { width: 1600, height: 900 },
      1920,
      1080,
    )
    expect(half.dx).toBeCloseTo(full.dx / 2, 6)
    expect(half.dw).toBeCloseTo(full.dw / 2, 6)
  })

  it('docCardLayout resolves the design canvas from the output aspect', () => {
    const doc = {
      frame: { ...DEFAULT_FRAME_STYLE, aspectRatio: '1:1' },
      source: {
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 1000,
          width: 1600,
          height: 900,
          fps: 30,
        },
      },
    }
    const l = docCardLayout(doc as never)
    expect(l.W).toBe(1080)
    expect(l.H).toBe(1080)
  })
})

describe('focusBounds', () => {
  const layout = (frame: Partial<FrameStyle> = {}): CardLayout =>
    computeCardLayout(
      { ...DEFAULT_FRAME_STYLE, ...frame },
      { width: 1600, height: 900 },
      1920,
      1080,
    )

  /** The content window visible through the zoom transform on one axis. */
  const visible = (
    anchorOff: number,
    anchorSize: number,
    f01: number,
    level: number,
    viewport: number,
  ) => {
    const f = anchorOff + f01 * anchorSize
    return { lo: f - f / level, hi: f + (viewport - f) / level }
  }

  it('keeps the visible crop inside the card for any in-bounds focus (property)', () => {
    for (const padding of [0, 24, 48, 96]) {
      for (const level of [1.25, 1.5, 1.8, 2.2, 3.5, 5]) {
        const l = layout({ padding })
        const b = focusBounds(level, l)
        for (const fx of [b.minX, (b.minX + b.maxX) / 2, b.maxX]) {
          const { lo, hi } = visible(l.dx, l.dw, fx, level, l.W)
          // feasible only when the zoomed card can cover the canvas — when the
          // bounds collapsed to a midpoint, coverage is best-effort; skip.
          if (b.minX < b.maxX) {
            expect(lo).toBeGreaterThanOrEqual(l.dx - 1e-6)
            expect(hi).toBeLessThanOrEqual(l.dx + l.dw + 1e-6)
          }
        }
        for (const fy of [b.minY, b.maxY]) {
          if (b.minY < b.maxY) {
            const { lo, hi } = visible(l.dy, l.dh, fy, level, l.H)
            expect(lo).toBeGreaterThanOrEqual(l.cardY - 1e-6)
            expect(hi).toBeLessThanOrEqual(l.cardY + l.cardH + 1e-6)
          }
        }
      }
    }
  })

  it('collapses to the center at level 1 (identity transform, focus irrelevant)', () => {
    expect(focusBounds(1, layout())).toEqual({
      minX: 0.5,
      maxX: 0.5,
      minY: 0.5,
      maxY: 0.5,
    })
  })

  it('widens monotonically with the zoom level', () => {
    const l = layout()
    const b2 = focusBounds(2, l)
    const b4 = focusBounds(4, l)
    expect(b4.minX).toBeLessThanOrEqual(b2.minX)
    expect(b4.maxX).toBeGreaterThanOrEqual(b2.maxX)
  })

  it('clampFocus pulls out-of-bounds points onto the bounds', () => {
    const l = layout()
    const b = focusBounds(2, l)
    expect(clampFocus(0, 1, 2, l)).toEqual({ cx: b.minX, cy: b.maxY })
    const inside = clampFocus(0.5, 0.5, 2, l)
    expect(inside).toEqual({ cx: 0.5, cy: 0.5 })
  })

  it('is scale-invariant (same normalized bounds at any canvas size, fixed aspect)', () => {
    const small = computeCardLayout(
      DEFAULT_FRAME_STYLE,
      { width: 1600, height: 900 },
      960,
      540,
    )
    const large = computeCardLayout(
      DEFAULT_FRAME_STYLE,
      { width: 1600, height: 900 },
      3840,
      2160,
    )
    const bs = focusBounds(1.8, small)
    const bl = focusBounds(1.8, large)
    expect(bs.minX).toBeCloseTo(bl.minX, 9)
    expect(bs.maxY).toBeCloseTo(bl.maxY, 9)
  })
})

describe('levelForFocusFraction (the corner drag is a level drag)', () => {
  it('inverts the rect size: size 1/L round-trips to L', () => {
    for (const level of [1.25, 1.8, 2.2, 3.5, 5]) {
      expect(levelForFocusFraction(1 / level)).toBeCloseTo(level, 6)
    }
  })

  it('clamps to the stored-level ceiling', () => {
    expect(levelForFocusFraction(0.1)).toBe(5)
  })

  it('never reaches the identity mid-drag (the rect must not dismiss itself)', () => {
    expect(levelForFocusFraction(1)).toBeCloseTo(1.1, 6)
    expect(levelForFocusFraction(2)).toBeCloseTo(1.1, 6)
  })

  it('a degenerate size means the tightest zoom, not NaN', () => {
    expect(levelForFocusFraction(0)).toBe(5)
    expect(levelForFocusFraction(-1)).toBe(5)
  })
})

describe('the camera models (zoomView / zoomViewport / focusForViewportCentre)', () => {
  const l = computeCardLayout(
    DEFAULT_FRAME_STYLE,
    { width: 1600, height: 900 },
    1920,
    1080,
  )

  it('the magnifier is the old "scale about the focus" window, written the long way', () => {
    for (const level of [1.2, 1.5, 1.8, 2.5])
      for (const [cx, cy] of [
        [0.5, 0.5],
        [0.2, 0.8],
        [0.9, 0.1],
      ]) {
        const v = zoomViewport(level, cx, cy, l, 'card')
        const fx = l.dx + cx * l.dw
        const fy = l.dy + cy * l.dh
        expect(v.x * l.W).toBeCloseTo(fx - fx / level, 6)
        expect(v.y * l.H).toBeCloseTo(fy - fy / level, 6)
        expect(v.w).toBeCloseTo(1 / level, 9)
      }
  })

  it('the stage camera puts the focus at the frame centre once the centring has ramped in', () => {
    for (const level of [1 + CAMERA_CENTRE_RAMP, 1.5, 1.8, 3])
      for (const [cx, cy] of [
        [0, 1],
        [1, 0],
        [0.05, 0.5],
        [0.5, 0.5],
      ]) {
        const v = zoomView(level, cx, cy, l, 'stage')
        expect(v.wcx).toBeCloseTo(v.fx, 6)
        expect(v.wcy).toBeCloseTo(v.fy, 6)
        const p = zoomViewport(level, cx, cy, l, 'stage')
        expect((p.x + p.w / 2) * l.W).toBeCloseTo(v.fx, 6)
        expect((p.y + p.h / 2) * l.H).toBeCloseTo(v.fy, 6)
      }
  })

  it('both models are the identity at level 1 and continuous just above it', () => {
    for (const camera of ['card', 'stage'] as const) {
      // A rest keyframe carries centring 0, so the identity holds for both.
      const at1 = zoomViewport(1, 0.05, 0.9, l, camera, 0)
      expect(at1).toEqual({ x: 0, y: 0, w: 1, h: 1 })
      const just = zoomViewport(1.001, 0.05, 0.9, l, camera, 0)
      expect(Math.abs(just.x)).toBeLessThan(0.01)
      expect(Math.abs(just.y)).toBeLessThan(0.01)
    }
    // The centring is what moves the window's centre toward the focus,
    // linearly: half the centring is half the way.
    const f = zoomView(1.5, 0.05, 0.9, l, 'stage', 1)
    const half = zoomView(1.5, 0.05, 0.9, l, 'stage', 0.5)
    const none = zoomView(1.5, 0.05, 0.9, l, 'stage', 0)
    expect(half.wcx).toBeCloseTo((f.wcx + none.wcx) / 2, 9)
    expect(f.wcx).toBeCloseTo(f.fx, 9)
    expect(cameraCentring(1)).toBe(0)
    expect(cameraCentring(1 + CAMERA_CENTRE_RAMP)).toBe(1)
    expect(cameraCentring(1 + CAMERA_CENTRE_RAMP / 2)).toBeCloseTo(0.5, 9)
  })

  it('the stage camera clamps only to the cover band; the magnifier to the whole frame', () => {
    for (const level of [1.5, 1.8, 2.5, 4]) {
      const stage = focusBounds(level, l, 'stage')
      // The band, analytically: the focus may come within b/L of the card's
      // edge, b = CAMERA_COVER_MIN/2 of the frame. (The magnifier's bounds
      // are not comparable: they bound where the WINDOW may sit, and a
      // focus at its bound puts the target at the frame's edge; here a
      // focus at the bound puts the target at the centre.)
      const b = (CAMERA_COVER_MIN / 2) * l.W
      expect(stage.minX).toBeCloseTo((l.cardX + b / level - l.dx) / l.dw, 9)
      expect(stage.maxX).toBeCloseTo(
        (l.cardX + l.cardW - b / level - l.dx) / l.dw,
        9,
      )
      expect(clampFocus(0.5, 0.5, level, l, 'stage')).toEqual({
        cx: 0.5,
        cy: 0.5,
      })
      // A corner focus lands where the card's corner leaves exactly
      // (1 − CAMERA_COVER_MIN) / 2 of the frame as ground on each side.
      const f = clampFocus(0, 0, level, l, 'stage')
      const v = zoomViewport(level, f.cx, f.cy, l, 'stage')
      const cornerX = (l.cardX - v.x * l.W) * level // screen px of the card's left edge
      expect(cornerX / l.W).toBeCloseTo((1 - CAMERA_COVER_MIN) / 2, 3)
    }
    // Level 1 pins to the centre in both (nothing to aim).
    expect(focusBounds(1, l, 'stage')).toEqual(focusBounds(1, l, 'card'))
  })

  it('focusForViewportCentre inverts the viewport centre in both models', () => {
    for (const camera of ['card', 'stage'] as const)
      for (const level of [1.15, 1.3, 1.8, 2.5])
        for (const [cx, cy] of [
          [0.5, 0.5],
          [0.15, 0.85],
          [0.95, 0.2],
        ]) {
          const p = zoomViewport(level, cx, cy, l, camera)
          const f = focusForViewportCentre(
            p.x + p.w / 2,
            p.y + p.h / 2,
            level,
            l,
            camera,
          )
          expect(f.cx).toBeCloseTo(cx, 6)
          expect(f.cy).toBeCloseTo(cy, 6)
        }
  })

  it('cameraModel reads the frame field, absent = the magnifier', () => {
    expect(cameraModel(undefined)).toBe('card')
    expect(cameraModel({})).toBe('card')
    expect(cameraModel({ camera: 'stage' })).toBe('stage')
    expect(cameraModel({ camera: 'card' })).toBe('card')
  })
})
