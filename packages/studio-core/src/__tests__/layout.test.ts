import { describe, expect, it } from 'vitest'
import {
  clampFocus,
  computeCardLayout,
  docCardLayout,
  focusBounds,
  levelForFocusFraction,
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
