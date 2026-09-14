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
import { dragsFromTrack } from '../planner/autoZoom'
import { clampZoomLevel } from '../types'
import { ZOOM_STYLES } from '../zoomStyle'
import type { CameraModel, CardLayout } from '../layout'
import type { CursorTrack, ZoomSpan } from '../types'

/** Legacy defaults (= the default style's values); prefer FollowOptions. */
export const FOLLOW_SAFE_RATIO = ZOOM_STYLES.glide.followSafeRatio
export const FOLLOW_RECENTER = ZOOM_STYLES.glide.followRecenter
/** seconds between path samples through a drag (10 Hz reads as a pan). */
export const FOLLOW_PATH_STEP = 0.1
/** the path's smoothing window, seconds each side of a sample. */
export const FOLLOW_PATH_SMOOTH = 0.08

export interface FollowOptions {
  /** recenter when the cursor exits this central fraction of the crop. */
  safeRatio?: number
  /** seconds the camera takes to glide to a recentered focus. */
  recenter?: number
  /** target the cursor this many seconds ahead of the exit moment. */
  lookahead?: number
  /** the frame's camera model: the stage camera never clamps a focus. */
  camera?: CameraModel
}

export interface FollowEvent {
  /** SOURCE seconds — the moment the recenter starts. */
  t: number
  /**
   * A PATH sample: the camera is at this focus AT `t` (a linear segment
   * from the previous keyframe), not the start of a glide toward it. Baked
   * every FOLLOW_PATH_STEP through a drag, so the camera pans with the
   * pointer for the whole press.
   */
  path?: true
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
  const camera = options.camera ?? 'card'
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

  // Entry: the span's OWN focus. The planner derived it from the clicked
  // element's rect (or a hand wrote it), and that is where the camera must
  // land; the follow then steers from there. Seeding from the cursor's
  // last sample before span.in landed the camera where the pointer was
  // `lead` seconds before it reached the target, and the first correction
  // could not fire for another recenter period, so a click zoom opened
  // beside its target every time.
  const entry = clampFocus(span.cx, span.cy, level, layout, camera)

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

  // Drags inside the span are PATH-followed: a sample every FOLLOW_PATH_STEP
  // at the pointer's smoothed position for the whole press, so the camera
  // pans with a slider thumb or a scrubber instead of waiting for it to
  // leave the dead zone. The dead-zone follow resumes from the release.
  const drags = dragsFromTrack(cursor, space.w, space.h).filter(
    (d) => d.t1 > span.in && d.t0 < span.out,
  )
  const pathEvents: FollowEvent[] = []
  for (const d of drags) {
    const from = Math.max(d.t0, span.in)
    const to = Math.min(d.t1, span.out)
    for (let t = from; ; t += FOLLOW_PATH_STEP) {
      const at = Math.min(t, to)
      const a = sampleAt(pts, at - FOLLOW_PATH_SMOOTH)
      const b = sampleAt(pts, at)
      const c = sampleAt(pts, at + FOLLOW_PATH_SMOOTH)
      const f = clampFocus(
        (a.nx + b.nx + c.nx) / 3,
        (a.ny + b.ny + c.ny) / 3,
        level,
        layout,
        camera,
      )
      pathEvents.push({
        t: round(at),
        path: true,
        cx: round(f.cx),
        cy: round(f.cy),
      })
      if (at >= to) break
    }
  }
  let dragIdx = 0
  for (const p of pts) {
    if (p.t < span.in) continue
    if (p.t > span.out) break
    // Inside a drag the path owns the camera; past its release the
    // dead-zone follow measures from where the path left it.
    while (dragIdx < drags.length && p.t > drags[dragIdx].t1) {
      const last = pathEvents.filter((e) => e.t <= drags[dragIdx].t1).at(-1)
      if (last) {
        cx = last.cx
        cy = last.cy
      }
      nextAllowed = drags[dragIdx].t1 + recenter
      dragIdx++
    }
    if (dragIdx < drags.length && p.t >= drags[dragIdx].t0) continue
    if (p.t < nextAllowed) continue
    if (Math.abs(p.nx - cx) > thrX || Math.abs(p.ny - cy) > thrY) {
      // Look-ahead: aim at where the cursor will be, not where it was.
      const target =
        lookahead > 0 ? sampleAt(pts, Math.min(p.t + lookahead, span.out)) : p
      const f = clampFocus(target.nx, target.ny, level, layout, camera)
      // The clamp can pin distinct cursor points to the same focus — skip no-ops.
      if (Math.abs(f.cx - cx) < 1e-3 && Math.abs(f.cy - cy) < 1e-3) continue
      events.push({ t: round(p.t), cx: round(f.cx), cy: round(f.cy) })
      cx = f.cx
      cy = f.cy
      nextAllowed = p.t + recenter
    }
  }
  const merged = [...events, ...pathEvents].sort((a, b) => a.t - b.t)
  return { entry, events: merged }
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
