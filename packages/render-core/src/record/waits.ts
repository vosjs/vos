/**
 * What an `expect` and an `await` wait for: a condition on the page, read
 * without touching it (no cursor, no input), polled until it holds or the
 * time runs out. `expect` polls on camera for a few seconds; `await` polls
 * off camera for as long as a slow result takes. One reader for both, so
 * "appeared" means the same thing in either.
 */
import type { RecorderPage } from './driver'

export interface WaitCondition {
  /** an element matching this selector is visible */
  selector?: string
  /** some visible text on the page contains this */
  text?: string
  /** no element matching this selector is visible */
  gone?: string
  /** with `selector`: the element is enabled (true) or disabled (false) */
  enabled?: boolean
}

/** What the condition found the last time it looked: what a miss is said from. */
export interface ConditionState {
  holds: boolean
  /** with `selector`: whether a match was visible */
  visible?: boolean
}

/**
 * The visible text of the page contains `text`: `innerText` is what the
 * page renders, so a hidden element's words never count.
 */
export function visibleTextScript(text: string): string {
  return `(() => { const b = document.body; return !!b && (b.innerText || '').includes(${JSON.stringify(text)}) })()`
}

/** Read the condition once. A page mid-navigation reads as "not yet". */
export async function readCondition(
  page: RecorderPage,
  c: WaitCondition,
): Promise<ConditionState> {
  try {
    if (c.text !== undefined)
      return { holds: await page.evaluate<boolean>(visibleTextScript(c.text)) }
    if (c.gone !== undefined)
      return { holds: !(await page.locator(c.gone).first().isVisible()) }
    if (c.selector !== undefined) {
      const loc = page.locator(c.selector).first()
      const visible = await loc.isVisible()
      if (!visible) return { holds: false, visible }
      if (c.enabled === undefined) return { holds: true, visible }
      const enabled = await loc.isEnabled({ timeout: 1000 })
      return { holds: enabled === c.enabled, visible }
    }
  } catch {
    // A navigation tore the context down under the read: look again.
  }
  return { holds: false }
}

/**
 * Poll the condition every `everyMs` until it holds or `timeoutMs` pass.
 * `between` runs before each look but the first (an `await`'s reload).
 * The clock is the wall's: a rehearsal waits as long as a take would,
 * because how long a result takes is what a rehearsal is for.
 */
export async function pollCondition(
  page: RecorderPage,
  c: WaitCondition,
  opts: {
    timeoutMs: number
    everyMs: number
    sleep: (ms: number) => Promise<void>
    now?: () => number
    between?: () => Promise<void>
  },
): Promise<{ ok: boolean; ms: number; last: ConditionState }> {
  const now = opts.now ?? Date.now
  const start = now()
  for (let first = true; ; first = false) {
    if (!first && opts.between) await opts.between()
    const last = await readCondition(page, c)
    const ms = now() - start
    if (last.holds) return { ok: true, ms, last }
    const left = opts.timeoutMs - ms
    if (left <= 0) return { ok: false, ms, last }
    await opts.sleep(Math.min(opts.everyMs, left))
  }
}

/** Seconds as the recorder says them: `5 s`, `2.5 s`, `3 min 20 s`. */
export function sayDuration(ms: number): string {
  const s = Math.round(ms / 100) / 10
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s - m * 60)
  return rest ? `${m} min ${rest} s` : `${m} min`
}

/** What the condition waits for, in words: `'#result' to appear`. */
export function sayCondition(c: WaitCondition): string {
  if (c.text !== undefined) return `text "${c.text}" to show`
  if (c.gone !== undefined) return `'${c.gone}' to go`
  if (c.enabled === true) return `'${c.selector}' to be enabled`
  if (c.enabled === false) return `'${c.selector}' to be disabled`
  return `'${c.selector}' to appear`
}

/** Why the condition did not hold, in words: `'Generate' stayed disabled for 5 s`. */
export function conditionMiss(
  c: WaitCondition,
  last: ConditionState,
  ms: number,
): string {
  const t = sayDuration(ms)
  if (c.text !== undefined)
    return `no visible text contained "${c.text}" for ${t}`
  if (c.gone !== undefined) return `'${c.gone}' was still there after ${t}`
  if (last.visible && c.enabled === true)
    return `'${c.selector}' stayed disabled for ${t}`
  if (last.visible && c.enabled === false)
    return `'${c.selector}' stayed enabled for ${t}`
  return `'${c.selector}' never appeared in ${t}`
}
