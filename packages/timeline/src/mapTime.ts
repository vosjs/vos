import type { Segment, SpeedSpan } from './types'

/**
 * Source-time remapping — the trim / split / speed / multi-clip primitive.
 *
 * A timeline is the concatenation of its segments (kept spans of source time).
 * `mapTime` answers "which source moment is on screen at timeline time t";
 * `sourceToTimeline` is its partial inverse ("where does this source moment
 * appear on the timeline, if at all").
 *
 * A segment may carry a `rate` (source seconds per output second): a rated
 * segment occupies `(out - in) / rate` seconds of output time, so speed-ups
 * contract the timeline and slow-downs stretch it. Rates come from
 * `splitBySpeed`, which intersects footage-anchored `SpeedSpan`s with a
 * segment list.
 *
 * Empty segment lists mean "no remapping" (identity) so untrimmed compositions
 * need no special casing; apps that want explicit bounds pass one full segment.
 */

/** Effective rate of a segment (invalid/absent → 1). */
export function segmentRate(s: Segment): number {
  return s.rate !== undefined && s.rate > 0 ? s.rate : 1
}

/** Output duration of one segment (source length ÷ rate). */
function outputLength(s: Segment): number {
  return Math.max(0, s.out - s.in) / segmentRate(s)
}

/** Total output duration of a segment list (0 when empty). */
export function totalDuration(segments: readonly Segment[]): number {
  let sum = 0
  for (const s of segments) sum += outputLength(s)
  return sum
}

/**
 * Map timeline time → source time. Clamps: t < 0 → start of the first segment;
 * t past the end → end of the last segment. Identity when `segments` is empty.
 */
export function mapTime(segments: readonly Segment[], t: number): number {
  if (!segments.length) return t
  let acc = 0
  let lastOut = segments[0].out
  for (const s of segments) {
    const len = outputLength(s)
    if (t < acc + len) return s.in + Math.max(0, t - acc) * segmentRate(s)
    acc += len
    lastOut = s.out
  }
  return lastOut
}

/**
 * Playback rate in effect at timeline time `t` (1 when `t` is outside the
 * timeline or the segment list is empty). Lets players mirror the remap with
 * `video.playbackRate` during natural playback.
 */
export function rateAt(segments: readonly Segment[], t: number): number {
  if (!segments.length) return 1
  let acc = 0
  for (const s of segments) {
    const len = outputLength(s)
    if (t < acc + len) return segmentRate(s)
    acc += len
  }
  return 1
}

/**
 * Map source time → timeline time, or `null` when the source moment falls in a
 * removed (cut) region. When source ranges repeat across segments, the first
 * occurrence wins. Identity when `segments` is empty.
 */
export function sourceToTimeline(
  segments: readonly Segment[],
  sourceT: number,
): number | null {
  if (!segments.length) return sourceT
  let acc = 0
  for (const s of segments) {
    if (sourceT >= s.in && sourceT <= s.out) {
      return acc + (sourceT - s.in) / segmentRate(s)
    }
    acc += outputLength(s)
  }
  return null
}

/**
 * Intersect footage-anchored speed spans with a segment list, producing rated
 * segments ready for `mapTime`/`totalDuration`. Where a span covers a segment,
 * the span's rate REPLACES the segment's own; uncovered parts keep theirs.
 * Spans are processed in source order; where spans overlap, the earlier one
 * wins. Degenerate or non-positive-rate spans are ignored, and slivers shorter
 * than 1ns of source time are dropped.
 */
export function splitBySpeed(
  segments: readonly Segment[],
  speeds: readonly SpeedSpan[] | undefined,
): Segment[] {
  const spans = (speeds ?? [])
    .filter((sp) => sp.rate > 0 && sp.out - sp.in > 0)
    .sort((a, b) => a.in - b.in)
  if (!spans.length || !segments.length) return segments.map((s) => ({ ...s }))

  const out: Segment[] = []
  for (const seg of segments) {
    let cursor = seg.in
    for (const sp of spans) {
      const start = Math.max(sp.in, cursor)
      const end = Math.min(sp.out, seg.out)
      if (end <= start) continue
      if (start > cursor) out.push({ ...seg, in: cursor, out: start })
      out.push({ ...seg, in: start, out: end, rate: sp.rate })
      cursor = end
    }
    if (cursor < seg.out) out.push({ ...seg, in: cursor, out: seg.out })
  }
  return out.filter((s) => s.out - s.in > 1e-9)
}
