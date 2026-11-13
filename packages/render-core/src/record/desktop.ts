/**
 * A scripted take of a DESKTOP app: the same `actions.json` a page's take
 * runs, driven through a session that finds the app's controls by
 * accessibility and presses, types and scrolls as a hand does.
 *
 * It is the step loop only. What records the window, moves the pointer and
 * writes the cursor track is the session's (the CLI hands in
 * `@vosjs/driver`); this module turns steps into the session's commands,
 * paces them, and reports the take's step spans on the take's own clock.
 *
 * A step's `selector` is in the desktop dialect: a role, then what the
 * element is called or its accessibility identifier:
 *
 *   button[name='Save']   textfield[id='title']   toolbar > button[name*='Share']
 *   button[name='Delete']:nth(1)                   *[id='sidebar']
 *
 * What a desktop script cannot hold is refused before anything is recorded
 * (`desktopProblems`): a page's fields (`url`, `ready`, `peers`), the steps
 * that read a page (`paste`, `download`, `await`, a `js` check, a drawn
 * `path`), and a selector that is not one in this dialect.
 *
 * `mask` covers what it names before a frame is encoded (the driver's
 * work; `as: "text"` is a page's and is refused). `setup` and `teardown`
 * are the page's verbs pressed through a session that is not the take
 * (`runDesktopSetup`): the script's own way to put the app where the take
 * starts and back where it was, since no rehearsal here is thrown away.
 */
import type { Rect, StepSpan } from '@vosjs/studio-core'
import type { ActionStep, ActionsFile } from './actions'
import { EXPECT_TIMEOUT_S } from './actions'
import { capReached, cappedLine, clampWait } from './cap'
import type { RecorderClock } from './driver'
import { realSleep } from './driver'
import {
  DRAG_HOLD_MS,
  KEY_SEQUENCE_GAP_MS,
  pressSequence,
  splitChord,
} from './gestures'
import type { PaceReport, StepPace } from './pace'
import {
  TRAILING_HOLD_MS,
  askedMs,
  paceLine,
  paceReport,
  scrollTravelMs,
  settleMs,
} from './pace'
import type { DisabledClick, SkippedStep, StoppedTake } from './recorder'
import type { SetupResult, SetupStep, StepPhase } from './setup'
import { IF_LOOK_MS, TEARDOWN_BOUND_MS, resolveSetupText } from './setup'

/** What a command acts on: an element by selector, or a point in the window's own points. */
export type DesktopTarget = { selector: string } | { x: number; y: number }

/** A key held through a click or a drag. */
export type DesktopModifier = 'Meta' | 'Control' | 'Alt' | 'Shift'

/** One act the session performs. The shape is `@vosjs/driver`'s `Command`. */
export type DesktopCommand =
  | ({ do: 'locate' } & DesktopTarget)
  | ({
      do: 'click'
      count?: number
      button?: 'left' | 'right'
      modifiers?: DesktopModifier[]
    } & DesktopTarget)
  | ({ do: 'hover' } & DesktopTarget)
  | ({ do: 'type'; text: string; delayMs?: number } & Partial<DesktopTarget>)
  | { do: 'press'; keys: string | string[] }
  | ({
      do: 'scroll'
      dy?: number
      dx?: number
      ms?: number
    } & Partial<DesktopTarget>)
  | ({
      do: 'drag'
      to: DesktopTarget
      ms?: number
      modifiers?: DesktopModifier[]
    } & DesktopTarget)
  | ({ do: 'move'; ms?: number } & DesktopTarget)
  | { do: 'now' }
  | { do: 'focused' }

/** A command's answer. Times are milliseconds on the take's clock. */
export type DesktopAnswer =
  | {
      ok: true
      tStart: number
      tEnd: number
      count?: number
      enabled?: boolean
      name?: string
      rect?: Rect
      pressed?: boolean
      /** `focused`: what a key would go to. */
      focused?: { role: string; name?: string; rect?: Rect }
      /** `focused`: whether the app has the keyboard. */
      frontmost?: boolean
    }
  | { ok: false; code: string; message: string }

