/**
 * Cursor-follow focus —
 * the Recordly dead-zone model, baked DETERMINISTICALLY at lowering time,
 * tuned per camera style.
 *
 * OpenScreen chases the cursor with a stateful per-frame spring; Recordly only
 * recenters when the cursor nears the edge of the visible crop — calmer, and
 * it reduces to a handful of focus keyframes we can bake into the zoom track,
 * keeping seek a pure function of t (export, backward scrub, and every verify
 * script depend on that). Cursorful adds one more trick we adopt: a LOOK-AHEAD
 * — the recenter targets where the cursor is heading (sampled from the real
 * track slightly in the future), so the camera leads the pointer instead of
 * chasing a stale position. All three knobs (safe-zone ratio, recenter glide
 * duration, look-ahead) come from the doc's zoom style.
 *
 * Semantics per span with focusMode 'auto':
 *  - entry focus = the cursor position at span.in ("land where the cursor is")
 *  - while inside the span, a recenter event fires when the cursor exits the
 *    central safeRatio of the visible crop; the camera glides to the (clamped,
 *    look-ahead) cursor over `recenter` seconds, then waits for the next exit
 *  - the focus FREEZES for the zoom-out (the caller keeps the last focus)
 *
 * One capture subtlety: the extension's cursor recorder is event-driven with a
 * distance gate — a parked cursor emits NO move samples, so stillness appears
 * as a time GAP between samples, not as repeated samples. All the math here
 * works on positions at their timestamps, so gaps behave correctly (no events
 * → no recenters), and the look-ahead interpolates between real samples.
 */
import { clampFocus } from '../layout'
import { clampZoomLevel } from '../types'
import { ZOOM_STYLES } from '../zoomStyle'
import type { CardLayout } from '../layout'
import type { CursorTrack, ZoomSpan } from '../types'

/** Legacy defaults (= the default style's values); prefer FollowOptions. */
export const FOLLOW_SAFE_RATIO = ZOOM_STYLES.glide.followSafeRatio
export const FOLLOW_RECENTER = ZOOM_STYLES.glide.followRecenter

export interface FollowOptions {
  /** recenter when the cursor exits this central fraction of the crop. */
  safeRatio?: number
  /** seconds the camera takes to glide to a recentered focus. */
  recenter?: number
  /** target the cursor this many seconds ahead of the exit moment. */
  lookahead?: number
}

export interface FollowEvent {
  /** SOURCE seconds — the moment the recenter starts. */
  t: number
  cx: number
  cy: number
}

interface Pt {
  t: number
  nx: number
  ny: number
}

export function followFocusEvents(
  span: ZoomSpan,
  cursor: CursorTrack,
  space: { w: number; h: number },
  layout: CardLayout,
  options: FollowOptions = {},
): { entry: { cx: number; cy: number } | null; events: FollowEvent[] } {
  const safeRatio = options.safeRatio ?? FOLLOW_SAFE_RATIO
  const recenter = options.recenter ?? FOLLOW_RECENTER
  const lookahead = options.lookahead ?? 0
  const level = clampZoomLevel(span.level)
  if (!cursor.length || !space.w || !space.h || level <= 1.001) {
    return { entry: null, events: [] }
  }
  // Only real cursor positions steer the follow — scroll/focus/key events
  // carry stale or synthesized points (see cursorIdle.ts for the doctrine).
  const pts: Pt[] = cursor
    .filter((e) => e.type === 'move' || e.type === 'down' || e.type === 'up')
    .map((e) => ({
      t: e.t / 1000,
      nx: clamp01(e.x / space.w),
      ny: clamp01(e.y / space.h),
    }))
  if (!pts.length) return { entry: null, events: [] }

  // Entry: the last sample at/before span.in (the first sample if none precede).
  let entryPt = pts[0]
  for (const p of pts) {
    if (p.t > span.in) break
    entryPt = p
  }
  const entry = clampFocus(entryPt.nx, entryPt.ny, level, layout)

  // Exit threshold in normalized VIDEO units: the visible crop spans W/level
  // canvas px → (W/level)/dw of the video's width; half of that is the
  // center-to-edge distance, and the safe zone keeps safeRatio of it.
  const thrX = (safeRatio * layout.W) / (2 * level * layout.dw)
  const thrY = (safeRatio * layout.H) / (2 * level * layout.dh)

  const events: FollowEvent[] = []
  let cx = entry.cx
  let cy = entry.cy
  // Give the zoom-in arrival room to land before the first recenter.
  let nextAllowed = span.in + recenter
  for (const p of pts) {
    if (p.t < span.in) continue
    if (p.t > span.out) break
    if (p.t < nextAllowed) continue
    if (Math.abs(p.nx - cx) > thrX || Math.abs(p.ny - cy) > thrY) {
      // Look-ahead: aim at where the cursor will be, not where it was.
      const target =
        lookahead > 0 ? sampleAt(pts, Math.min(p.t + lookahead, span.out)) : p
      const f = clampFocus(target.nx, target.ny, level, layout)
      // The clamp can pin distinct cursor points to the same focus — skip no-ops.
      if (Math.abs(f.cx - cx) < 1e-3 && Math.abs(f.cy - cy) < 1e-3) continue
      events.push({ t: round(p.t), cx: round(f.cx), cy: round(f.cy) })
      cx = f.cx
      cy = f.cy
      nextAllowed = p.t + recenter
    }
  }
  return { entry, events }
}

/** Interpolate the cursor position at time t (holds the ends; pts time-sorted). */
function sampleAt(pts: Pt[], t: number): Pt {
  if (t <= pts[0].t) return pts[0]
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].t >= t) {
      const a = pts[i - 1]
      const b = pts[i]
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1
      return { t, nx: a.nx + (b.nx - a.nx) * k, ny: a.ny + (b.ny - a.ny) * k }
    }
  }
  return pts[pts.length - 1]
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
