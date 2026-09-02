/**
 * Idle cursor fade — the dwell detector behind `CursorStyle.hideWhenIdle`.
 *
 * A parked cursor is the most common blemish in screen footage: the dot sits in
 * frame through every scroll, every typing passage, every pause, drawing the eye
 * to nothing. This bakes a sparse opacity curve so ON_FRAME can fade it out
 * during dwells and bring it back the moment the cursor moves again.
 *
 * Pure and deterministic — seek must stay a pure function of `t`, so there are
 * no springs and no state. Output is SOURCE-anchored (like the cursor samples
 * themselves), which is what makes trims, cuts and speed spans inherit the fade
 * from one seam.
 *
 * Detection runs on the RAW track, not the smoothed path. The smoothed path is
 * resampled at a fixed cadence and linearly interpolates across gaps, so during
 * a park it creeps toward wherever the cursor goes next — ground truth for "the
 * user isn't moving" is the absence of raw events. The smoothing settle after
 * the last real move is bounded and well under `CURSOR_IDLE_HOLD`, so the dot
 * is always at rest before the fade begins.
 *
 * Two things deliberately do NOT count as movement:
 *
 * - **Scrolling.** `scroll` events re-emit the last known position, so a reading
 *   pause looks "active" if you detect idleness from sample gaps. They carry no
 *   real cursor motion and are ignored here, so a long scroll correctly fades
 *   the cursor away — it isn't doing anything.
 * - **Focus jumps and typing.** `focus`/`key` events synthesize a position at
 *   the focused element's centre, which the cursor never visited — and during
 *   typing the caret is the actor, so the parked dot SHOULD fade.
 *
 * Clicks DO break a dwell: a press is not idle. The window before a click ends
 * `CURSOR_IDLE_FADE_IN` early so the dot is back at full opacity when the ring
 * blooms under it, rather than ghosting in behind its own click effect.
 */
import type { CursorTrack } from '../types'

/** Seconds of stillness before the cursor starts fading out. */
export const CURSOR_IDLE_HOLD = 1
/** Fade-out ramp, seconds. */
export const CURSOR_IDLE_FADE_OUT = 0.35
/** Fade-in ramp, seconds. Snappier than the way out — motion draws the eye. */
export const CURSOR_IDLE_FADE_IN = 0.18
/**
 * Movement epsilon as a fraction of the capture's short edge, floored at 2px
 * (the recorder's own distance gate). Relative so a 4K take isn't held to a
 * 1080p take's pixel budget.
 */
export const CURSOR_IDLE_EPS_FRAC = 0.0025

export interface CursorIdleOptions {
  /** Capture space, for the movement epsilon. */
  space: { w: number; h: number }
  /** SOURCE seconds; the trailing dwell runs to here. */
  sourceDuration: number
}

/** One point on the baked opacity curve. SOURCE seconds → alpha 0..1. */
export interface CursorFadeKey {
  t: number
  a: number
}

interface Point {
  t: number
  x: number
  y: number
}

const round = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Bake the opacity curve for a cursor track. Returns an empty array when
 * nothing dwells long enough to be worth hiding — callers then emit no
 * `cursorFade` key at all, so a take with a busy cursor lowers byte-identically
 * to the pre-feature lowering.
 */
export function cursorIdleFade(
  track: CursorTrack,
  o: CursorIdleOptions,
): CursorFadeKey[] {
  // Only these three carry a position the cursor actually occupied.
  const moves: Point[] = track
    .filter((e) => e.type === 'move' || e.type === 'down' || e.type === 'up')
    .map((e) => ({ t: e.t / 1000, x: e.x, y: e.y }))
  if (moves.length === 0) return []

  const eps = Math.max(
    2,
    CURSOR_IDLE_EPS_FRAC * Math.min(o.space.w || 0, o.space.h || 0),
  )

  // Virtual edge points so the head and tail parks are detectable: the drawn
  // dot holds the first sample's position before it and the last one's after
  // it, so those stretches are dwells even though no event lands in them.
  const pts: Point[] = []
  const first = moves[0]
  const last = moves[moves.length - 1]
  if (first.t > 0) pts.push({ t: 0, x: first.x, y: first.y })
  pts.push(...moves)
  if (o.sourceDuration > last.t) {
    pts.push({ t: o.sourceDuration, x: last.x, y: last.y })
  }

  // Still-windows: a window runs until the cursor leaves its anchor by `eps`.
  // Anchoring on the window START (not the previous point) is what makes slow
  // drift accumulate into a break instead of creeping unnoticed.
  const windows: { s: number; e: number }[] = []
  let anchor = pts[0]
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - anchor.x
    const dy = pts[i].y - anchor.y
    if (dx * dx + dy * dy > eps * eps) {
      windows.push({ s: anchor.t, e: pts[i].t })
      anchor = pts[i]
    }
  }
  windows.push({ s: anchor.t, e: pts[pts.length - 1].t })

  const clicks = track
    .filter((e) => e.type === 'down' || e.type === 'up')
    .map((e) => e.t / 1000)
    .sort((a, b) => a - b)

  const keys: CursorFadeKey[] = []
  for (const w of windows) {
    let s = w.s
    for (;;) {
      const c = clicks.find((t) => t > s && t <= w.e)
      if (c === undefined) {
        emit(keys, s, w.e)
        break
      }
      // End early enough to be back at full opacity on the press itself.
      emit(keys, s, c - CURSOR_IDLE_FADE_IN)
      s = c
    }
  }
  return keys
}

/**
 * Append the four keys describing one hidden stretch, skipping windows too
 * short to complete the fade — a partial fade that immediately reverses reads
 * as a flicker, which is worse than leaving the cursor up.
 */
function emit(keys: CursorFadeKey[], s: number, e: number): void {
  const from = s + CURSOR_IDLE_HOLD
  if (e - from < CURSOR_IDLE_FADE_OUT) return
  push(keys, from, 1)
  push(keys, from + CURSOR_IDLE_FADE_OUT, 0)
  push(keys, e, 0)
  push(keys, e + CURSOR_IDLE_FADE_IN, 1)
}

/** Keys are strictly increasing in t; a coincident key would divide by zero. */
function push(keys: CursorFadeKey[], t: number, a: number): void {
  const rt = round(t)
  if (keys.length > 0 && rt <= keys[keys.length - 1].t) {
    keys[keys.length - 1].a = a
    return
  }
  keys.push({ t: rt, a })
}