/** A take being recorded that takes commands, one at a time, each answered. */
export interface DesktopSession {
  send(command: DesktopCommand): Promise<DesktopAnswer>
}

/** How long a step waits for what it names to appear, as a page's take does: ms. */
export const DESKTOP_FIND_MS = 8000
/** How often a waiting step looks again: ms. */
export const DESKTOP_POLL_MS = 100
/** A typed character's pause when the step names none: ms. */
export const DESKTOP_TYPE_DELAY_MS = 40

/**
 * Roles on which a key is a COMMAND, not a character: typed text there
 * renames, selects, activates. A `type` step whose keys would go to one of
 * these is refused before the first key. Everything else is typed into: a
 * field, or a surface the app draws itself and names no role for.
 */
export const KEYS_ARE_COMMANDS = new Set([
  'row',
  'outline',
  'table',
  'list',
  'cell',
  'column',
  'browser',
  'button',
  'checkbox',
  'radio',
  'popup',
  'menu',
  'menubar',
  'menuitem',
  'menubutton',
  'tab',
  'tabgroup',
  'toolbar',
  'link',
  'image',
  'slider',
  'disclosuretriangle',
])

/** Codes that mean the take cannot go on, not that one step missed. */
const FATAL = new Set([
  'not-frontmost',
  'no-window',
  'accessibility',
  'no-tree',
])

const BROWSER_FIELDS: [keyof ActionsFile, string][] = [
  ['url', 'a desktop script names an app, not a url'],
  ['ready', 'ready is about a page’s first load'],
  ['peers', 'peers are other browser pages'],
]

export interface DesktopProblemOpts {
  /**
   * Why a selector is not one in the desktop dialect, or null
   * (`@vosjs/driver`'s `selectorProblem`). The host hands it in; without it
   * a selector is first read by the step that uses it, after the steps
   * before it have pressed the real app.
   */
  selectorProblem?: (selector: string) => string | null
}

/**
 * What a script holds that a desktop take cannot do, in the words of
 * `validateActions`: an empty list when it can run. Run `validateActions`
 * first; this reads a script that is already well formed.
 */
export function desktopProblems(
  actions: ActionsFile,
  opts: DesktopProblemOpts = {},
): string[] {
  const out: string[] = []
  /** A selector the driver would refuse, said where the script names it. */
  const named = (at: string, selector: unknown) => {
    if (typeof selector !== 'string' || !opts.selectorProblem) return
    const why = opts.selectorProblem(selector)
    if (why) out.push(`${at}: ${why}`)
  }
  for (const [field, why] of BROWSER_FIELDS)
    if (actions[field] !== undefined)
      out.push(`${field} is not part of a desktop script: ${why}`)
  if (actions.settle === true)
    out.push(
      'settle reads a page’s DOM; on a desktop take give the step its ms',
    )
  actions.mask?.forEach((m, i) => {
    if (m.as === 'text')
      out.push(
        `mask[${i}]: as "text" rewrites a page’s words; a desktop take covers what a mask names and puts nothing in its place`,
      )
    named(`mask[${i}]`, m.selector)
  })
  for (const phase of ['setup', 'teardown'] as const)
    actions[phase]?.forEach((step, i) => {
      const at = `${phase}[${i}]`
      if (step.do === 'goto')
        out.push(`${at}: goto opens a page; a desktop script has none`)
      if ('selector' in step) named(at, step.selector)
    })
  actions.steps.forEach((step, i) => {
    const at = `steps[${i}]`
    const no = (what: string) => out.push(`${at}: ${what}`)
    const fields = step as { selector?: unknown; gone?: unknown }
    named(at, fields.selector)
    named(`${at} gone`, fields.gone)
    if (step.settle === true)
      no('settle reads a page’s DOM; give the step its ms')
    switch (step.do) {
      case 'paste':
        no('paste is not on a desktop take yet: type the text')
        break
      case 'download':
        no('download saves a page’s file; a desktop take has none')
        break
      case 'await':
        no(
          'await cuts a page’s wait off camera; on a desktop take use expect with a timeout',
        )
        break
      case 'expect':
        if (step.js !== undefined)
          no('expect js runs in a page; name a selector, text or gone')
        break
      case 'click':
        if (step.button === 'middle')
          no('click button is "left" or "right" on a desktop take')
        break
      case 'drag':
        if (step.path !== undefined)
          no('drag path is not on a desktop take yet: give tx and ty')
        break
      case 'press':
        for (const chord of pressSequence(step)) {
          const { key } = splitChord(chord)
          if (key === '+')
            no(`press "${chord}": the + key is not one a desktop take presses`)
        }
        break
    }
  })
  return out
}

