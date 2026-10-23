import type { MaskRule } from './exposure'
import type { SetupStep } from './setup'
import { urlSchemeProblem, validateSetup } from './setup'
import type { ClickButton, DragModifier, PathPoint } from './gestures'
import {
  CLICK_BUTTONS,
  DRAG_MODIFIERS,
  MAX_KEYS,
  chordProblem,
  readPath,
} from './gestures'
import { pasteTypeOf } from './paste'
import { SETTLE_VERBS } from './settle'

/**
 * The action script — the declarative recipe an agent (or human) writes to
 * drive a take. Small on purpose: selectors + a handful of verbs. The recorder
 * executes it with humanized cursor motion and synthesizes the CursorTrack
 * from its own dispatches.
 */
export interface ActionsFile {
  /** Page to record. `--url` overrides. */
  url?: string
  /** Recording viewport in CSS px (default 1280x720). */
  viewport?: { width: number; height: number }
  /**
   * Hidden BEFORE the first frame is captured and kept hidden across
   * navigations: what a signed-in account shows that must not ship. `blur`
   * (default) blurs the element; `text` swaps its words for `text`, which is
   * for IDENTIFIERS (an email, a name, an account id), never for product
   * copy or numbers: the video must stay true to the product.
   */
  mask?: MaskRule[]
  /**
   * Run BEFORE the camera rolls, after the first navigation: a sign-in form,
   * a cookie banner, an onboarding tour. Plain actions with no cursor, no
   * frames, no pace and nothing in `meta.steps`; then the recorder opens
   * `url` again and the take begins where the setup left it. A `type`
   * step's text may be `{ env: 'NAME' }`, read at run time and never logged
   * or stored.
   */
  setup?: SetupStep[]
  /**
   * Every gesture waits on the app after it (`settle` on a step overrides):
   * a canvas that falls behind under load finishes the last stroke before
   * the next one starts.
   */
  settle?: boolean
  steps: ActionStep[]
}

