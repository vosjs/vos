/**
 * `setup`: the steps that run BEFORE the camera rolls. A sign-in form, a
 * cookie banner, the "choose your editor" modal, an onboarding tour: things
 * a take must get past and must not show. They run after the first
 * navigation and before `Page.startScreencast`, with no cursor synthesis,
 * no pace accounting and nothing written to `meta.steps`. Then the recorder
 * navigates to `url` again and the take begins where the setup left it.
 *
 * A `type` step's `text` may be `{ "env": "DEMO_PASSWORD" }`: resolved at run
 * time from the `env` the caller hands in (the shell's for the CLI, the
 * job's own map for a hosted take), never logged, never stored. The
 * guarantee is narrow and real: the secret is never in a file that travels
 * (`actions.json` is committed and pushed with the take; `meta.json` is read
 * by the digest) and never in the footage.
 *
 * `teardown`: the same steps, run AFTER the take, off camera too: what the
 * take created in the product (an API key, a project, an invite) removed
 * again, so a rehearsal or a re-record leaves the account as it found it.
 * They run once the screencast has stopped, on the take's own page and
 * context (a session's cookies apply), and also when the take stops early
 * or throws once its first step has run. A teardown that fails never fails
 * the take: the footage is fine, and what is left behind is reported.
 *
 * `if`: a guard, `{ "do": "if", "selector": "…" }`. When its selector is on
 * the page the steps after it run as usual; when it is not, they are skipped
 * and the list ends there, which is not a failure. A teardown that undoes
 * what the take may already have removed on camera starts its undoing with
 * one (`if` the new key's row is still listed), so a good take reports
 * nothing to undo instead of a failure; a setup that signs in guards its
 * sign-in the same way (`if` the email field shows), so a session that is
 * already signed in passes. A failure AFTER a guard is still a failure.
 */
import type { RecorderPage } from './driver'

export type SetupText = string | { env: string }

export type SetupStep = (
  | { do: 'wait'; ms: number }
  | { do: 'click'; selector: string; ms?: number }
  | { do: 'type'; selector: string; text: SetupText; ms?: number }
  | { do: 'press'; key: string; ms?: number }
  | { do: 'goto'; url: string }
  | { do: 'if'; selector: string; ms?: number }
) & { id?: string }

const VERBS = new Set(['wait', 'click', 'type', 'press', 'goto', 'if'])

/** How long an `if` looks for its selector, when it names no `ms`. */
export const IF_LOOK_MS = 3000

/** Which list a step belongs to, as its messages and log lines name it. */
export type StepPhase = 'setup' | 'teardown'

/**
 * Why a page address is not one the recorder opens, or null. A script's
 * `url` and a setup's `goto` open a browser, so only http and https are
 * taken: a `file:` address would read this machine's disk into a take
 * and a `javascript:` one would run in the page.
 */
export function urlSchemeProblem(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return `${url} is not a URL`
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return `${url} is not an http(s) address, and the recorder opens only http and https pages`
  return null
}

/**
 * Structural validation, mirrored on `validateActions` for `steps`. The
 * same verbs and rules hold for `teardown`; `phase` names the list.
 */
