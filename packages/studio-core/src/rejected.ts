/**
 * Rejected proposals: the document's way to say "not this one".
 *
 * A planner proposal (an `auto` zoom, tilt or speed span) that the human or
 * the agent deleted is not data by itself: the doc records what was written,
 * not what was removed, so the next re-plan (a style pick, `vos plan`, a
 * re-record carried by `plan --reuse`) proposed it again and the deletion
 * had to be repeated by hand. `doc.rejected` keeps the deletion as a span
 * of its own — the lane and the source extent, plus the step anchor when
 * the span had one — and every auto-merge drops a fresh proposal that lands
 * on it. Manual spans never need this: a re-plan keeps them by contract.
 *
 * Matching is by extent, never by id: planner ids are positional and a
 * re-record moves every beat by tens of milliseconds, so a proposal is
 * rejected when it overlaps a rejected extent on the same lane by at least
 * REJECT_OVERLAP of the shorter of the two.
 */
import type { RejectedLane, RejectedSpan, StepAnchor } from './types'

/** Fraction of the shorter extent two spans must share to be "the same beat". */
export const REJECT_OVERLAP = 0.5

interface Extent {
  in: number
  out: number
}

/** Shared length over the shorter length; 0 when apart or degenerate. */
export function overlapFraction(a: Extent, b: Extent): number {
  const shared = Math.min(a.out, b.out) - Math.max(a.in, b.in)
  if (shared <= 0) return 0
  const shorter = Math.min(a.out - a.in, b.out - b.in)
  return shorter > 0 ? shared / shorter : 0
}

/** Whether a proposal on this lane lands on a rejected extent. */
export function isRejected(
  lane: RejectedLane,
  span: Extent,
  rejected: RejectedSpan[] | undefined,
): boolean {
  if (!rejected?.length) return false
  return rejected.some(
    (r) => r.lane === lane && overlapFraction(span, r) >= REJECT_OVERLAP,
  )
}

/** The proposals that survive the rejected list, in their given order. */
export function withoutRejected<T extends Extent>(
  lane: RejectedLane,
  spans: T[],
  rejected: RejectedSpan[] | undefined,
): T[] {
  if (!rejected?.length) return spans
  return spans.filter((s) => !isRejected(lane, s, rejected))
}

/**
 * The entry a deleted auto span leaves behind. Ids are `r{n}` over the
 * existing list so a differ and a history can name the rejection; the
 * anchor rides along when the span had one, so a re-record re-times the
 * rejection exactly the way it re-times the span it replaced.
 */
export function rejectSpan(
  rejected: RejectedSpan[] | undefined,
  lane: RejectedLane,
  span: Extent & { anchor?: StepAnchor },
  note?: string,
): RejectedSpan {
  const taken = new Set((rejected ?? []).map((r) => r.id))
  let n = 0
  while (taken.has(`r${n}`)) n++
  const entry: RejectedSpan = {
    id: `r${n}`,
    lane,
    in: +span.in.toFixed(3),
    out: +span.out.toFixed(3),
  }
  if (span.anchor) entry.anchor = { ...span.anchor }
  if (note) entry.note = note
  return entry
}