export type ActionStep = (
  | { do: 'wait'; ms: number }
  /**
   * Rest the pointer on `selector`'s centre, or on the viewport point
   * (`x`, `y`) when no selector names the spot (a place on a canvas).
   */
  | { do: 'hover'; selector?: string; x?: number; y?: number; ms?: number }
  /**
   * Press `selector`'s centre, or the viewport point (`x`, `y`). `ms` is
   * the settle after the press (default 150). `count` 2 or 3 is a real
   * double or triple click; `button` presses the right or middle one;
   * `modifiers` are held for the press (a Shift-click) and released after.
   */
  | {
      do: 'click'
      selector?: string
      x?: number
      y?: number
      ms?: number
      count?: 1 | 2 | 3
      button?: ClickButton
      modifiers?: DragModifier[]
    }
  /**
   * Type into `selector`. The recorder clicks the field first, which is what
   * opens the typing zoom on it; `focus: false` types into the field as it is
   * already focused, for a keystroke that follows earlier typing (a submitting
   * Enter) rather than starting it — a second click there rings a click effect
   * on empty space beside the text.
   */
  | {
      do: 'type'
      selector: string
      text: string
      delayMs?: number
      focus?: boolean
      /**
       * Select the field's value before typing, so what is typed REPLACES
       * it (a form that opens filled in, a search box with the last query).
       */
      replace?: boolean
      /**
       * Where the caret goes after the focusing click, before the first
       * character: `end` or `start` of the field (a code editor line is
       * typed at its end; a click lands the caret where the pointer hit).
       */
      at?: 'end' | 'start'
      /** the settle after the last character (default 150) */
      ms?: number
    }
  /**
   * A key, a chord or a sequence, each recorded as a typing ping where the
   * pointer is (or on `selector` when given, with no click), never as the
   * key itself. `key` names one control key (Escape closes what a click
   * opened, Enter submits what was typed); `keys` names a chord
   * (`"Shift+D"`, `"Mod+Z"`, with `Mod` Meta on macOS and Control
   * elsewhere), a plain key (`"r"`, a tool's shortcut) or a sequence
   * (`["v", "Escape"]`). Words are typed with `type`.
   */
  | {
      do: 'press'
      key?: PressKey
      keys?: string | string[]
      selector?: string
      ms?: number
    }
  /** `ms` is the settle after the scroll lands (default 200). */
  | { do: 'scroll'; dy: number; ms?: number }
  | { do: 'move'; x: number; y: number }
  /**
   * Press-move-release — real edits (drag an element on the stage canvas,
   * slide a range input, move a timeline clip). Start = the selector's center
   * when given, else (x, y); end = (tx, ty); eased over ms (default 700).
   * `path` draws instead: viewport points (inline, or a file beside the
   * actions file), the press at the first and the release at the last,
   * replayed by the points' own times or evenly over ms. `modifiers` are
   * held for the whole drag.
   */
  | {
      do: 'drag'
      selector?: string
      x?: number
      y?: number
      tx?: number
      ty?: number
      path?: PathPoint[] | string
      modifiers?: DragModifier[]
      ms?: number
    }
  /**
   * Put words or a file (an image, an SVG) on the clipboard and paste it
   * the way a person's ⌘V does, into `selector` (clicked first) or where
   * the focus is. A file is read beside the actions file, by a plain name.
   */
  | {
      do: 'paste'
      selector?: string
      text?: string
      file?: string
      ms?: number
    }
  /**
   * Check that the page is as the flow expects, with no cursor move: an
   * element visible (`selector`; with `enabled`, enabled or disabled), some
   * visible text containing `text`, or `gone` no longer visible. Exactly
   * one of the three. Waits up to `timeout` seconds (default 5); a
   * condition that never holds is a skip with its reason.
   */
  | {
      do: 'expect'
      selector?: string
      text?: string
      gone?: string
      enabled?: boolean
      timeout?: number
    }
  /**
   * Wait OFF CAMERA for something slow (a render, a generated result, a
   * deploy): the capture stops, the predicate is polled every `poll`
   * seconds (default 2) for up to `timeout` (default 600), reloading the
   * page between polls when `reload` is set, and the capture resumes when
   * it holds. The footage has no gap and no frozen stretch; the cut lands
   * in `meta.skips[]`. On timeout, `onTimeout: "fail"` (the default) stops
   * the take and `"continue"` resumes it.
   */
  | {
      do: 'await'
      until: AwaitUntil
      timeout?: number
      poll?: number
      reload?: boolean
      onTimeout?: 'fail' | 'continue'
    }
  /**
   * Keep a file the page makes: click `selector` and wait for the
   * browser's download, or fetch the `currentSrc` of the video, audio or
   * img element `src` names, with the page's own cookies. Saved under the
   * take's `outputs/` as `as`, else the name the page suggested, and listed
   * in `meta.outputs[]`.
   */
  | { do: 'download'; selector?: string; src?: string; as?: string }
) & {
  /**
   * `"spend"`: the step costs something real (credits, a purchase, a
   * message sent). Only a click, a press or a type carries it, and it
   * needs an `id`. A rehearsal hovers it and never presses it; a recording
   * presses it only when the command names it (`--confirm <id>`) and
   * refuses before capturing anything otherwise.
   */
  guard?: StepGuard
  /**
   * Optional stable identity: anchors in doc.json name a step by this
   * id (else by index), so a step can move or gain neighbours across script
   * edits without breaking the cut anchored to it. Unique when present.
   */
  id?: string
  /**
   * A beat's caption, two to eight words: `vos deliver` lands it as a
   * lower-third at this step's moment on the cuts that take words, and
   * `vos actions script` leads the beat with it.
   */
  caption?: string
  /**
   * A selector whose words the recorder keeps once the step has settled
   * (`meta.steps[].text`: trimmed, whitespace collapsed, at most 2 KB), so
   * a layer quotes the take instead of a replay: the URL a share button
   * minted, the code a dialog printed, the status a request answered. On
   * a click it reads after the click's settle, so what the click opened is
   * what is read. Only what the flow names, never a secret it did not.
   */
  read?: string
  /**
   * After the gesture, wait until the page has made no DOM change and
   * painted no new frame for a beat (at most a few seconds): an app that
   * falls behind catches up before the next step. The script's top-level
   * `settle` is the default.
   */
  settle?: boolean
}