export function validateSetup(
  value: unknown,
  phase: StepPhase = 'setup',
): string[] {
  const errors: string[] = []
  if (!Array.isArray(value)) return [`${phase} must be an array of steps`]
  value.forEach((raw, i) => {
    const at = `${phase}[${i}]`
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${at}: must be an object`)
      return
    }
    const s = raw as Record<string, unknown>
    if (typeof s.do !== 'string' || !VERBS.has(s.do)) {
      errors.push(`${at}: "do" must be one of ${[...VERBS].join(', ')}`)
      return
    }
    if (
      (s.do === 'click' || s.do === 'type' || s.do === 'if') &&
      typeof s.selector !== 'string'
    )
      errors.push(`${at}: ${s.do} needs a selector`)
    if (s.do === 'wait' && typeof s.ms !== 'number')
      errors.push(`${at}: wait needs ms`)
    if (s.do === 'press' && typeof s.key !== 'string')
      errors.push(`${at}: press needs a key`)
    if (s.do === 'goto') {
      if (typeof s.url !== 'string') errors.push(`${at}: goto needs a url`)
      else {
        const problem = urlSchemeProblem(s.url)
        if (problem) errors.push(`${at}: goto ${problem}`)
      }
    }
    if (s.do === 'type') {
      const t = s.text
      const isEnv =
        typeof t === 'object' &&
        t !== null &&
        typeof (t as { env?: unknown }).env === 'string' &&
        Object.keys(t).length === 1
      if (typeof t !== 'string' && !isEnv)
        errors.push(
          `${at}: type needs text, a string or { "env": "NAME" } read at run time`,
        )
      if (
        typeof t === 'string' &&
        /passw|secret|token/i.test(String(s.selector)) &&
        t.length > 0
      )
        errors.push(
          `${at}: a literal value typed into ${String(s.selector)} would live in actions.json, which is committed and pushed. Use { "env": "NAME" }`,
        )
    }
  })
  return errors
}

/** The names a setup reads from its env, so a host can say what it must supply. */
export function setupEnvNames(steps: SetupStep[] | undefined): string[] {
  const out = new Set<string>()
  for (const s of steps ?? []) {
    if (s.do === 'type' && typeof s.text === 'object') out.add(s.text.env)
  }
  return [...out]
}

/**
 * Every name a script reads from its env, its setup's and its teardown's,
 * each once: what a host must supply before the take begins.
 */
export function scriptEnvNames(script: {
  setup?: SetupStep[]
  teardown?: SetupStep[]
}): string[] {
  return [
    ...new Set([
      ...setupEnvNames(script.setup),
      ...setupEnvNames(script.teardown),
    ]),
  ]
}

/** A `{ env }` text resolved, or thrown in words. The value is never returned to a log. */
export function resolveSetupText(
  t: SetupText,
  env: Record<string, string | undefined>,
  phase: StepPhase = 'setup',
): { value: string; secret: boolean } {
  if (typeof t === 'string') return { value: t, secret: false }
  const v = env[t.env]
  if (v === undefined || v === '')
    throw new SetupEnvError(
      `${phase}: the environment variable ${t.env} is not set, and a type step reads it. Export it in the shell that runs vos record; it is never written to a file`,
    )
  return { value: v, secret: true }
}

/**
 * The first `{ env }` a teardown reads that `env` does not hold, in words,
 * or null. Asked BEFORE the take: a take that creates something its
 * teardown cannot then remove is the one case teardown exists for.
 */
export function teardownEnvProblem(
  steps: SetupStep[] | undefined,
  env: Record<string, string | undefined>,
): string | null {
  for (const [i, s] of (steps ?? []).entries()) {
    if (s.do !== 'type' || typeof s.text !== 'object') continue
    const v = env[s.text.env]
    if (v === undefined || v === '')
      return `teardown[${i}] reads the environment variable ${s.text.env}, which is not set, so the take could leave behind what its teardown removes. Export it in the shell that runs vos record; it is never written to a file. Nothing was recorded.`
  }
  return null
}

export interface SetupResult {
  ran: number
  /** what the log may say about each step: the verb and the selector, never a typed value */
  lines: string[]
  /**
   * The step that failed: for a setup, a selector that never appeared (the
   * take does not start); for a teardown, the step it stopped at. `error`
   * is the driver's reason, one line, never a typed value.
   */
  failed?: { step: number; do: string; selector?: string; error?: string }
  /**
   * An `if` whose selector was not on the page: the list ended there, and
   * `rest` steps after it were skipped. Not a failure.
   */
  skipped?: { step: number; selector: string; rest: number }
}

/** How long a whole teardown may take before it is stopped and reported. */
export const TEARDOWN_BOUND_MS = 60_000

/**
 * What a teardown did, on the take's result: how many of its steps ran,
 * and where it stopped. Never a typed value.
 */
export interface TeardownReport {
  ran: number
  of: number
  failed?: { step: number; do: string; selector?: string; error: string }
  /** An `if` whose selector was gone: nothing left to undo, never a failure. */
  skipped?: { step: number; selector: string; rest: number }
}

/** The teardown in one line, for the end of a take or a rehearsal. */
export function teardownLine(report: TeardownReport): string {
  const f = report.failed
  const k = report.skipped
  if (!f && k)
    return `teardown: nothing to undo, ${k.selector} is not on the page (teardown[${k.step}] if); ${report.ran} step(s) ran, ${k.rest} skipped`
  if (!f) return `teardown: ${report.ran} step(s) ran`
  const reason = f.error.replace(/[.\s]+$/, '')
  return `TEARDOWN FAILED at teardown[${f.step}] (${f.do}${f.selector ? ` ${f.selector}` : ''}): ${reason}. What the take created may still be in the product; remove it by hand.`
}

/**
 * Run the setup (or the teardown) on a page, with plain Playwright actions:
 * no humanized pointer, no cursor events, no frames. A selector that never
 * appears fails the steps there, because a take that begins at a
 * half-finished sign-in is the wall by another name. With `boundMs`, the
 * steps together run no longer than that: the step running when it passes
 * fails, and the call it left pending is abandoned.
 */
export async function runSetup(
  page: RecorderPage,
  steps: SetupStep[],
  opts: {
    sleep: (ms: number) => Promise<void>
    /** Absent means no env at all: a `{ env }` text then fails in words. */
    env?: Record<string, string | undefined>
    /** How a `goto` opens its page and waits for it (the take's ready mode); absent, network idle. */
    goto?: (url: string) => Promise<unknown>
    /** Which list these are, for the log and the messages (default `setup`). */
    phase?: StepPhase
    /** The longest the steps may take together, in ms. */
    boundMs?: number
    now?: () => number
  },
): Promise<SetupResult> {
  const env = opts.env ?? {}
  const phase = opts.phase ?? 'setup'
  const now = opts.now ?? Date.now
  const deadline = opts.boundMs === undefined ? undefined : now() + opts.boundMs
  const lines: string[] = []
  // The value a `type` step is filling, so a reason that quotes it is not used.
  let typed = ''
  // Set by an `if` whose selector is not on the page: the list ends there.
  let gone: { step: number; selector: string } | null = null
  const runStep = async (step: SetupStep, i: number): Promise<string> => {
    const settle = 'ms' in step && typeof step.ms === 'number' ? step.ms : 150
    switch (step.do) {
      case 'wait':
        await opts.sleep(step.ms)
        return `${phase} #${i} wait ${step.ms}ms`
      case 'goto':
        await (
          opts.goto
            ? opts.goto(step.url)
            : page.goto(step.url, {
                waitUntil: 'networkidle',
                timeout: 45000,
              })
        ).catch(() => null)
        return `${phase} #${i} goto ${step.url}`
      case 'press':
        await page.keyboard.press(step.key)
        await opts.sleep(settle)
        return `${phase} #${i} press ${step.key}`
      case 'if': {
        const present = await page
          .locator(step.selector)
          .first()
          .waitFor({ state: 'visible', timeout: step.ms ?? IF_LOOK_MS })
          .then(() => true)
          .catch(() => false)
        if (present) return `${phase} #${i} if ${step.selector}: on the page`
        gone = { step: i, selector: step.selector }
        return `${phase} #${i} if ${step.selector}: not on the page, the ${steps.length - i - 1} step(s) after it skipped`
      }
      case 'click': {
        const loc = page.locator(step.selector).first()
        await loc.waitFor({ state: 'visible', timeout: 8000 })
        await loc.click()
        await opts.sleep(settle)
        return `${phase} #${i} click ${step.selector}`
      }
      case 'type': {
        const loc = page.locator(step.selector).first()
        await loc.waitFor({ state: 'visible', timeout: 8000 })
        const { value, secret } = resolveSetupText(step.text, env, phase)
        typed = value
        await loc.fill(value)
        await opts.sleep(settle)
        // The log names the field, never what went into it.
        return `${phase} #${i} type ${secret ? `\${${(step.text as { env: string }).env}}` : `${value.length} chars`} into ${step.selector}`
      }
    }
  }
  for (const [i, step] of steps.entries()) {
    typed = ''
    try {
      lines.push(
        await withinDeadline(
          runStep(step, i),
          deadline,
          now,
          `the ${phase} ran past its ${sayBound(opts.boundMs ?? 0)} bound`,
        ),
      )
    } catch (e) {
      // A missing variable is a usage error before a take; a teardown's is
      // the step it stopped at.
      if (e instanceof SetupEnvError && phase === 'setup') throw e
      return {
        ran: i,
        lines,
        failed: {
          step: i,
          do: step.do,
          ...('selector' in step ? { selector: step.selector } : {}),
          error: reasonWords(e, typed),
        },
      }
    }
    // Set inside runStep, which the compiler cannot see from here.
    const ended = gone as { step: number; selector: string } | null
    if (ended)
      return {
        ran: i + 1,
        lines,
        skipped: { ...ended, rest: steps.length - i - 1 },
      }
  }
  return { ran: steps.length, lines }
}