/** A page's chord as the desktop presses it: `Mod` and `ControlOrMeta` are Command. */
export function desktopChord(chord: string): string {
  const { mods, key } = splitChord(chord)
  const one = (k: string) => (k === 'Mod' || k === 'ControlOrMeta' ? 'Meta' : k)
  return [...mods.map(one), one(key)].join('+')
}

function desktopModifiers(
  mods: readonly string[] | undefined,
): DesktopModifier[] | undefined {
  if (!mods?.length) return undefined
  return mods.map((m) => (m === 'Mod' ? 'Meta' : m)) as DesktopModifier[]
}

/** Words on screen, as a selector: any element whose name contains them. */
export function textSelector(text: string): string {
  return `*[name*='${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
}

/**
 * Runs a desktop script's `setup` or `teardown` against a session that is
 * not the take: the same verbs as a page's, pressed through the driver. A
 * step that names something waits for it as a take's step does; an `if`
 * whose selector is not there ends the list quietly (nothing to undo, or
 * nothing to set up); the first step that misses ends it as a failure. A
 * typed value is never logged.
 */
export async function runDesktopSetup(
  session: DesktopSession,
  steps: readonly SetupStep[],
  phase: StepPhase,
  log: (msg: string) => void,
  opts: {
    clock?: RecorderClock
    /** Where a `{ env }` text is read from: the host's environment, handed in. */
    env?: Record<string, string | undefined>
    boundMs?: number
  } = {},
): Promise<SetupResult> {
  const clock: RecorderClock = opts.clock ?? {
    now: Date.now,
    sleep: realSleep,
  }
  const deadline = clock.now() + (opts.boundMs ?? TEARDOWN_BOUND_MS)
  const lines: string[] = []
  let ran = 0
  const say = (line: string) => {
    lines.push(line)
    log(`   ${phase}: ${line}`)
  }
  /** Whether the selector names something within `ms`, or why it cannot be asked. */
  const there = async (
    selector: string,
    ms: number,
  ): Promise<{ found: boolean; error?: string }> => {
    const until = Math.min(clock.now() + ms, deadline)
    for (;;) {
      const answer = await session.send({ do: 'locate', selector })
      if (!answer.ok) return { found: false, error: answer.message }
      if ((answer.count ?? 0) > 0) return { found: true }
      if (clock.now() >= until) return { found: false }
      await clock.sleep(DESKTOP_POLL_MS)
    }
  }
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    const selector = 'selector' in step ? step.selector : undefined
    const failed = (error: string): SetupResult => ({
      ran,
      lines,
      failed: {
        step: i,
        do: step.do,
        ...(selector ? { selector } : {}),
        error,
      },
    })
    if (clock.now() >= deadline)
      return failed(
        `the ${phase} ran past its ${Math.round((opts.boundMs ?? TEARDOWN_BOUND_MS) / 1000)}s`,
      )
    if (step.do === 'wait') {
      await clock.sleep(step.ms)
      say(`wait ${step.ms}ms`)
      ran++
      continue
    }
    if (step.do === 'goto')
      return failed('goto opens a page; a desktop script has none')
    if (step.do === 'if') {
      const { found, error } = await there(step.selector, step.ms ?? IF_LOOK_MS)
      if (error) return failed(error)
      if (!found) {
        say(`if ${step.selector}: not there, the rest is skipped`)
        return {
          ran,
          lines,
          skipped: {
            step: i,
            selector: step.selector,
            rest: steps.length - i - 1,
          },
        }
      }
      say(`if ${step.selector}: there`)
      ran++
      continue
    }
    if (selector) {
      const { found, error } = await there(selector, DESKTOP_FIND_MS)
      if (error) return failed(error)
      if (!found) return failed(`nothing matches ${selector}`)
    }
    let answer: DesktopAnswer
    if (step.do === 'click') {
      answer = await session.send({ do: 'click', selector: step.selector })
      if (answer.ok && answer.pressed === false)
        return failed(`${step.selector} is disabled, so it was not pressed`)
    } else if (step.do === 'type') {
      let text: string
      try {
        text = resolveSetupText(step.text, opts.env ?? {}, phase).value
      } catch (e) {
        return failed(e instanceof Error ? e.message : String(e))
      }
      answer = await session.send({
        do: 'type',
        selector: step.selector,
        text,
        delayMs: 12,
      })
    } else {
      answer = await session.send({ do: 'press', keys: desktopChord(step.key) })
    }
    if (!answer.ok) return failed(answer.message)
    say(step.do === 'press' ? `press ${step.key}` : `${step.do} ${selector}`)
    ran++
    if (step.ms) await clock.sleep(step.ms)
  }
  return { ran, lines }
}

export interface DesktopRunOpts {
  /** Where the take stops, in seconds of footage. */
  maxDurationSeconds?: number
  /** The clock and the pauses; a test hands in its own. */
  clock?: RecorderClock
  /** Ids of guarded steps the command confirmed (`--confirm`). */
  confirm?: readonly string[]
  /**
   * Stop after the step with this id, with no closing hold: a look at the
   * state a script reaches (`vos look --app --actions … --until <id>`).
   */
  until?: string
  onEvent?: (event: Record<string, unknown>) => void
}

export interface DesktopRunResult {
  /** What goes into `meta.steps`: each step's extent in the footage, in seconds. */
  steps: StepSpan[]
  skipped: SkippedStep[]
  disabled: DisabledClick[]
  confirmed: string[]
  pace: PaceReport
  capped: boolean
  /** The step the take could not go on from, or null. */
  stopped: StoppedTake | null
  /** With `until`: whether that step was reached and ran. */
  reached?: boolean
}

/**
 * Runs a script's steps against a take that is being recorded. Call it after
 * the take is ready; end the take when it returns.
 */
export async function runDesktopSteps(
  session: DesktopSession,
  actions: ActionsFile,
  log: (msg: string) => void,
  opts: DesktopRunOpts = {},
): Promise<DesktopRunResult> {
  const clock: RecorderClock = opts.clock ?? {
    now: Date.now,
    sleep: realSleep,
  }
  const maxSeconds = opts.maxDurationSeconds ?? Infinity
  const confirm = new Set(opts.confirm ?? [])

  const steps: StepSpan[] = []
  const skipped: SkippedStep[] = []
  const disabled: DisabledClick[] = []
  const confirmed: string[] = []
  const paces: StepPace[] = []
  let capped = false
  let stopped: StoppedTake | null = null
  let reached = false
  const goesOn = actions.onSkip === 'continue'

  // The take's clock is the session's. Every answer says what it reads, so
  // this side keeps the difference and can tell the take's time between acts.
  let offset = 0
  let gestureMs = 0
  const send = async (command: DesktopCommand): Promise<DesktopAnswer> => {
    const answer = await session.send(command)
    if (answer.ok) {
      offset = answer.tEnd - clock.now()
      if (command.do !== 'locate' && command.do !== 'now')
        gestureMs += answer.tEnd - answer.tStart
    }
    return answer
  }
  const now = () => clock.now() + offset
  const first = await send({ do: 'now' })
  if (!first.ok) throw new Error(first.message)

  for (let i = 0; i < actions.steps.length; i++) {
    const step = actions.steps[i]!
    if (capReached(now(), maxSeconds)) {
      capped = true
      log(`   ${cappedLine(maxSeconds)}`)
      break
    }
    const id = step.id
    const tag = `#${i}${id ? ` ${id}` : ''} ${step.do}`
    const stepStart = now()
    const skippedBefore = skipped.length
    gestureMs = 0
    let rect: Rect | undefined
    const extra: Partial<StepSpan> = {}
    if (step.guard) extra.guard = step.guard
    if (step.zoom !== undefined) extra.zoom = step.zoom
    opts.onEvent?.({
      event: 'step',
      phase: 'start',
      i,
      ...(id ? { id } : {}),
      do: step.do,
    })

    const skip = (selector: string, reason?: string) => {
      skipped.push({
        step: i,
        ...(id ? { id } : {}),
        do: step.do,
        selector,
        ...(reason ? { reason } : {}),
      })
      log(`   (${tag}: ${reason ?? `nothing matches ${selector}`}, skipping)`)
    }
    /** An answer that is not a hit: the take stops, or the step is skipped. */
    const missed = (
      answer: Extract<DesktopAnswer, { ok: false }>,
      about: string,
    ) => {
      if (FATAL.has(answer.code)) {
        stopped = { step: i, ...(id ? { id } : {}), reason: answer.message }
        extra.reason = answer.message
        return
      }
      skip(about, answer.code === 'not-found' ? undefined : answer.message)
    }
    /**
     * Waits for a selector to name something, as a page's take waits for
     * visibility. Null when it never did, or when the take cannot go on.
     */
    const find = async (
      selector: string,
      timeoutMs = DESKTOP_FIND_MS,
    ): Promise<Extract<DesktopAnswer, { ok: true }> | null> => {
      const deadline = clock.now() + timeoutMs
      for (;;) {
        const answer = await send({ do: 'locate', selector })
        if (!answer.ok) {
          missed(answer, selector)
          return null
        }
        if ((answer.count ?? 0) > 0) return answer
        if (clock.now() >= deadline) {
          skip(selector)
          return null
        }
        await clock.sleep(DESKTOP_POLL_MS)
      }
    }
    /** A step's target: its selector, once it is there, or its point. */
    const targetOf = async (s: {
      selector?: string
      x?: number
      y?: number
    }): Promise<DesktopTarget | null> => {
      if (s.selector !== undefined) {
        const found = await find(s.selector)
        if (!found) return null
        rect = found.rect
        return { selector: s.selector }
      }
      return { x: s.x!, y: s.y! }
    }
    /** Sends an act; false when it missed (and the miss is recorded). */
    const act = async (command: DesktopCommand, about: string) => {
      const answer = await send(command)
      if (!answer.ok) {
        missed(answer, about)
        return null
      }
      if (answer.rect) rect = answer.rect
      return answer
    }
    const about = (s: { selector?: string; x?: number; y?: number }) =>
      s.selector ?? `${s.x},${s.y}`
    /**
     * What the keys of a `type` would go to, asked before the first one.
     * False when they would be commands there (a row of a tree, a button):
     * the take stops, because the text would rename or press, not write.
     * A session that cannot say (an older helper) is taken at its word.
     */
    const keysWrite = async (): Promise<boolean> => {
      const answer = await send({ do: 'focused' })
      if (!answer.ok) return true
      const on = answer.focused
      if (!on || !KEYS_ARE_COMMANDS.has(on.role)) {
        if (!rect && on?.rect) rect = on.rect
        return true
      }
      const article = /^[aeiou]/.test(on.role) ? 'an' : 'a'
      const what = `${article} ${on.role}${on.name ? ` ("${on.name}")` : ''}`
      const reason = `the keyboard is on ${what}, where typed keys are commands, not text: nothing was typed. Click the field first, or name it in the step`
      stopped = { step: i, ...(id ? { id } : {}), reason }
      extra.reason = reason
      log(`   (${tag}: ${reason})`)
      return false
    }

    switch (step.do) {
      case 'wait':
        await clock.sleep(clampWait(step.ms, now(), maxSeconds))
        break
      case 'move':
        await act({ do: 'move', x: step.x, y: step.y }, about(step))
        break
      case 'hover': {
        const target = await targetOf(step)
        if (!target) break
        if (await act({ do: 'hover', ...target }, about(step)))
          await clock.sleep(step.ms ?? 700)
        break
      }
      case 'click': {
        const target = await targetOf(step)
        if (!target) break
        const answer = await act(
          {
            do: 'click',
            ...target,
            ...(step.count ? { count: step.count } : {}),
            ...(step.button === 'right' ? { button: 'right' as const } : {}),
            ...(step.modifiers
              ? { modifiers: desktopModifiers(step.modifiers) }
              : {}),
          },
          about(step),
        )
        if (!answer) break
        if (answer.pressed === false) {
          disabled.push({
            step: i,
            ...(id ? { id } : {}),
            selector: about(step),
          })
          log(`   (${tag}: ${about(step)} is disabled; it was not pressed)`)
        }
        await clock.sleep(settleMs(step))
        break
      }
      case 'type': {
        if (step.selector !== undefined) {
          const found = await find(step.selector)
          if (!found) break
          rect = found.rect
        }
        const typedInto = step.selector ?? 'where the keyboard is'
        if (step.focus !== false && step.selector !== undefined) {
          const pressed = await act(
            { do: 'click', selector: step.selector },
            step.selector,
          )
          if (!pressed) break
        }
        if (!(await keysWrite())) break
        const before = step.replace
          ? ['Meta+A']
          : step.at === 'end'
            ? ['Meta+ArrowDown']
            : step.at === 'start'
              ? ['Meta+ArrowUp']
              : []
        if (
          before.length &&
          !(await act({ do: 'press', keys: before }, typedInto))
        )
          break
        if (
          !(await act(
            {
              do: 'type',
              text: step.text,
              delayMs: step.delayMs ?? DESKTOP_TYPE_DELAY_MS,
            },
            typedInto,
          ))
        )
          break
        await clock.sleep(settleMs(step))
        break
      }
      case 'press': {
        if (step.selector !== undefined) {
          const found = await find(step.selector)
          if (!found) break
          rect = found.rect
        }
        const chords = pressSequence(step).map(desktopChord)
        let pressedAll = true
        for (let k = 0; k < chords.length; k++) {
          if (k > 0) await clock.sleep(KEY_SEQUENCE_GAP_MS)
          if (!(await act({ do: 'press', keys: chords[k]! }, chords[k]!))) {
            pressedAll = false
            break
          }
        }
        if (pressedAll) await clock.sleep(settleMs(step))
        break
      }
      case 'scroll':
        if (
          await act(
            {
              do: 'scroll',
              dy: step.dy,
              ms: scrollTravelMs(Math.abs(step.dy)),
            },
            'scroll',
          )
        )
          await clock.sleep(settleMs(step))
        break
      case 'drag': {
        const target = await targetOf(step)
        if (!target) break
        if (
          await act(
            {
              do: 'drag',
              ...target,
              to: { x: step.tx!, y: step.ty! },
              ms: step.ms ?? 700,
              ...(step.modifiers
                ? { modifiers: desktopModifiers(step.modifiers) }
                : {}),
            },
            about(step),
          )
        )
          await clock.sleep(DRAG_HOLD_MS)
        break
      }
      case 'expect': {
        const timeoutMs = (step.timeout ?? EXPECT_TIMEOUT_S) * 1000
        const selector =
          step.selector ??
          step.gone ??
          (step.text !== undefined ? textSelector(step.text) : '')
        const said = step.text !== undefined ? `text "${step.text}"` : selector
        const deadline = clock.now() + timeoutMs
        for (;;) {
          const answer = await send({ do: 'locate', selector })
          if (!answer.ok) {
            missed(answer, said)
            break
          }
          const there = (answer.count ?? 0) > 0
          const holds =
            step.gone !== undefined
              ? !there
              : there &&
                (step.enabled === undefined || answer.enabled === step.enabled)
          if (holds) {
            if (there) rect = answer.rect
            break
          }
          if (clock.now() >= deadline) {
            const secs = timeoutMs / 1000
            skip(
              said,
              step.gone !== undefined
                ? `${said} was still there after ${secs} s`
                : there
                  ? `${said} was ${step.enabled ? 'still disabled' : 'still enabled'} after ${secs} s`
                  : `${said} did not appear within ${secs} s`,
            )
            break
          }
          await clock.sleep(DESKTOP_POLL_MS)
        }
        break
      }
      default:
        // `desktopProblems` refuses these before a take begins.
        skip(step.do, `${step.do} is not a step a desktop take runs`)
    }

    // What the step left on screen, when the script asks: an element's name.
    let text: string | null = null
    if (step.read !== undefined && !stopped) {
      const read = await send({ do: 'locate', selector: step.read })
      if (read.ok && read.name) text = read.name
    }
    const didSkip = skipped.length > skippedBefore
    if (step.guard && !didSkip && !stopped && confirm.has(id ?? String(i))) {
      confirmed.push(id ?? String(i))
      extra.confirmed = true
    }
    const selector =
      'selector' in step && step.selector !== undefined
        ? step.selector
        : step.do === 'expect'
          ? (step.gone ?? step.text)
          : undefined
    const r = rect as Rect | undefined
    steps.push({
      step: i,
      ...(id ? { id } : {}),
      do: step.do,
      ...(selector ? { selector } : {}),
      tStart: +(stepStart / 1000).toFixed(3),
      tEnd: +(now() / 1000).toFixed(3),
      ...(didSkip ? { skipped: true } : {}),
      ...(text !== null ? { text } : {}),
      ...(r
        ? {
            rect: {
              x: +r.x.toFixed(1),
              y: +r.y.toFixed(1),
              w: +r.w.toFixed(1),
              h: +r.h.toFixed(1),
            },
          }
        : {}),
      ...extra,
    })
    paces.push({
      step: i,
      do: step.do,
      askedMs: askedMs(step as { do: string; ms?: number }),
      gestureMs: Math.round(gestureMs),
      wallMs: Math.round(now() - stepStart),
    })
    opts.onEvent?.({
      event: 'step',
      phase: 'end',
      i,
      ...(id ? { id } : {}),
      do: step.do,
      ...(didSkip ? { skipped: true } : {}),
    })
    if (stopped) break
    // A step that missed ends a desktop take: the steps after it were written
    // for a state the app is not in, and their keys would land wherever focus
    // is. `"onSkip": "continue"` in the script goes on, as a page's take does.
    const last = skipped[skipped.length - 1]
    const off = disabled[disabled.length - 1]
    const why = didSkip
      ? (last?.reason ?? `nothing matches ${last?.selector ?? 'its target'}`)
      : off && off.step === i
        ? `${off.selector} is disabled, so it was not pressed`
        : null
    if (why && !goesOn) {
      stopped = {
        step: i,
        ...(id ? { id } : {}),
        reason: `${tag} missed (${why}), and a desktop take stops at the first miss so that no later key lands where the script did not mean. "onSkip": "continue" in the script goes on`,
      }
      steps[steps.length - 1]!.reason = stopped.reason
      break
    }
    if (opts.until !== undefined && id === opts.until) {
      reached = true
      break
    }
  }

  // The last step's result stays on screen a moment before the take ends.
  if (!stopped && !capped && opts.until === undefined)
    await clock.sleep(TRAILING_HOLD_MS)
  const pace = paceReport(paces)
  log(`   ${paceLine(pace)}`)
  return {
    steps,
    skipped,
    disabled,
    confirmed,
    pace,
    capped,
    stopped,
    ...(opts.until !== undefined ? { reached } : {}),
  }
}

/** The step verbs a desktop take runs. */
export const DESKTOP_VERBS: readonly ActionStep['do'][] = [
  'wait',
  'hover',
  'click',
  'type',
  'press',
  'scroll',
  'move',
  'drag',
  'expect',
]
