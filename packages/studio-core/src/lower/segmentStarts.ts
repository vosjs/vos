/**
 * Where each DOC segment lands on the output timeline: its rated pieces
 * (its own media's speed spans applied, the freezes on its footage placed)
 * and, from them, its output start and length. One home for the Video
 * row, the boundary transitions and the lint, so a clip's edges cannot be
 * three numbers. A freeze at a boundary two contiguous clips of one media
 * share belongs to the LATER clip (the frame is the same either way; the
 * band draws where the moment is), the rule `placeFreezes` keeps.
 */
import { splitBySpeed, totalDuration } from '@vosjs/timeline'
import { docFreezes, withFreezes } from './motion'
import { sameMedia } from '../media'
import { anchorSourceDuration, isRecordingDoc } from '../doc/studioDoc'
import type { Segment } from '@vosjs/timeline'
import type { StudioDoc } from '../doc/studioDoc'
import type { FreezeSpan, SpeedSpan } from '../types'

/** The doc's segments in canonical explicit form (empty = one full-source span). */
export function effectiveSegments(doc: StudioDoc): Segment[] {
  if (isRecordingDoc(doc) && doc.segments.length) return doc.segments
  return [{ in: 0, out: anchorSourceDuration(doc) }]
}

/** Does segment i start exactly where segment i-1 ends, on the same media (a split, not a cut)? */
export const contiguous = (
  segments: readonly (Segment & { media?: string })[],
  i: number,
): boolean =>
  i > 0 &&
  sameMedia(segments[i - 1].media, segments[i].media) &&
  Math.abs(segments[i - 1].out - segments[i].in) < 1e-9

/**
 * One DOC segment's rated pieces: its own media's speed spans applied and
 * the freezes on its footage placed (a freeze at its very end belongs to
 * it, one at its start to the segment before, when there is one).
 */
export const segmentPieces = (
  seg: Segment & { media?: string },
  speeds: readonly SpeedSpan[],
  freezes: readonly FreezeSpan[],
  leading: boolean,
): Segment[] => {
  const own = freezes.filter(
    (f) =>
      sameMedia(f.media, seg.media) &&
      f.at <= seg.out + 1e-9 &&
      (leading ? f.at >= seg.in - 1e-9 : f.at > seg.in + 1e-9),
  )
  return withFreezes(
    splitBySpeed(
      [seg],
      speeds.filter((sp) => sameMedia(sp.media, seg.media)),
    ),
    own,
  )
}

/** Output-time length of one DOC segment (speed- and freeze-aware). */
export const outputLen = (
  seg: Segment & { media?: string },
  speeds: readonly SpeedSpan[],
  freezes: readonly FreezeSpan[] = [],
  leading = true,
): number => totalDuration(segmentPieces(seg, speeds, freezes, leading))

/** Output-time starts of the DOC segments (speed- and freeze-aware). */
export const segmentStarts = (
  segments: readonly (Segment & { media?: string })[],
  speeds: readonly SpeedSpan[],
  freezes: readonly FreezeSpan[] = [],
): number[] => {
  const starts: number[] = []
  let acc = 0
  segments.forEach((s, i) => {
    starts.push(acc)
    acc += outputLen(s, speeds, freezes, i === 0 || !contiguous(segments, i))
  })
  return starts
}

/** One DOC segment's place on the output timeline. */
export interface SegmentExtent {
  start: number
  end: number
}

/**
 * Every DOC segment's output extent, in order: where each clip starts and
 * ends on the timeline, freezes included.
 */
export function segmentOutputExtents(doc: StudioDoc): SegmentExtent[] {
  const segments = effectiveSegments(doc) as (Segment & { media?: string })[]
  const speeds = doc.speed ?? []
  const freezes = isRecordingDoc(doc) ? docFreezes(doc) : []
  const starts = segmentStarts(segments, speeds, freezes)
  return segments.map((s, i) => ({
    start: starts[i],
    end:
      starts[i] +
      outputLen(s, speeds, freezes, i === 0 || !contiguous(segments, i)),
  }))
}
