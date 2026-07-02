import type { Segment } from './types'

/**
 * Source-time remapping — the trim / split / multi-clip primitive.
 *
 * A timeline is the concatenation of its segments (kept spans of source time).
 * `mapTime` answers "which source moment is on screen at timeline time t";
 * `sourceToTimeline` is its partial inverse ("where does this source moment
 * appear on the timeline, if at all").
 *
 * Empty segment lists mean "no remapping" (identity) so untrimmed compositions
 * need no special casing; apps that want explicit bounds pass one full segment.
 */

/** Total output duration of a segment list (0 when empty). */
export function totalDuration(segments: readonly Segment[]): number {
  let sum = 0
  for (const s of segments) sum += Math.max(0, s.out - s.in)
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
    const len = Math.max(0, s.out - s.in)
    if (t < acc + len) return s.in + Math.max(0, t - acc)
    acc += len
    lastOut = s.out
  }
  return lastOut
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
    if (sourceT >= s.in && sourceT <= s.out) return acc + (sourceT - s.in)
    acc += Math.max(0, s.out - s.in)
  }
  return null
}
