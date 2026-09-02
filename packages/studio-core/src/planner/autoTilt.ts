/**
 * Dynamic-tilt planner:
 * derive tilt spans FROM the zoom spans — the camera leans toward each zoom's
 * focus, so emphasis reads in depth as well as in scale. Zoom spans are the
 * studio's condensed "what matters" signal (planner clicks + dwells + human
 * curation, focus points attached), which is why this planner consumes them
 * rather than re-reading the click track: extents align by construction (the
 * two tracks ramp and chain together) and no second planner competes with
 * auto-zoom for the same clicks.
 *
 * Pure and deterministic: same spans + same intensity → same suggestions,
 * ids keyed by the source zoom span (`t-<zoomId>`). Every emitted span is
 * `source: 'auto'` — the regenerate replaces them freely and NEVER touches
 * 'manual' spans (the auto-zoom wand contract; merge lives in the store).
 *
 * Direction (verified against the real renderer — the tilt-direction
 * render scenario pins it): with the camera at the origin looking
 * down −z and the card at CARD_Z,
 *   +rx swings the card's TOP edge toward the camera,
 *   +ry swings the LEFT edge toward the camera (the +x edge moves away).
 * "Lean toward the focus" therefore means rx ∝ −(cy − 0.5), ry ∝ −(cx − 0.5).
 */
import { spanOutputExtent } from '../lower/lowerToComposition'
import { TILT_INTENSITY_MAX, clampTiltDeg } from '../types'
import type { Segment } from '@vosjs/timeline'
import type { TiltSpan, TiltStyleName, ZoomSpan } from '../types'

/** Zoom spans shorter than this (OUTPUT seconds) get no tilt — a pose that
 * can't settle before the zoom leaves reads as wobble, not emphasis. */
export const TILT_AUTO_MIN = 1.2

/** Focus offsets under this (|cx−0.5| fraction) don't tilt that axis — a
 * centered zoom keeps the pure push-in feel; tilt is for off-center focus. */
export const TILT_AUTO_DEAD_ZONE = 0.12

export interface PlanTiltOptions {
  /** Intensity ladder — max degrees per axis (TILT_INTENSITY_MAX). */
  intensity: Exclude<TiltStyleName, 'off'>
}

/**
 * One tilt span per qualifying zoom span, SAME source extents (the tracks
 * ramp/chain together), pose aimed at the zoom's focus. Spans whose footage
 * is cut away, whose output run is too short, or whose focus is centered
 * (both axes inside the dead zone) emit nothing.
 */
export function planAutoTilt(
  zoom: readonly ZoomSpan[],
  segments: Segment[],
  options: PlanTiltOptions,
): TiltSpan[] {
  const max = TILT_INTENSITY_MAX[options.intensity]
  const spans: TiltSpan[] = []
  for (const z of [...zoom].sort((a, b) => a.in - b.in)) {
    const ext = spanOutputExtent(segments, z.in, z.out)
    if (!ext || ext.end - ext.start < TILT_AUTO_MIN) continue
    // Focus offset from center; auto-focus (cursor-follow) spans use their
    // stored entry focus — the tilt pose HOLDS while the zoom's internal
    // focus glides (one move per beat, never a re-aiming wobble).
    const rx = axisLean(-(z.cy - 0.5), max)
    const ry = axisLean(-(z.cx - 0.5), max)
    if (rx === 0 && ry === 0) continue
    spans.push({
      id: `t-${z.id}`,
      in: z.in,
      out: z.out,
      rx,
      ry,
      source: 'auto',
    })
  }
  return spans
}

/** Linear lean over the dead zone: offset ±0.5 → ±max degrees, quantized. */
function axisLean(offset: number, max: number): number {
  if (Math.abs(offset) < TILT_AUTO_DEAD_ZONE) return 0
  return clampTiltDeg(Math.max(-1, Math.min(1, offset / 0.5)) * max)
}
