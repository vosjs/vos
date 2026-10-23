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
  /**
   * A JavaScript expression evaluated in the page (awaited when it answers
   * a promise): the condition holds when its value is truthy, or, with
   * `equals`, when its value equals that one. For an app that keeps its
   * state in script rather than in the DOM (a canvas, a document model).
   */
  js?: string
  /** with `js`: the value the expression must equal (compared as JSON) */
  equals?: unknown
}

/** What the condition found the last time it looked: what a miss is said from. */
export interface ConditionState {
  holds: boolean
  /** with `selector`: whether a match was visible */
  visible?: boolean
  /**
   * with `js`: what the expression answered the last time it was read, as
   * JSON when it has a JSON form (absent for `undefined`), and in words
   * either way (`said`), or the error it threw (`threw`).
   */
  value?: unknown
  said?: string
  threw?: string
}

/**
 * The visible text of the page contains `text`: `innerText` is what the
 * page renders, so a hidden element's words never count.
 */
export function visibleTextScript(text: string): string {
  return `(() => { const b = document.body; return !!b && (b.innerText || '').includes(${JSON.stringify(text)}) })()`
}

/** The longest a js value is said in a line, in characters. */
export const JS_SAID_MAX = 120
/** The most a js value kept on the step holds, in characters of JSON. */
export const JS_VALUE_MAX = 2048

/**
 * The page script that evaluates a step's expression and answers what it
 * found, as a string (the one evaluate shape every driver shares). The
 * expression is the script author's own, run on their own page: it is
 * wrapped, never parsed, and a newline closes it before the paren so a
 * trailing line comment cannot swallow the wrapper.
 */
export function jsConditionScript(expr: string): string {
  return `(async () => {
  let v;
  try { v = await (${expr}
  ); } catch (e) { return JSON.stringify({ threw: String(e && e.message ? e.message : e) }) }
  const out = { truthy: !!v };
  try { const j = JSON.stringify(v); if (j !== undefined) out.json = j } catch (e) {}
  try { out.said = typeof v === 'string' ? JSON.stringify(v) : String(v) } catch (e) { out.said = typeof v }
  if (out.json !== undefined && typeof v !== 'string') out.said = out.json
  return JSON.stringify(out);
})()`
}

/** Two JSON values alike: the same keys and values whatever the key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((v, i) => sameJson(v, bb[i]))
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  return keys.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(bo, k) && sameJson(ao[k], bo[k]),
  )
}

/** What a js expression answered, read once: the condition and the value. */
async function readJs(
  page: RecorderPage,
  c: { js: string; equals?: unknown },
): Promise<ConditionState> {
  let raw: string
  try {
    raw = await page.evaluate<string>(jsConditionScript(c.js))
  } catch (e) {
    // An expression that does not parse never will: said, not retried as
    // "not yet". Anything else (a navigation under the read) is.
    const why = e instanceof Error ? e.message : String(e)
    if (
      /SyntaxError/.test(why) ||
      (e instanceof Error && e.name === 'SyntaxError')
    )
      return { holds: false, threw: `it does not parse: ${why.split('\n')[0]}` }
    throw e
  }
  let got: { truthy?: boolean; json?: string; said?: string; threw?: string }
  try {
    got = JSON.parse(raw) as typeof got
  } catch {
    return { holds: false }
  }
  if (got.threw !== undefined) return { holds: false, threw: got.threw }
  let value: unknown
  let hasValue = false
  if (got.json !== undefined) {
    try {
      value = JSON.parse(got.json)
      hasValue = true
    } catch {
      // not JSON after all: said in words only
    }
  }
  const holds =
    c.equals !== undefined
      ? hasValue && sameJson(value, c.equals)
      : got.truthy === true
  return {
    holds,
    ...(hasValue ? { value } : {}),
    said: clip(got.said ?? 'undefined', JS_SAID_MAX),
  }
}

const clip = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s

/**
 * A js value as a step keeps it (`meta.steps[].value`): the value itself
 * while its JSON fits, else its JSON cut short as a string.
 */
export function keptValue(value: unknown): unknown {
  const json = JSON.stringify(value)
  if (json === undefined) return undefined
  return json.length <= JS_VALUE_MAX ? value : clip(json, JS_VALUE_MAX)
}