/** What an `await` waits for: exactly one of the three. */
export interface AwaitUntil {
  selector?: string
  text?: string
  gone?: string
}

/** The guards a step may carry: one today, a step that spends. */
export const STEP_GUARDS = ['spend'] as const
export type StepGuard = (typeof STEP_GUARDS)[number]

/** The verbs a guard may sit on: the ones that commit something. */
const GUARDABLE = new Set(['click', 'press', 'type'])

/** How long an `expect` waits by default, in seconds. */
export const EXPECT_TIMEOUT_S = 5
/** An `await`'s defaults, in seconds. */
export const AWAIT_TIMEOUT_S = 600
export const AWAIT_POLL_S = 2
/** How long a `download` click waits for the browser's download, in seconds. */
export const DOWNLOAD_TIMEOUT_S = 30

const VERBS = new Set([
  'wait',
  'hover',
  'click',
  'type',
  'press',
  'scroll',
  'move',
  'drag',
  'expect',
  'await',
  'download',
  'paste',
])

/** The keys a `press` step may name: navigation and control, never a character. */
export const PRESS_KEYS = [
  'Escape',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Space',
] as const
export type PressKey = (typeof PRESS_KEYS)[number]

/** Structural validation with actionable messages. Returns [] when valid. */
export function validateActions(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null)
    return ['actions file must be a JSON object']
  const obj = value as Record<string, unknown>
  if (obj.url !== undefined) {
    if (typeof obj.url !== 'string') errors.push('url must be a string')
    else {
      const problem = urlSchemeProblem(obj.url)
      if (problem) errors.push(`url ${problem}`)
    }
  }
  if (obj.viewport !== undefined) {
    const v: unknown = obj.viewport
    if (typeof v !== 'object' || v === null) {
      errors.push('viewport must be { width, height }')
    } else {
      const vp = v as Record<string, unknown>
      if (typeof vp.width !== 'number' || typeof vp.height !== 'number') {
        errors.push('viewport must be { width, height }')
      }
    }
  }
  if (obj.setup !== undefined) errors.push(...validateSetup(obj.setup))
  if (obj.settle !== undefined && typeof obj.settle !== 'boolean')
    errors.push('settle must be true or false')
  if (obj.mask !== undefined) {
    if (!Array.isArray(obj.mask)) {
      errors.push('mask must be an array of { selector, as?, text? }')
    } else {
      obj.mask.forEach((raw, i) => {
        const at = `mask[${i}]`
        const m = (raw ?? {}) as Record<string, unknown>
        if (typeof m.selector !== 'string' || !m.selector.trim())
          errors.push(`${at}: needs a selector`)
        if (m.as !== undefined && m.as !== 'blur' && m.as !== 'text')
          errors.push(`${at}: as must be "blur" or "text"`)
        if (m.as === 'text' && (typeof m.text !== 'string' || !m.text))
          errors.push(`${at}: as "text" needs the text to show instead`)
        if (m.as !== 'text' && m.text !== undefined)
          errors.push(`${at}: text is only read with as "text"`)
      })
    }
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    errors.push('steps must be a non-empty array')
    return errors
  }
  const seenIds = new Set<string>()
  obj.steps.forEach((raw, i) => {
    const at = `steps[${i}]`
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`${at}: must be an object`)
      return
    }
    const s = raw as Record<string, unknown>
    if (s.read !== undefined && (typeof s.read !== 'string' || !s.read.trim()))
      errors.push(`${at}: read must be a selector`)
    if (typeof s.do !== 'string' || !VERBS.has(s.do)) {
      errors.push(`${at}: "do" must be one of ${[...VERBS].join(', ')}`)
      return
    }
    if (s.id !== undefined) {
      if (typeof s.id !== 'string' || !s.id.trim()) {
        errors.push(`${at}: id must be a non-empty string`)
      } else if (seenIds.has(s.id)) {
        errors.push(
          `${at}: duplicate id "${s.id}" — an anchor could not tell the two steps apart`,
        )
      } else {
        seenIds.add(s.id)
      }
    }
    if (s.do === 'type' && typeof s.selector !== 'string')
      errors.push(`${at}: type needs a selector`)
    if (s.do === 'hover' || s.do === 'click') {
      const point = s.x !== undefined || s.y !== undefined
      if (point && s.selector !== undefined)
        errors.push(
          `${at}: ${s.do} takes a selector or x and y (a viewport point), not both`,
        )
      else if (point) {
        if (!isCoord(s.x) || !isCoord(s.y))
          errors.push(
            `${at}: ${s.do} x and y must both be numbers of CSS px, 0 or more`,
          )
      } else if (typeof s.selector !== 'string')
        errors.push(
          `${at}: ${s.do} needs a selector, or x and y (a viewport point)`,
        )
    }
    if (s.do === 'wait' && typeof s.ms !== 'number')
      errors.push(`${at}: wait needs ms`)
    if (
      s.ms !== undefined &&
      (typeof s.ms !== 'number' || !Number.isFinite(s.ms) || s.ms < 0)
    )
      errors.push(`${at}: ms must be a number of milliseconds ≥ 0`)
    if (s.do === 'type' && typeof s.text !== 'string')
      errors.push(`${at}: type needs text`)
    if (
      s.do === 'type' &&
      s.focus !== undefined &&
      typeof s.focus !== 'boolean'
    )
      errors.push(`${at}: type focus must be true or false`)
    if (
      s.do === 'type' &&
      s.replace !== undefined &&
      typeof s.replace !== 'boolean'
    )
      errors.push(`${at}: type replace must be true or false`)
    if (
      s.do === 'type' &&
      s.at !== undefined &&
      s.at !== 'end' &&
      s.at !== 'start'
    )
      errors.push(`${at}: type at must be "end" or "start"`)
    if (s.do === 'press') {
      if (s.key !== undefined && s.keys !== undefined)
        errors.push(
          `${at}: press takes key or keys, not both (keys says everything key does)`,
        )
      else if (s.keys !== undefined) {
        const list: unknown[] = Array.isArray(s.keys) ? s.keys : [s.keys]
        if (!list.length)
          errors.push(`${at}: press keys must name at least one key`)
        else if (list.length > MAX_KEYS)
          errors.push(`${at}: press keys names more than ${MAX_KEYS} keys`)
        list.forEach((k, j) => {
          const problem = chordProblem(k)
          if (problem)
            errors.push(
              `${at}: press keys${Array.isArray(s.keys) ? `[${j}]` : ''} ${problem}`,
            )
        })
      } else if (
        typeof s.key !== 'string' ||
        !(PRESS_KEYS as readonly string[]).includes(s.key)
      )
        errors.push(
          `${at}: press needs a key, one of ${PRESS_KEYS.join(', ')}, or keys (a chord like "Shift+D", a plain key like "r", or a sequence); words are typed with type`,
        )
      if (s.selector !== undefined && typeof s.selector !== 'string')
        errors.push(`${at}: press selector must be a string`)
    }
    if (s.do === 'click') {
      errors.push(...modifiersProblem(at, 'click', s.modifiers))
      if (
        s.count !== undefined &&
        s.count !== 1 &&
        s.count !== 2 &&
        s.count !== 3
      )
        errors.push(
          `${at}: click count must be 1, 2 (a double click) or 3 (a triple click)`,
        )
      if (
        s.button !== undefined &&
        !(CLICK_BUTTONS as readonly unknown[]).includes(s.button)
      )
        errors.push(`${at}: click button must be "left", "right" or "middle"`)
    }
    if (s.settle !== undefined) {
      if (typeof s.settle !== 'boolean')
        errors.push(`${at}: settle must be true or false`)
      else if (!SETTLE_VERBS.has(s.do))
        errors.push(
          `${at}: settle follows a gesture (hover, click, type, press, scroll, move, drag, paste); a ${s.do} sends the page nothing to catch up on`,
        )
    }
    if (s.do === 'paste') {
      const given = (['text', 'file'] as const).filter(
        (k) => s[k] !== undefined,
      )
      if (given.length !== 1)
        errors.push(
          `${at}: paste needs exactly one of text (words) or file (an image, an SVG or a text file beside the actions file)`,
        )
      if (s.text !== undefined && typeof s.text !== 'string')
        errors.push(`${at}: paste text must be a string`)
      if (s.file !== undefined) {
        const problem =
          typeof s.file === 'string'
            ? (fileNameProblem(s.file) ??
              (pasteTypeOf(s.file)
                ? null
                : `"${s.file}" is not a type a paste takes (.png, .jpg, .webp, .gif, .svg, .txt, .md, .html, .json, .csv)`))
            : 'is not a string'
        if (problem) errors.push(`${at}: paste file ${problem}`)
      }
      if (s.selector !== undefined && !isFilled(s.selector))
        errors.push(`${at}: paste selector must be a non-empty string`)
    }
    if (s.do === 'scroll' && typeof s.dy !== 'number')
      errors.push(`${at}: scroll needs dy`)
    if (
      s.do === 'move' &&
      (typeof s.x !== 'number' || typeof s.y !== 'number')
    ) {
      errors.push(`${at}: move needs x and y (CSS px)`)
    }
    if (s.guard !== undefined) {
      if (!(STEP_GUARDS as readonly unknown[]).includes(s.guard))
        errors.push(
          `${at}: guard must be ${STEP_GUARDS.map((g) => `"${g}"`).join(' or ')}`,
        )
      else if (!GUARDABLE.has(s.do))
        errors.push(
          `${at}: guard sits on a click, a press or a type, the steps that commit something; a ${s.do} spends nothing`,
        )
      else if (typeof s.id !== 'string' || !s.id.trim())
        errors.push(
          `${at}: a guarded step needs an id, which is what --confirm <id> names`,
        )
    }
    if (s.do === 'expect') {
      const given = (['selector', 'text', 'gone'] as const).filter(
        (k) => s[k] !== undefined,
      )
      if (given.length !== 1)
        errors.push(
          `${at}: expect needs exactly one of selector, text or gone${given.length ? ` (it has ${given.join(' and ')})` : ''}`,
        )
      for (const k of given)
        if (!isFilled(s[k]))
          errors.push(`${at}: expect ${k} must be a non-empty string`)
      if (s.enabled !== undefined) {
        if (typeof s.enabled !== 'boolean')
          errors.push(`${at}: expect enabled must be true or false`)
        else if (s.selector === undefined)
          errors.push(
            `${at}: expect enabled is about the selector's element, so it needs a selector`,
          )
      }
      errors.push(...secondsProblem(at, 'expect timeout', s.timeout))
    }
    if (s.do === 'await') {
      const u = s.until
      if (typeof u !== 'object' || u === null || Array.isArray(u)) {
        errors.push(
          `${at}: await needs until, one of { "selector" }, { "text" } or { "gone" }`,
        )
      } else {
        const until = u as Record<string, unknown>
        const keys = Object.keys(until)
        const known: string[] = keys.filter(
          (k) => k === 'selector' || k === 'text' || k === 'gone',
        )
        const unknown = keys.filter((k) => !known.includes(k))
        if (unknown.length)
          errors.push(
            `${at}: await until takes selector, text or gone, not ${unknown.join(', ')}`,
          )
        if (known.length !== 1)
          errors.push(
            `${at}: await until needs exactly one of selector, text or gone${known.length ? ` (it has ${known.join(' and ')})` : ''}`,
          )
        for (const k of known) {
          const v = until[k]
          if (typeof v !== 'string' || !v.trim())
            errors.push(`${at}: await until.${k} must be a non-empty string`)
        }
      }
      errors.push(...secondsProblem(at, 'await timeout', s.timeout))
      errors.push(...secondsProblem(at, 'await poll', s.poll))
      if (s.reload !== undefined && typeof s.reload !== 'boolean')
        errors.push(`${at}: await reload must be true or false`)
      if (
        s.onTimeout !== undefined &&
        s.onTimeout !== 'fail' &&
        s.onTimeout !== 'continue'
      )
        errors.push(`${at}: await onTimeout must be "fail" or "continue"`)
    }
    if (s.do === 'download') {
      const given = (['selector', 'src'] as const).filter(
        (k) => s[k] !== undefined,
      )
      if (given.length !== 1)
        errors.push(
          `${at}: download needs exactly one of selector (a control that downloads) or src (a video, audio or img element whose source is fetched)`,
        )
      for (const k of given)
        if (!isFilled(s[k]))
          errors.push(`${at}: download ${k} must be a non-empty string`)
      if (s.as !== undefined) {
        const problem =
          typeof s.as === 'string' ? fileNameProblem(s.as) : 'is not a string'
        if (problem) errors.push(`${at}: download as ${problem}`)
      }
    }
    if (s.do === 'drag') {
      if (s.path !== undefined) {
        const clash = (['selector', 'x', 'y', 'tx', 'ty'] as const).filter(
          (k) => s[k] !== undefined,
        )
        if (clash.length)
          errors.push(
            `${at}: a drag with a path starts at its first point and ends at its last, so it takes no ${clash.join(', ')}`,
          )
        if (typeof s.path === 'string') {
          const problem = fileNameProblem(s.path)
          if (problem)
            errors.push(
              `${at}: drag path ${problem} (a file beside the actions file)`,
            )
        } else {
          const read = readPath(s.path)
          if ('problems' in read)
            for (const p of read.problems) errors.push(`${at}: drag path ${p}`)
        }
      } else {
        if (typeof s.tx !== 'number' || typeof s.ty !== 'number') {
          errors.push(`${at}: drag needs tx and ty (CSS px), or a path`)
        }
        const hasStart =
          typeof s.selector === 'string' ||
          (typeof s.x === 'number' && typeof s.y === 'number')
        if (!hasStart)
          errors.push(
            `${at}: drag needs a selector OR x and y as the start point`,
          )
      }
      errors.push(...modifiersProblem(at, 'drag', s.modifiers))
    }
  })
  return errors
}

