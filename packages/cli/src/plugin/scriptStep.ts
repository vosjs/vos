/**
 * The script step a RECORDED step was made from, in a script that may have
 * been edited since the take was recorded (a mark, an id, a check added).
 *
 * A recorded step (`meta.steps[]`) keeps the index it had in the script it
 * ran, so `list[step.step]` is that step only while nothing was inserted
 * before it. An agent edits `actions.json` after recording (that is the
 * point of a mark that works on the next plan), and one `expect` added
 * early would hand every later unnamed step its neighbour's caption or
 * mark. So: a named step is found by its id; an unnamed one by its place
 * beside the nearest recorded named step before it and after it (the way
 * `vos plan --reuse` re-finds a step), else at its own index; in every case
 * the verb must agree (and the selector, when both say one), a script step
 * that carries the id of ANOTHER recorded step is never this one, and two
 * places that disagree are no answer. Pure.
 */
import type { StepSpan } from '@vosjs/studio-core'

type Raw = Record<string, unknown>

const asRaw = (v: unknown): Raw | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Raw)
    : undefined

export function scriptStepOf(
  step: StepSpan,
  list: unknown,
  recorded: readonly StepSpan[] = [],
): Raw | undefined {
  if (!Array.isArray(list)) return undefined
  const steps = list.map(asRaw)
  const indexOfId = (id: string): number => steps.findIndex((s) => s?.id === id)
  if (step.id !== undefined) {
    const at = indexOfId(String(step.id))
    if (at >= 0) return steps[at]
  }
  const recordedIds = new Set(
    recorded
      .filter((r) => r !== step && r.id !== undefined)
      .map((r) => String(r.id)),
  )
  const fits = (s: Raw | undefined): s is Raw =>
    !!s &&
    s.do === step.do &&
    !(typeof s.id === 'string' && recordedIds.has(s.id)) &&
    !(
      typeof s.selector === 'string' &&
      typeof step.selector === 'string' &&
      s.selector !== step.selector
    )
  const named = recorded.filter(
    (r) => r !== step && r.id !== undefined && indexOfId(String(r.id)) >= 0,
  )
  const before = named
    .filter((r) => r.step < step.step)
    .sort((a, b) => b.step - a.step)[0]
  const after = named
    .filter((r) => r.step > step.step)
    .sort((a, b) => a.step - b.step)[0]
  const found = new Set<Raw>()
  for (const anchor of [before, after]) {
    if (!anchor) continue
    const hit = steps[indexOfId(String(anchor.id)) + step.step - anchor.step]
    if (fits(hit)) found.add(hit)
  }
  if (found.size === 1) return [...found][0]
  if (found.size > 1) return undefined
  const own = steps[step.step]
  return fits(own) ? own : undefined
}
