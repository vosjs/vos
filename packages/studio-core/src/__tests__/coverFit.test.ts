import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { clampFocus, computeCardLayout, focusBounds } from '../layout'
import {
  CARD_EDGE_OVERDRAW,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { FrameStyle, ProjectDoc } from '../types'

/**
 * Cover fit: the card rect and the video rect separate — the padded
 * area becomes the card and the footage cover-fills it, cropped around
 * frame.focus. The measured reference is the dogfood's 2.5:1 CWS marquee,
 * where contain showed a hard stripe of frame.background past the card.
 *
 * Two layers pinned here: the host mirror's numbers (computeCardLayout /
 * focusBounds), and ON_FRAME PARITY — the interpreter string is run against
 * stub canvas/video objects and its card clip + video dest rect must equal
 * the mirror's, the same change-together contract layout.test.ts pins for
 * contain.
 */

const VIDEO = { width: 1600, height: 900 }

function coverFrame(extra: Partial<FrameStyle> = {}): FrameStyle {
  return {
    ...DEFAULT_FRAME_STYLE,
    fit: 'cover',
    padding: 0,
    browserBar: DEFAULT_BROWSER_BAR,
    ...extra,
  }
}

describe('computeCardLayout cover', () => {
  it('the padded area is the card; the video cover-fills and overflows it', () => {
    // The marquee shape: 2.5:1 canvas, 16:9 footage.
    const l = computeCardLayout(coverFrame(), VIDEO, 1400, 560)
    expect([l.cardX, l.cardY, l.cardW, l.cardH]).toEqual([0, 0, 1400, 560])
    // cover scale = max(1400/1600, 560/900) = 0.875 → width-tight.
    expect(l.dw).toBeCloseTo(1400, 5)
    expect(l.dh).toBeCloseTo(787.5, 5)
    // Centered focus crops evenly: half the overflow above, half below.
    expect(l.dx).toBeCloseTo(0, 5)
    expect(l.dy).toBeCloseTo((560 - 787.5) / 2, 5)
  })

  it('focus picks the visible band and clamps gap-free at the edges', () => {
    const top = computeCardLayout(
      coverFrame({ focus: { cx: 0.5, cy: 0 } }),
      VIDEO,
      1400,
      560,
    )
    expect(top.dy).toBeCloseTo(0, 5) // top edge visible, no gap above
    const bottom = computeCardLayout(
      coverFrame({ focus: { cx: 0.5, cy: 1 } }),
      VIDEO,
      1400,
      560,
    )
    expect(bottom.dy).toBeCloseTo(560 - 787.5, 5) // bottom edge visible
    // A focus that would open a gap clamps to the edge instead.
    const past = computeCardLayout(
      coverFrame({ focus: { cx: 0.5, cy: -3 } }),
      VIDEO,
      1400,
      560,
    )
    expect(past.dy).toBeCloseTo(0, 5)
  })

  it('padding insets the card; the bar rides the card top at cf = 1', () => {
    const l = computeCardLayout(
      coverFrame({
        padding: 54, // 54 design px × s(=560/1080) = 28 comp px
        browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'minimal', height: 44 },
      }),
      VIDEO,
      1400,
      560,
    )
    const s = 560 / 1080
    const pad = 54 * s
    const barH = 44 * s // cf = 1 under cover
    expect(l.cardX).toBeCloseTo(pad, 5)
    expect(l.cardY).toBeCloseTo(pad, 5)
    expect(l.cardW).toBeCloseTo(1400 - pad * 2, 5)
    expect(l.cardH).toBeCloseTo(560 - pad * 2, 5)
    // The video area sits under the bar.
    expect(l.dy).toBeLessThanOrEqual(pad + barH + 0.001)
  })

  it('contain keeps cardX/cardW equal to the video rect (the old contract)', () => {
    const l = computeCardLayout(
      { ...DEFAULT_FRAME_STYLE, padding: 48, browserBar: DEFAULT_BROWSER_BAR },
      VIDEO,
      1920,
      1080,
    )
    expect(l.cardX).toBe(l.dx)
    expect(l.cardW).toBe(l.dw)
  })
})