const isCoord = (v: unknown): boolean =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0

/** The modifiers a click or a drag holds, checked in the same words for both. */
function modifiersProblem(at: string, verb: string, v: unknown): string[] {
  if (v === undefined) return []
  if (
    !Array.isArray(v) ||
    v.some((m) => !(DRAG_MODIFIERS as readonly unknown[]).includes(m))
  )
    return [
      `${at}: ${verb} modifiers must be a list of ${DRAG_MODIFIERS.map((m) => `"${m}"`).join(', ')} (Mod is Meta on macOS, Control elsewhere)`,
    ]
  if (new Set(v).size !== v.length)
    return [`${at}: ${verb} modifiers names a modifier twice`]
  return []
}

const isFilled = (v: unknown): boolean =>
  typeof v === 'string' && v.trim().length > 0

function secondsProblem(at: string, what: string, v: unknown): string[] {
  if (v === undefined) return []
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
    return [`${at}: ${what} must be a number of seconds above 0`]
  return []
}

/**
 * Why a name is not one a download may be saved under, or null. A plain
 * file name only: the file lands in the take's `outputs/` and nowhere
 * else, so no separator, no `..`, nothing hidden, nothing empty.
 */
export function fileNameProblem(name: string): string | null {
  if (!name.trim()) return 'must be a file name'
  if (/[/\\]/.test(name))
    return `"${name}" must be a plain file name, with no path separator`
  if (name.includes('..'))
    return `"${name}" must be a plain file name, with no ".."`
  if (name.startsWith('.')) return `"${name}" must not be a hidden file`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name))
    return `"${name}" must not hold control characters`
  if (name.length > 200) return 'must be at most 200 characters'
  return null
}

