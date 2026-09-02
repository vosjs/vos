/**
 * Click extraction — the lowering step that
 * turns the raw cursor track's down/up events into the compact, OUTPUT-anchored
 * records ON_FRAME draws click effects from.
 *
 * OUTPUT-anchored so effects read at constant *viewer* speed: evaluated in
 * source time an 8× speed span would compress a 450 ms ripple to ~56 ms.
 * Baking the output instants here (instead of mapping per frame) is safe
 * because every segment/speed edit re-runs the lowering and ships fresh data —
 * the baked times can never go stale. Pure & deterministic.
 */
import { segmentRate, sourceToTimeline } from '@vosjs/timeline'
import type { Segment } from '@vosjs/timeline'
import type { CursorTrack, Rect } from '../types'

/** Anticipation lead — effects start this many output seconds before the click. */
export const CLICK_FX_PRE = 0.06
/** Base effect durations in output seconds (× the intensity's `dur`). */
export const CLICK_RIPPLE_DUR = 0.45
export const CLICK_PULSE_DUR = 0.35
export const CLICK_HIGHLIGHT_FADE = 0.35
/** Synthetic press length when the matching `up` is missing (nav killed it). */
export const CLICK_SYNTH_RELEASE = 0.12
/** A down→up pair longer than this is treated as unmatched (lost `up`). */
export const CLICK_PAIR_MAX = 10
/** Highlight uses the element rect only when it covers ≤ this viewport fraction. */
export const CLICK_RECT_MAX_FRAC = 0.35
/** …and only when the click point sits inside the rect (grown by this margin). */
const RECT_CONTAIN_MARGIN = 8

export interface LoweredClick {
  /** OUTPUT seconds of mousedown. */
  ot: number
  /** OUTPUT seconds of release (real up, clamped into kept footage). */
  up: number
  /** SOURCE seconds of mousedown — ON_FRAME's cross-cut proximity guard. */
  st: number
  /** click point in cursorSpace px. */
  x: number
  y: number
  /** pointer button (0=left). */
  b: number
  /** element rect [x,y,w,h] in cursorSpace px — present only when the
   * highlight style wants it AND it passed the size/containment gates
   * (ON_FRAME stays branch-light: r present = draw highlight). */
  r?: [number, number, number, number]
}

export interface ExtractClickOptions {
  /** attach gated element rects (highlight style). */
  rects?: boolean
  /** cursorSpace dims — the rect-size gate's denominator. */
  space: { w: number; h: number }
}

/**
 * OUTPUT time of the last kept source moment in [sIn, sOut] — the clamped
 * release for presses whose `up` fell in trimmed footage. Same accumulation
 * as lowerToComposition's spanOutputExtent (not imported: that would cycle).
 */
function keptOutputEnd(
  segments: Segment[],
  sIn: number,
  sOut: number,
): number | null {
  let acc = 0
  let end: number | null = null
  for (const p of segments) {
    const rate = segmentRate(p)
    const ovIn = Math.max(sIn, p.in)
    const ovOut = Math.min(sOut, p.out)
    if (ovOut > ovIn) end = acc + (ovOut - p.in) / rate
    acc += Math.max(0, p.out - p.in) / rate
  }
  return end
}

function gatedRect(
  rect: Rect,
  x: number,
  y: number,
  space: { w: number; h: number },
): [number, number, number, number] | null {
  const area = rect.w * rect.h
  const frame = space.w * space.h
  if (!(area > 0) || !(frame > 0) || area / frame > CLICK_RECT_MAX_FRAC)
    return null
  const m = RECT_CONTAIN_MARGIN
  const inside =
    x >= rect.x - m &&
    x <= rect.x + rect.w + m &&
    y >= rect.y - m &&
    y <= rect.y + rect.h + m
  return inside
    ? [round(rect.x), round(rect.y), round(rect.w), round(rect.h)]
    : null
}

/**
 * Extract OUTPUT-anchored clicks from a raw cursor track. Downs in trimmed-away
 * footage are dropped (they follow their footage, like every source-anchored
 * feature); a press pairs with the next `up` of the same button unless another
 * `down` of that button intervenes (a lost `up` must not chain two presses).
 */
export function extractClicks(
  track: CursorTrack,
  segments: Segment[],
  opts: ExtractClickOptions,
): LoweredClick[] {
  const out: LoweredClick[] = []
  for (let i = 0; i < track.length; i++) {
    const e = track[i]
    if (e.type !== 'down') continue
    const button = e.button ?? 0
    const st = e.t / 1000

    // real release: next same-button `up`, unless a same-button `down` intervenes
    let pressLen = CLICK_SYNTH_RELEASE
    for (let j = i + 1; j < track.length; j++) {
      const n = track[j]
      if ((n.button ?? 0) !== button) continue
      if (n.type === 'down') break
      if (n.type === 'up') {
        const len = (n.t - e.t) / 1000
        if (len > 0 && len <= CLICK_PAIR_MAX) pressLen = len
        break
      }
    }

    const ot = sourceToTimeline(segments, st)
    if (ot === null) continue
    const upSrc = st + Math.max(pressLen, 0.02)
    const up = keptOutputEnd(segments, st, upSrc) ?? ot + CLICK_SYNTH_RELEASE

    const click: LoweredClick = {
      ot: round(ot),
      up: round(Math.max(up, ot + 0.02)),
      st: round(st),
      x: round(e.x),
      y: round(e.y),
      b: button,
    }
    if (opts.rects && e.rect) {
      const r = gatedRect(e.rect, e.x, e.y, opts.space)
      if (r) click.r = r
    }
    out.push(click)
  }
  return out.sort((a, b) => a.ot - b.ot)
}

/** '#rgb'/'#rrggbb' → [r,g,b] for ctx.data (ON_FRAME composes rgba() per frame). */
export function hexToRgbTriplet(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h, 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
