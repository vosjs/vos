/**
 * Cursor smoothing.
 *
 * Raw pointer samples are jittery and irregularly spaced. We resample to a fixed
 * cadence and apply an exponential lerp — counterintuitively, linear smoothing
 * beats ease-in-out for cursors (easing stutters between samples). Pure and
 * deterministic: same input → same output.
 */
import type { CursorTrack } from '../types'

export interface SmoothPoint {
  /** seconds. */
  t: number
  x: number
  y: number
}

export interface SmoothOptions {
  /** lerp factor per step, 0..1 (higher = smoother/laggier). Default 0.15. */
  factor?: number
  /** resample cadence in fps. Default 60. */
  fps?: number
  /**
   * Pull the smoothed path onto each click's true position around the click
   * instant: click effects anchor at the
   * click point, so the (laggy) smoothed cursor must arrive on time or the
   * ring blooms away from the dot. The pull feeds back into the lerp state,
   * so the path continues from the click point afterwards. Deterministic.
   */
  clickSnap?: boolean
}

/** Snap window: the pull ramps in over this many seconds before the click… */
const SNAP_BEFORE = 0.12
/** …and holds through this many seconds after it (covers the press dip). */
const SNAP_AFTER = 0.18
/** Per-step pull gain at full envelope (60 fps steps → arrives by click time). */
const SNAP_GAIN = 0.5

/** Linear interpolation of raw (move) samples at an arbitrary time. */
function sampleAt(points: SmoothPoint[], t: number): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  if (t <= points[0].t) return { x: points[0].x, y: points[0].y }
  const last = points[points.length - 1]
  if (t >= last.t) return { x: last.x, y: last.y }
  // linear scan is fine for studio-length tracks; binary search if needed later
  for (let i = 1; i < points.length; i++) {
    if (points[i].t >= t) {
      const a = points[i - 1]
      const b = points[i]
      const f = (t - a.t) / (b.t - a.t || 1)
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
  }
  return { x: last.x, y: last.y }
}

/**
 * Produce a smoothed, fixed-cadence cursor path (in seconds) from a raw track.
 * Only `move`/`down`/`up` events carry positions; others are ignored here —
 * `scroll` re-emits a stale point, and `focus`/`key` synthesize element
 * centers the cursor never visited (letting those in would teleport the dot).
 */
export function smoothCursor(
  track: CursorTrack,
  options: SmoothOptions = {},
): SmoothPoint[] {
  const factor = clamp(options.factor ?? 0.15, 0.01, 1)
  const fps = options.fps ?? 60
  const raw: SmoothPoint[] = track
    .filter((e) => e.type === 'move' || e.type === 'down' || e.type === 'up')
    .map((e) => ({ t: e.t / 1000, x: e.x, y: e.y }))
  if (raw.length === 0) return []

  const clicks: SmoothPoint[] = options.clickSnap
    ? track
        .filter((e) => e.type === 'down')
        .map((e) => ({ t: e.t / 1000, x: e.x, y: e.y }))
    : []

  const start = raw[0].t
  const end = raw[raw.length - 1].t
  const step = 1 / fps
  const out: SmoothPoint[] = []
  let cx = raw[0].x
  let cy = raw[0].y
  let ci = 0
  for (let t = start; t <= end + 1e-9; t += step) {
    const target = sampleAt(raw, t)
    cx += (target.x - cx) * factor
    cy += (target.y - cy) * factor
    if (clicks.length) {
      // smoothstep envelope rising into the click, held through SNAP_AFTER
      while (ci < clicks.length - 1 && t > clicks[ci].t + SNAP_AFTER) ci++
      const ck = clicks[ci]
      const u = clamp(
        (t - (ck.t - SNAP_BEFORE)) / SNAP_BEFORE,
        0,
        t <= ck.t + SNAP_AFTER ? 1 : 0,
      )
      const w = u * u * (3 - 2 * u) * SNAP_GAIN
      if (w > 0) {
        cx += (ck.x - cx) * w
        cy += (ck.y - cy) * w
      }
    }
    out.push({ t, x: cx, y: cy })
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}