/** A guarded step of a script: where it is, what it is, the id that confirms it. */
export interface GuardedStep {
  step: number
  id: string
  do: string
  guard: StepGuard
}

/** The guarded steps of a script, in order. */
export function guardedSteps(
  actions: Pick<ActionsFile, 'steps'>,
): GuardedStep[] {
  const out: GuardedStep[] = []
  actions.steps.forEach((s, i) => {
    if (s.guard)
      out.push({ step: i, id: s.id ?? String(i), do: s.do, guard: s.guard })
  })
  return out
}

/**
 * Whether a recording may run with the confirmations it was given: every
 * guarded step named by `--confirm`, and every name a guarded step. A
 * refusal is one sentence naming the steps and the flag, said before
 * anything is captured.
 */
export function guardVerdict(
  actions: Pick<ActionsFile, 'steps'>,
  confirm: readonly string[],
):
  | { ok: true }
  | { ok: false; unconfirmed: string[]; unknown: string[]; message: string } {
  const guarded = guardedSteps(actions)
  const unconfirmed = guarded.filter((g) => !confirm.includes(g.id))
  const unknown = confirm.filter((c) => !guarded.some((g) => g.id === c))
  if (!unconfirmed.length && !unknown.length) return { ok: true }
  const parts: string[] = []
  if (unconfirmed.length) {
    const one = unconfirmed.length === 1
    parts.push(
      `${unconfirmed.map((g) => `#${g.step} ${g.id} (${g.do})`).join(', ')} ${one ? 'is' : 'are'} guarded (${unconfirmed[0].guard}): ${one ? 'it spends' : 'they spend'} something real, so the recorder presses ${one ? 'it' : 'them'} only when the command says so. Add ${unconfirmed.map((g) => `--confirm ${g.id}`).join(' ')} to record ${one ? 'it' : 'them'}, or rehearse with --dry-run, which hovers and never presses`,
    )
  }
  if (unknown.length)
    parts.push(
      `${unknown.map((c) => `--confirm ${c}`).join(', ')} names no guarded step${guarded.length ? ` (the guarded ones: ${guarded.map((g) => g.id).join(', ')})` : ''}`,
    )
  return {
    ok: false,
    unconfirmed: unconfirmed.map((g) => g.id),
    unknown,
    message: `${parts.join('. ')}. Nothing was recorded.`,
  }
}

