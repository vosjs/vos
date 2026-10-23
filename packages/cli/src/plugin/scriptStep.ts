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

/** How a script differs from what was recorded from it. */
export interface ScriptDrift {
  /** Steps the take recorded (`meta.steps`). */
  recorded: number
  /** Steps in the script now. */
  inScript: number
  /** Recorded steps the script no longer has as they were: another verb or selector, or not found. */
  changed: { step: number; id?: string; was: string; now: string | null }[]
}

/**
 * The script against the steps recorded from it, or null when they still
 * agree: as many steps, each recorded step found (`scriptStepOf`) with its
 * verb and its selector. Pure.
 */
export function scriptDrift(
  recorded: readonly StepSpan[],
  list: unknown,
): ScriptDrift | null {
  if (!Array.isArray(list) || !recorded.length) return null
  const changed: ScriptDrift['changed'] = []
  for (const step of recorded) {
    const raw = scriptStepOf(step, list, recorded)
    const id = step.id !== undefined ? { id: String(step.id) } : {}
    if (!raw) {
      changed.push({ step: step.step, ...id, was: step.do, now: null })
      continue
    }
    const selectorMoved =
      typeof raw.selector === 'string' &&
      typeof step.selector === 'string' &&
      raw.selector !== step.selector
    if (raw.do !== step.do || selectorMoved)
      changed.push({
        step: step.step,
        ...id,
        was: step.selector ? `${step.do} ${step.selector}` : step.do,
        now:
          typeof raw.selector === 'string'
            ? `${String(raw.do)} ${raw.selector}`
            : String(raw.do),
      })
  }
  if (list.length === recorded.length && !changed.length) return null
  return { recorded: recorded.length, inScript: list.length, changed }
}

/** The drift in one line: what differs, and how captions and marks are matched despite it. */
export function scriptDriftLine(d: ScriptDrift, file = 'actions.json'): string {
  const counts =
    d.inScript === d.recorded
      ? `${file} no longer matches what was recorded`
      : `${file} has ${d.inScript} step${d.inScript === 1 ? '' : 's'} and the take recorded ${d.recorded} (meta.steps)`
  const shown = d.changed
    .slice(0, 3)
    .map(
      (c) =>
        `#${c.step}${c.id ? ` ${c.id}` : ''} was ${c.was}, ${c.now === null ? 'not found in the file' : `now ${c.now}`}`,
    )
  const changed = d.changed.length
    ? `; ${d.changed.length} recorded step${d.changed.length === 1 ? '' : 's'} changed (${shown.join('; ')}${d.changed.length > 3 ? '; …' : ''})`
    : ''
  return `${counts}${changed}: captions and zoom marks are matched to the recorded steps by id, then by place beside a named step, then by index (vos info shows where each lands; record again to bring them back in step)`
}