/** A bound in the words a log reads: whole seconds, or ms under one. */
function sayBound(ms: number): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`
}

/** `p`, or a rejection once `deadline` passes; the abandoned call is never awaited. */
function withinDeadline<T>(
  p: Promise<T>,
  deadline: number | undefined,
  now: () => number,
  message: string,
): Promise<T> {
  if (deadline === undefined) return p
  const left = deadline - now()
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => {
        p.catch(() => {})
        reject(new Error(message))
      },
      Math.max(0, left),
    )
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

/** A terminal colour sequence, as a driver's error may carry one. */
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/**
 * A driver's error as one line a log may carry: its first line, without
 * terminal colour, and never a value a `type` step was filling.
 */
function reasonWords(e: unknown, typed: string): string {
  const raw = e instanceof Error ? e.message : String(e)
  const line = (raw.replace(ANSI_COLOUR, '').split('\n')[0] ?? '').trim()
  if (typed && line.includes(typed)) return 'the field could not be filled'
  return line || 'the step failed'
}

/** A `{ env }` the shell did not provide: a usage error, not a page's. */
export class SetupEnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SetupEnvError'
  }
}

/** A setup step whose selector never appeared: the take does not start. */
export class SetupError extends Error {
  constructor(public failed: NonNullable<SetupResult['failed']>) {
    super(
      `setup #${failed.step} ${failed.do}${failed.selector ? ` ${failed.selector}` : ''}: the selector never appeared, so the take would begin at a half-finished setup. Nothing was recorded. Fix the setup step (rehearse with --dry-run), then record.`,
    )
    this.name = 'SetupError'
  }
}

/** `--header name=value`, repeatable: extra request headers on every request. */
export function parseHeaders(
  given: string[] | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of given ?? []) {
    const i = h.indexOf('=')
    if (i <= 0) throw new Error(`--header wants name=value, got "${h}"`)
    out[h.slice(0, i).trim()] = h.slice(i + 1)
  }
  return out
}
