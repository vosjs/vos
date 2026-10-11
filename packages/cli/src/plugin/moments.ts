/**
 * Where a step of the take's step timeline lands in the cut: a gesture's
 * end plus a settle (so the frame shows the response, not the travel),
 * mapped through the cut into OUTPUT seconds. The captions a plan writes
 * sit there; `resolveStepTime` reads a `step:<id>` time entry. Pure.
 */
import { ratedSegments, spanOutputExtent } from '@vosjs/studio-core'
import type { ProjectDoc, StepSpan } from '@vosjs/studio-core'

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

/**
 * Resolve a `--times` entry of the form `step:<id>[+offset|-offset]` (the
 * id from actions.json, or the step's index) against the take's step
 * timeline, in OUTPUT seconds. Null when the entry is not a step form;
 * throws when the step is unknown or trimmed out.
 */
export function resolveStepTime(doc: ProjectDoc, entry: string): number | null {
  const m = /^step:([^+-]+)([+-]\d+(?:\.\d+)?)?$/.exec(entry.trim())
  if (!m) return null
  const key = m[1]
  const offset = m[2] ? Number(m[2]) : STEP_SETTLE_SECONDS
  const steps = doc.source.meta.steps ?? []
  const step =
    steps.find((s) => s.id === key) ??
    (/^\d+$/.test(key) ? steps.find((s) => s.step === Number(key)) : undefined)
  if (!step) {
    const known = steps
      .map((s) => s.id ?? String(s.step))
      .filter((s) => s.length)
    throw new Error(
      `--times ${entry}: no step "${key}" in the take's step timeline${known.length ? ` (steps: ${known.join(', ')})` : ' (the take carries none: record it with the current CLI)'}`,
    )
  }
  const t = stepOutputTime(ratedSegments(doc), step, offset)
  if (t === null)
    throw new Error(
      `--times ${entry}: step "${key}" (${step.tEnd.toFixed(2)}s in the recording) falls outside the cut`,
    )
  return t
}
