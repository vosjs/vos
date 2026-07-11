import { mapTime, segmentRate } from './mapTime'
import type { Segment } from './types'

/**
 * Pure segment-editing helpers for hosts (lane adapters, inspectors). All are
 * total functions: invalid input returns the input array unchanged, so drag
 * handlers can call them unguarded. None of this ships in the runtime bundle —
 * running programs only evaluate, they never edit.
 */

/** Minimum segment length editors may produce (seconds). */
export const MIN_SEGMENT_LENGTH = 0.05

/** Drop degenerate segments and sort by source `in` order preserved as given. */
export function normalizeSegments(segments: readonly Segment[]): Segment[] {
  return segments.filter((s) => s.out - s.in >= MIN_SEGMENT_LENGTH).map((s) => ({ ...s }))
}

/**
 * Split the segment under timeline time `t` into two at the mapped source
 * moment. No-op when `t` falls on a boundary (either half would be degenerate)
 * or outside the timeline.
 */
export function splitSegments(segments: readonly Segment[], t: number): Segment[] {
  if (!segments.length) return [...segments]
  const sourceT = mapTime(segments, t)
  let acc = 0
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const len = Math.max(0, s.out - s.in) / segmentRate(s)
    if (t < acc + len) {
      if (
        sourceT - s.in < MIN_SEGMENT_LENGTH ||
        s.out - sourceT < MIN_SEGMENT_LENGTH
      ) {
        return [...segments]
      }
      return [
        ...segments.slice(0, i),
        { ...s, in: s.in, out: sourceT },
        { ...s, in: sourceT, out: s.out },
        ...segments.slice(i + 1),
      ]
    }
    acc += len
  }
  return [...segments]
}

/**
 * Retime one edge of a segment to a new SOURCE time, clamped so the segment
 * keeps `MIN_SEGMENT_LENGTH` and stays within `[0, maxOut]` (the source
 * duration). Neighbors are untouched — segments may legitimately overlap or
 * repeat source ranges.
 */
export function trimSegment(
  segments: readonly Segment[],
  index: number,
  edge: 'in' | 'out',
  sourceT: number,
  maxOut = Infinity,
): Segment[] {
  const s = segments[index]
  if (!s) return [...segments]
  const next =
    edge === 'in'
      ? { ...s, in: clamp(sourceT, 0, s.out - MIN_SEGMENT_LENGTH) }
      : { ...s, out: clamp(sourceT, s.in + MIN_SEGMENT_LENGTH, maxOut) }
  return segments.map((seg, i) => (i === index ? next : seg))
}

/** Remove a segment. No-op on an invalid index or when it is the only one. */
export function removeSegment(segments: readonly Segment[], index: number): Segment[] {
  if (segments.length <= 1 || !segments[index]) return [...segments]
  return segments.filter((_, i) => i !== index)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi))
}
