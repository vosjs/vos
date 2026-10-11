/**
 * Where a step of the take's step timeline lands in the cut: a gesture's
 * end plus a settle (so the frame shows the response, not the travel),
 * mapped through the cut into OUTPUT seconds. The captions a plan writes
 * sit there. Pure.
 */
import { ratedSegments, spanOutputExtent } from '@vosjs/studio-core'
import type { StepSpan } from '@vosjs/studio-core'

/** Seconds after a gesture's end before the frame is read: the response has landed. */
export const STEP_SETTLE_SECONDS = 0.4

/**
 * A step's settled instant in OUTPUT seconds (its gesture end plus the
 * settle, mapped through the cut), or null when the cut trimmed it out.
 */
export function stepOutputTime(
  rated: ReturnType<typeof ratedSegments>,
  step: Pick<StepSpan, 'tStart' | 'tEnd'>,
  settle: number,
): number | null {
  const src = step.tEnd + settle
  const ext = spanOutputExtent(rated, src, src + 0.001)
  if (!ext) return null
  return ext.start
}