/** Read the condition once. A page mid-navigation reads as "not yet". */
export async function readCondition(
  page: RecorderPage,
  c: WaitCondition,
): Promise<ConditionState> {
  try {
    if (c.js !== undefined) return await readJs(page, { ...c, js: c.js })
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

/** What a poll found: whether the condition held, after how long, and the last read. */
export interface PollResult {
  ok: boolean
  ms: number
  last: ConditionState
}

/**
 * Poll the condition every `everyMs` until it holds or `timeoutMs` pass.
 * `between` runs before each look but the first (an `await`'s reload).
 * With `confirm`, a hold counts only once it has held on that many reads
 * in a row, `confirm.gapMs` apart: a page that renders after network quiet
 * reads half-built for a moment, and a `gone` condition holds on a list
 * that has not been drawn yet. The clock is the wall's: a rehearsal waits
 * as long as a take would, because how long a result takes is what a
 * rehearsal is for.
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
    confirm?: { reads: number; gapMs: number }
  },
): Promise<PollResult> {
  const now = opts.now ?? Date.now
  const start = now()
  const reads = Math.max(1, opts.confirm?.reads ?? 1)
  for (let first = true; ; first = false) {
    if (!first && opts.between) await opts.between()
    let last = await readCondition(page, c)
    for (let n = 1; last.holds && n < reads; n++) {
      await opts.sleep(opts.confirm?.gapMs ?? 0)
      last = await readCondition(page, c)
    }
    const ms = now() - start
    if (last.holds) return { ok: true, ms, last }
    const left = opts.timeoutMs - ms
    if (left <= 0) return { ok: false, ms, last }
    await opts.sleep(Math.min(opts.everyMs, left))
  }
}

/** The DOM counts as settled after this long with no change. */
export const DOM_QUIET_MS = 800
/** The longest a settle waits on a page that never stops changing. */
export const DOM_SETTLE_CAP_MS = 5000

/**
 * The page's own count of DOM changes: an observer installed once per
 * document, read back as a number. A string, the one evaluate shape every
 * driver shares.
 */
export const DOM_CHANGE_PROBE = `(() => {
  if (!window.__vosDomChanges) {
    window.__vosDomChanges = { n: 0 };
    new MutationObserver((list) => { window.__vosDomChanges.n += list.length })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  return window.__vosDomChanges.n;
})()`

/**
 * Wait until the DOM has not changed for `quietMs`, at most `capMs`: what
 * a page does after its network went quiet (a list rendered from data, a
 * hydration). The count is polled from here rather than timed in the
 * page, because a background tab throttles its own timers.
 */
export async function domSettled(
  page: RecorderPage,
  opts: {
    sleep: (ms: number) => Promise<void>
    now?: () => number
    quietMs?: number
    capMs?: number
    tickMs?: number
  },
): Promise<{ settled: boolean; ms: number }> {
  const now = opts.now ?? Date.now
  const quiet = opts.quietMs ?? DOM_QUIET_MS
  const cap = opts.capMs ?? DOM_SETTLE_CAP_MS
  const start = now()
  let seen = await page.evaluate<number>(DOM_CHANGE_PROBE).catch(() => -1)
  let since = start
  for (;;) {
    const t = now()
    if (t - since >= quiet) return { settled: true, ms: t - start }
    if (t - start >= cap) return { settled: false, ms: t - start }
    await opts.sleep(opts.tickMs ?? 100)
    const n = await page.evaluate<number>(DOM_CHANGE_PROBE).catch(() => -1)
    if (n !== seen) {
      seen = n
      since = now()
    }
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
  if (c.js !== undefined)
    return c.equals !== undefined
      ? `${sayJs(c.js)} to equal ${clip(JSON.stringify(c.equals) ?? 'undefined', JS_SAID_MAX)}`
      : `${sayJs(c.js)} to hold`
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
  if (c.js !== undefined) {
    if (last.threw !== undefined)
      return `${sayJs(c.js)} threw for ${t} (${clip(last.threw, JS_SAID_MAX)})`
    const was = last.said ?? 'never answered'
    return c.equals !== undefined
      ? `${sayJs(c.js)} was ${was}, not ${clip(JSON.stringify(c.equals) ?? 'undefined', JS_SAID_MAX)}, for ${t}`
      : `${sayJs(c.js)} was ${was} for ${t}`
  }
  if (c.text !== undefined)
    return `no visible text contained "${c.text}" for ${t}`
  if (c.gone !== undefined) return `'${c.gone}' was still there after ${t}`
  if (last.visible && c.enabled === true)
    return `'${c.selector}' stayed disabled for ${t}`
  if (last.visible && c.enabled === false)
    return `'${c.selector}' stayed enabled for ${t}`
  return `'${c.selector}' never appeared in ${t}`
}

/** An expression as a line names it: in backticks, cut short. */
export function sayJs(expr: string): string {
  return `js \`${clip(expr.replace(/\s+/g, ' ').trim(), 80)}\``
}

/** A kept value as a line says it: its JSON, cut short. */
export function sayValue(value: unknown): string {
  return clip(JSON.stringify(value) ?? 'undefined', JS_SAID_MAX)
}
