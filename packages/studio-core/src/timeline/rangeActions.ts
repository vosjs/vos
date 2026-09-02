/**
 * Range-first chip actions: pure recipes over the doc's span
 * arrays for a SOURCE-time range the user selected on the Video row. The
 * chips are the primary create path — creation and placement collapse into
 * one act, so the trim handles become a correction tool, not the way things
 * are made.
 */
import { mapTime } from '@vosjs/timeline'
import { DEFAULT_ZOOM_LEVEL, ZOOM_SPAN_MIN, clampSpeedRate } from '../types'
import { ratedSegments } from '../lower/lowerToComposition'
import type { Segment } from '@vosjs/timeline'
import type { StudioDoc } from '../doc/studioDoc'
import type { SpeedSpan, ZoomSpan } from '../types'

/** Map an OUTPUT-time range to SOURCE seconds through the doc's rate map. */
export function outputRangeToSource(
  doc: StudioDoc,
  t0: number,
  t1: number,
): { srcIn: number; srcOut: number } {
  const rated = ratedSegments(doc)
  return {
    srcIn: mapTime(rated, Math.max(0, t0)),
    srcOut: mapTime(rated, Math.max(0, t1)),
  }
}

const EPS = 1e-6
/** A trimmed remainder below this (source seconds) is a crumb — drop it. */
const MIN_REMAINDER = 0.25
/** Kept-segment floor after a cut (matches the video lane's split guard). */
const MIN_SEGMENT = 0.05

/**
 * Re-rate a SOURCE range: spans overlapping it are trimmed (a span split in
 * two mints a fresh id for the second half), then a manual span at `rate`
 * covers the range. `rate: null` just clears — the 1× chip.
 */
export function setSpeedInRange(
  spans: readonly SpeedSpan[],
  srcIn: number,
  srcOut: number,
  rate: number | null,
): SpeedSpan[] {
  if (srcOut - srcIn < EPS) return [...spans]
  const kept: SpeedSpan[] = []
  const used = new Set(spans.map((s) => s.id))
  for (const s of spans) {
    if (s.out <= srcIn + EPS || s.in >= srcOut - EPS) {
      kept.push(s)
      continue
    }
    if (srcIn - s.in >= MIN_REMAINDER)
      kept.push({ ...s, out: round(srcIn), source: 'manual' })
    if (s.out - srcOut >= MIN_REMAINDER)
      kept.push({
        ...s,
        id: mintId(used),
        in: round(srcOut),
        source: 'manual',
      })
  }
  if (rate != null)
    kept.push({
      id: mintId(used),
      in: round(srcIn),
      out: round(srcOut),
      rate: clampSpeedRate(rate),
      source: 'manual',
    })
  return kept.sort((a, b) => a.in - b.in)
}

/** The Remove chip: drop every span the range touches, whole. */
export function removeSpeedInRange(
  spans: readonly SpeedSpan[],
  srcIn: number,
  srcOut: number,
): SpeedSpan[] {
  return spans.filter((s) => s.out <= srcIn + EPS || s.in >= srcOut - EPS)
}

/**
 * The Cut chip: subtract a SOURCE range from the kept segments. Segment
 * order (and any reorder) is preserved; a remainder below MIN_SEGMENT is
 * dropped with its parent. Never empties the take: cutting everything
 * returns the original list unchanged.
 */
export function removeSourceRange(
  segments: readonly Segment[],
  srcIn: number,
  srcOut: number,
): Segment[] {
  const next: Segment[] = []
  for (const seg of segments) {
    if (seg.out <= srcIn + EPS || seg.in >= srcOut - EPS) {
      next.push(seg)
      continue
    }
    if (srcIn - seg.in >= MIN_SEGMENT) next.push({ ...seg, out: round(srcIn) })
    if (seg.out - srcOut >= MIN_SEGMENT)
      next.push({ ...seg, in: round(srcOut) })
  }
  return next.length ? next : [...segments]
}

/**
 * The Zoom chip: a manual zoom span covering as much of the range as the
 * lane's non-overlap rule allows — clipped against existing spans, starting
 * at the first free moment inside the range. Null when the free room is
 * below the zoom floor (the chip greys out).
 */
export function zoomSpanForRange(
  zoom: readonly ZoomSpan[],
  srcIn: number,
  srcOut: number,
): ZoomSpan | null {
  let start = srcIn
  const covering = zoom.find((z) => z.in <= start + EPS && z.out > start + EPS)
  if (covering) start = covering.out
  let end = srcOut
  for (const z of zoom) {
    if (z.in >= start - EPS && z.in < end) end = z.in
  }
  if (end - start < ZOOM_SPAN_MIN) return null
  const used = new Set(zoom.map((z) => z.id))
  let n = 0
  while (used.has(`u${n}`)) n++
  return {
    id: `u${n}`,
    in: round(start),
    out: round(end),
    level: DEFAULT_ZOOM_LEVEL,
    cx: 0.5,
    cy: 0.5,
    source: 'manual',
  }
}

/** Smallest unused `sp{n}` id, reserving it in `used` for the next mint. */
function mintId(used: Set<string>): string {
  let n = 0
  while (used.has(`sp${n}`)) n++
  const id = `sp${n}`
  used.add(id)
  return id
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
