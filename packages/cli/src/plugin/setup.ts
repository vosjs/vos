/**
 * `setup`: the steps that run BEFORE the camera rolls. A sign-in form, a
 * cookie banner, the "choose your editor" modal, an onboarding tour: things
 * a take must get past and must not show. They run after the first
 * navigation and before `Page.startScreencast`, with no cursor synthesis,
 * no pace accounting and nothing written to `meta.steps`. Then the recorder
 * navigates to `url` again and the take begins where the setup left it.
 *
 * A `type` step's `text` may be `{ "env": "DEMO_PASSWORD" }`: resolved at run
 * time, never logged, never stored. The guarantee is narrow and real: the
 * secret is never in a file that travels (`actions.json` is committed and
 * pushed with the take; `meta.json` is read by the digest) and never in the
 * footage. An agent with a shell can still read the variable; that is the
 * maker's decision to make, not this file's to hide.
 */
import type { Page } from 'playwright'

export type SetupText = string | { env: string }

export type SetupStep = (
  | { do: 'wait'; ms: number }
  | { do: 'click'; selector: string; ms?: number }
  | { do: 'type'; selector: string; text: SetupText; ms?: number }
  | { do: 'press'; key: string; ms?: number }
  | { do: 'goto'; url: string }
) & { id?: string }

const VERBS = new Set(['wait', 'click', 'type', 'press', 'goto'])

/** Structural validation, mirrored on `validateActions` for `steps`. */
export function validateSetup(value: unknown): string[] {
  const errors: string[] = []
  if (!Array.isArray(value)) return ['setup must be an array of steps']
  value.forEach((raw, i) => {
    const at = `setup[${i}]`
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${at}: must be an object`)
      return
    }
    const s = raw as Record<string, unknown>
    if (typeof s.do !== 'string' || !VERBS.has(s.do)) {
      errors.push(`${at}: "do" must be one of ${[...VERBS].join(', ')}`)
      return
    }
    if ((s.do === 'click' || s.do === 'type') && typeof s.selector !== 'string')
      errors.push(`${at}: ${s.do} needs a selector`)
    if (s.do === 'wait' && typeof s.ms !== 'number')
      errors.push(`${at}: wait needs ms`)
    if (s.do === 'press' && typeof s.key !== 'string')
      errors.push(`${at}: press needs a key`)
    if (s.do === 'goto' && typeof s.url !== 'string')
      errors.push(`${at}: goto needs a url`)
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

/** A `{ env }` text resolved, or thrown in words. The value is never returned to a log. */
export function resolveSetupText(
  t: SetupText,
  env: NodeJS.ProcessEnv = process.env,
): { value: string; secret: boolean } {
  if (typeof t === 'string') return { value: t, secret: false }
  const v = env[t.env]
  if (v === undefined || v === '')
    throw new SetupEnvError(
      `setup: the environment variable ${t.env} is not set, and a type step reads it. Export it in the shell that runs vos record; it is never written to a file`,
    )
  return { value: v, secret: true }
}

export interface SetupResult {
  ran: number
  /** what the log may say about each step: the verb and the selector, never a typed value */
  lines: string[]
  /** a selector that never appeared; the take does not start */
  failed?: { step: number; do: string; selector?: string }
}

/**
 * Run the setup on a page, with plain Playwright actions: no humanized
 * pointer, no cursor events, no frames. A selector that never appears
 * fails the setup, because a take that begins at a half-finished sign-in is
 * the wall by another name.
 */
export async function runSetup(
  page: Page,
  steps: SetupStep[],
  opts: { sleep: (ms: number) => Promise<void>; env?: NodeJS.ProcessEnv },
): Promise<SetupResult> {
  const lines: string[] = []
  for (const [i, step] of steps.entries()) {
    const settle = 'ms' in step && typeof step.ms === 'number' ? step.ms : 150
    try {
      switch (step.do) {
        case 'wait':
          await opts.sleep(step.ms)
          lines.push(`setup #${i} wait ${step.ms}ms`)
          break
        case 'goto':
          await page
            .goto(step.url, { waitUntil: 'networkidle', timeout: 45000 })
            .catch(() => {})
          lines.push(`setup #${i} goto ${step.url}`)
          break
        case 'press':
          await page.keyboard.press(step.key)
          await opts.sleep(settle)
          lines.push(`setup #${i} press ${step.key}`)
          break
        case 'click': {
          const loc = page.locator(step.selector).first()
          await loc.waitFor({ state: 'visible', timeout: 8000 })
          await loc.click()
          await opts.sleep(settle)
          lines.push(`setup #${i} click ${step.selector}`)
          break
        }
        case 'type': {
          const loc = page.locator(step.selector).first()
          await loc.waitFor({ state: 'visible', timeout: 8000 })
          const { value, secret } = resolveSetupText(step.text, opts.env)
          await loc.fill(value)
          await opts.sleep(settle)
          // The log names the field, never what went into it.
          lines.push(
            `setup #${i} type ${secret ? `\${${(step.text as { env: string }).env}}` : `${value.length} chars`} into ${step.selector}`,
          )
          break
        }
      }
    } catch (e) {
      if (e instanceof SetupEnvError) throw e
      return {
        ran: i,
        lines,
        failed: {
          step: i,
          do: step.do,
          ...('selector' in step ? { selector: step.selector } : {}),
        },
      }
    }
  }
  return { ran: steps.length, lines }
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