/**
 * What a hosted recorder cannot do with a script, in words, or []: a
 * guarded step has nobody to confirm it on a fleet, and a download has no
 * take directory to land in there.
 */
export function hostedRefusals(actions: Pick<ActionsFile, 'steps'>): string[] {
  const out: string[] = []
  for (const g of guardedSteps(actions))
    out.push(
      `steps[${g.step}] (${g.id}) is guarded (${g.guard}), and a hosted take has no way to confirm it: record it on this machine with --confirm ${g.id}`,
    )
  actions.steps.forEach((s, i) => {
    if (s.do === 'download')
      out.push(
        `steps[${i}] is a download, which a hosted take does not keep: record it on this machine, where the file lands in the take's outputs/`,
      )
    if (s.do === 'paste')
      out.push(
        `steps[${i}] is a paste, and a hosted browser has no clipboard to paste from: record it on this machine`,
      )
    if (s.do === 'drag' && typeof s.path === 'string')
      out.push(
        `steps[${i}] draws a path from the file "${s.path}", and a hosted take carries the script alone: write the points inline as path`,
      )
  })
  return out
}

/**
 * The files a script names beside itself, in order: a drag's path file
 * and a paste's file. A host reads them before anything is captured.
 */
export function scriptFiles(
  actions: Pick<ActionsFile, 'steps'>,
): { step: number; name: string; as: 'path' | 'paste' }[] {
  const out: { step: number; name: string; as: 'path' | 'paste' }[] = []
  actions.steps.forEach((s, i) => {
    if (s.do === 'drag' && typeof s.path === 'string')
      out.push({ step: i, name: s.path, as: 'path' })
    if (s.do === 'paste' && typeof s.file === 'string')
      out.push({ step: i, name: s.file, as: 'paste' })
  })
  return out
}