describe('focusBounds under cover', () => {
  it('the zoomed CARD covers the canvas at every bound extreme', () => {
    // Coverage is demanded of the card rect on both axes; verify numerically
    // against the derivation in layout.ts (visible content window ⊆ card).
    const l = computeCardLayout(coverFrame(), VIDEO, 1400, 560)
    for (const level of [1.5, 2, 3]) {
      const b = focusBounds(level, l)
      for (const cx of [b.minX, b.maxX]) {
        const f = l.dx + cx * l.dw
        const lo = f * (1 - 1 / level)
        const hi = lo + l.W / level
        expect(lo).toBeGreaterThanOrEqual(l.cardX - 0.5)
        expect(hi).toBeLessThanOrEqual(l.cardX + l.cardW + 0.5)
      }
      const c = clampFocus(0.5, 0.5, level, l)
      expect(c.cx).toBeGreaterThanOrEqual(b.minX)
      expect(c.cx).toBeLessThanOrEqual(b.maxX)
    }
  })
})

// ON_FRAME parity: run the compiled interpreter string against stubs at the
// marquee canvas and pin its card clip + video dest rect to the mirror's.
describe('ON_FRAME cover parity', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function makeDoc(frame: FrameStyle): ProjectDoc {
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
      zoom: [],
      audio: [],
      cursor: DEFAULT_CURSOR_STYLE,
      cam: DEFAULT_CAM_STYLE,
      frame,
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
  }

  function runFrame(
    frame: FrameStyle,
    W: number,
    H: number,
  ): { clips: number[][]; draws: number[][]; fills: number[][] } {
    const { config, data } = lowerToComposition(makeDoc(frame))
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void

    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const clips: number[][] = []
    const draws: number[][] = []
    const fills: number[][] = []
    let lastRounded: number[] | null = null
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return (...args: unknown[]) => {
            if (key === 'roundRect' || key === 'rect')
              lastRounded = args.slice(0, 4) as number[]
            if (key === 'clip' && lastRounded) clips.push(lastRounded)
            if (key === 'drawImage' && args.length >= 5)
              draws.push(args.slice(-4) as number[])
            if (key === 'fillRect') fills.push(args as number[])
          }
        },
        set: () => true,
      },
    )
    const video = {
      videoWidth: VIDEO.width,
      videoHeight: VIDEO.height,
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
    return { clips, draws, fills }
  }

  it('the card clip and the video dest rect equal the mirror, cover and contain alike', () => {
    for (const frame of [
      coverFrame(),
      coverFrame({ focus: { cx: 0.5, cy: 0 } }),
      coverFrame({
        padding: 54,
        browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'minimal', height: 44 },
      }),
      { ...DEFAULT_FRAME_STYLE, padding: 48, browserBar: DEFAULT_BROWSER_BAR },
    ]) {
      const l = computeCardLayout(frame, VIDEO, 1400, 560)
      const { clips, draws } = runFrame(frame, 1400, 560)
      // First clip is the card's rounded clip.
      expect(clips.length).toBeGreaterThan(0)
      const [cx, cy, cw, ch] = clips[0]
      expect(cx).toBeCloseTo(l.cardX, 3)
      expect(cy).toBeCloseTo(l.cardY, 3)
      expect(cw).toBeCloseTo(l.cardW, 3)
      expect(ch).toBeCloseTo(l.cardH, 3)
      // The footage draw is the last 4 args of drawImage (dest rect): the
      // mirror's rect grown by the one-pixel overdraw past the clip.
      expect(draws.length).toBeGreaterThan(0)
      const [dx, dy, dw, dh] = draws[draws.length - 1]
      const ov = CARD_EDGE_OVERDRAW
      expect(dx).toBeCloseTo(l.dx - ov, 3)
      expect(dy).toBeCloseTo(l.dy - ov, 3)
      expect(dw).toBeCloseTo(l.dw + 2 * ov, 3)
      expect(dh).toBeCloseTo(l.dh + 2 * ov, 3)
    }
  })

  it('under cover the bar spans the card, not the video', () => {
    const frame = coverFrame({
      browserBar: {
        ...DEFAULT_BROWSER_BAR,
        kind: 'minimal',
        height: 44,
        showUrl: false,
        showControls: false,
      },
    })
    const l = computeCardLayout(frame, VIDEO, 1400, 560)
    const { fills } = runFrame(frame, 1400, 560)
    // The bar fill is the first fillRect at the card's own width (grown by
    // the overdraw past the clip on each side) and the bar's height; the
    // background's full-canvas fill is as wide, so width alone is not it.
    const bar = fills.find((f) => f[2] > 1000 && f[3] < 200)
    expect(bar).toBeDefined()
    expect(bar![0]).toBeCloseTo(l.cardX - CARD_EDGE_OVERDRAW, 3)
    expect(bar![2]).toBeCloseTo(l.cardW + 2 * CARD_EDGE_OVERDRAW, 3)
  })
})
