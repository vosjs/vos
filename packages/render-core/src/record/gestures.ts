/**
 * The canvas gestures, the pure parts: key chords and sequences, the
 * modifiers a drag holds, a drawn path and its timing, a click's count and
 * button, and the overrun report. What a whiteboard, a design tool or a
 * timeline is recorded with, said as data so a script can carry it and
 * both hosts validate it in the same words.
 *
 * None of it reaches the cursor track as key identity: a key is a typing
 * ping (when and where), a modifier is nothing at all, and a path is its
 * points.
 */

/** The modifiers a chord or a drag may hold. `Mod` is Meta on macOS, Control elsewhere. */
export const MODIFIERS = [
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'Mod',
  'ControlOrMeta',
] as const
export type Modifier = (typeof MODIFIERS)[number]

/** The modifiers a drag names (the platform-neutral one is `Mod`). */
export const DRAG_MODIFIERS = [
  'Alt',
  'Shift',
  'Meta',
  'Control',
  'Mod',
] as const
export type DragModifier = (typeof DRAG_MODIFIERS)[number]

/** Named keys a chord may end on, besides a single character. */
const NAMED_KEYS = new Set([
  'Escape',
  'Enter',
  'Tab',
  'Backspace',
  'Delete',
  'Insert',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Space',
  'CapsLock',
  'ContextMenu',
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
  'NumpadAdd',
  'NumpadSubtract',
  'NumpadMultiply',
  'NumpadDivide',
  'NumpadDecimal',
  'NumpadEnter',
])

const isModifier = (s: string): s is Modifier =>
  (MODIFIERS as readonly string[]).includes(s)

/** A key name the browser's keyboard answers: a character, a code, a named key. */
export function isKeyName(k: string): boolean {
  if ([...k].length === 1) return k.trim().length === 1 || k === ' '
  if (NAMED_KEYS.has(k)) return true
  return (
    /^Key[A-Z]$/.test(k) ||
    /^Digit[0-9]$/.test(k) ||
    /^Numpad[0-9]$/.test(k) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(k)
  )
}

/**
 * A chord split into its modifiers and its key: `Shift+D` is
 * `{ mods: ['Shift'], key: 'D' }`, a bare `r` has no modifiers, and `+`
 * names the plus key when it ends the chord (`Shift++`).
 */
export function splitChord(chord: string): { mods: string[]; key: string } {
  if (chord === '+') return { mods: [], key: '+' }
  const plusKey = chord.endsWith('++')
  const parts = (plusKey ? chord.slice(0, -2) : chord).split('+')
  if (plusKey) return { mods: parts, key: '+' }
  const key = parts.pop() ?? ''
  return { mods: parts, key }
}

/** Why a chord is not one the recorder can press, or null. */
export function chordProblem(chord: unknown): string | null {
  if (typeof chord !== 'string' || !chord)
    return 'must be a key name or a chord like "Shift+D"'
  const { mods, key } = splitChord(chord)
  for (const m of mods) {
    if (!isModifier(m))
      return `"${chord}": "${m}" is not a modifier (one of ${MODIFIERS.join(', ')})`
  }
  if (new Set(mods).size !== mods.length)
    return `"${chord}" names a modifier twice`
  if (!key) return `"${chord}" ends without a key`
  // A modifier alone is a key: Shift pressed and released.
  if (isModifier(key)) {
    if (mods.length) return `"${chord}" ends on a modifier, not a key`
    return null
  }
  if (!isKeyName(key))
    return `"${chord}": "${key}" is not a key (a single character, a named key like Escape or ArrowLeft, F1 to F24, or a code like KeyA or Digit1)`
  return null
}

/**
 * A chord as the browser's keyboard takes it: `Mod` becomes
 * `ControlOrMeta`, which the browser resolves to Meta on macOS and to
 * Control elsewhere, where the browser runs.
 */
export function resolveChord(chord: string): string {
  const { mods, key } = splitChord(chord)
  const k = key === 'Mod' ? 'ControlOrMeta' : key
  return [...mods.map((m) => (m === 'Mod' ? 'ControlOrMeta' : m)), k].join('+')
}

/** A `press` step's keys as a list: one chord or a sequence. */
export function pressSequence(step: {
  key?: string
  keys?: string | string[]
}): string[] {
  if (step.keys !== undefined)
    return typeof step.keys === 'string' ? [step.keys] : step.keys
  return step.key ? [step.key] : []
}

/** The pause between two keys of a sequence, a person's hand: ms. */
export const KEY_SEQUENCE_GAP_MS = 150
/**
 * What one key costs beyond the script's gaps: the browser's round trip for
 * the press (a keydown and a keyup the page answers). Part of the plan, so a
 * sequence on an idle page is never "slower than scripted".
 */
export const KEY_ROUNDTRIP_MS = 50

/** A key sequence's plan, ms: its gaps, and each key's round trip. */
export const keySequencePlanMs = (keys: number): number =>
  Math.max(0, keys - 1) * KEY_SEQUENCE_GAP_MS + keys * KEY_ROUNDTRIP_MS

/** The hold after a drag's release, ms: the recorder's, part of the gesture. */
export const DRAG_HOLD_MS = 400
/** The most keys one press step may name. */
export const MAX_KEYS = 50

/** A drag modifier as the keyboard holds it. */
export function resolveModifier(m: DragModifier): string {
  return m === 'Mod' ? 'ControlOrMeta' : m
}

/**
 * The modifier bits of a raw pointer event (the pen path): Alt 1, Control
 * 2, Meta 4, Shift 8, with `Mod` read for the platform the browser runs on.
 */
export function modifierBits(
  mods: readonly DragModifier[],
  platform: 'mac' | 'linux' | 'windows' | undefined,
): number {
  let bits = 0
  for (const m of mods) {
    const k = m === 'Mod' ? (platform === 'mac' ? 'Meta' : 'Control') : m
    bits |= k === 'Alt' ? 1 : k === 'Control' ? 2 : k === 'Meta' ? 4 : 8
  }
  return bits
}

/** A click's button, and the pointer button number the cursor track records. */
export const CLICK_BUTTONS = ['left', 'right', 'middle'] as const
export type ClickButton = (typeof CLICK_BUTTONS)[number]
export const buttonNumber = (b: ClickButton | undefined): 0 | 1 | 2 =>
  b === 'right' ? 2 : b === 'middle' ? 1 : 0

/**
 * The pause between the presses of a double or triple click, well inside
 * every platform's double-click interval (500 ms on macOS and Windows by
 * default), so the page reads one gesture.
 */
export const MULTI_CLICK_GAP_MS = 90

/**
 * One point of a drawn path: viewport CSS px, with an optional time in ms
 * (from the path's start) and an optional pressure in [0, 1]. Written as a
 * tuple `[x, y]`, `[x, y, t]`, `[x, y, t, pressure]`, or an object.
 */
export type PathPoint =
  | [number, number]
  | [number, number, number]
  | [number, number, number, number]
  | { x: number; y: number; t?: number; pressure?: number }

/** A path point as the recorder replays it. */
export interface PathSample {
  x: number
  y: number
  /** ms from the path's first point */
  at: number
  pressure?: number
}

/** The most points one path may hold. */
export const MAX_PATH_POINTS = 20_000
/** An untimed path's travel when the step names no ms. */
export const PATH_DEFAULT_MS = 700

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

function readPoint(
  raw: unknown,
): { x: number; y: number; t?: number; pressure?: number } | string {
  if (Array.isArray(raw)) {
    if (raw.length < 2 || raw.length > 4)
      return 'must be [x, y], [x, y, tMs] or [x, y, tMs, pressure]'
    const [x, y, t, pressure] = raw as unknown[]
    if (!finite(x) || !finite(y)) return 'x and y must be numbers (CSS px)'
    if (t !== undefined && !finite(t)) return 'its time must be a number of ms'
    if (pressure !== undefined && !finite(pressure))
      return 'its pressure must be a number from 0 to 1'
    return {
      x,
      y,
      ...(t !== undefined ? { t } : {}),
      ...(pressure !== undefined ? { pressure } : {}),
    }
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>
    const extra = Object.keys(o).filter(
      (k) => !['x', 'y', 't', 'pressure'].includes(k),
    )
    if (extra.length)
      return `takes x, y, t and pressure, not ${extra.join(', ')}`
    if (!finite(o.x) || !finite(o.y)) return 'x and y must be numbers (CSS px)'
    if (o.t !== undefined && !finite(o.t)) return 'its t must be a number of ms'
    if (o.pressure !== undefined && !finite(o.pressure))
      return 'its pressure must be a number from 0 to 1'
    return {
      x: o.x,
      y: o.y,
      ...(o.t !== undefined ? { t: o.t as number } : {}),
      ...(o.pressure !== undefined ? { pressure: o.pressure as number } : {}),
    }
  }
  return 'must be [x, y] or { x, y }'
}

/**
 * A path's points read and checked, or the problems in words. The same
 * reader takes an inline `path` and the contents of a path file (an array
 * of points, or `{ "points": [...] }`).
 */
export function readPath(
  raw: unknown,
): { points: PathSample[]; timed: boolean } | { problems: string[] } {
  const list =
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Array.isArray((raw as { points?: unknown }).points)
      ? (raw as { points: unknown[] }).points
      : raw
  if (!Array.isArray(list))
    return { problems: ['must be an array of points, or { "points": [...] }'] }
  if (list.length < 2) return { problems: ['needs at least two points'] }
  if (list.length > MAX_PATH_POINTS)
    return { problems: [`holds more than ${MAX_PATH_POINTS} points`] }
  const problems: string[] = []
  const read: { x: number; y: number; t?: number; pressure?: number }[] = []
  list.forEach((p, i) => {
    const r = readPoint(p)
    if (typeof r === 'string') problems.push(`point ${i} ${r}`)
    else {
      if (r.x < 0 || r.y < 0)
        problems.push(`point ${i} is off the viewport (x and y are ≥ 0)`)
      if (r.pressure !== undefined && (r.pressure < 0 || r.pressure > 1))
        problems.push(`point ${i} pressure must be from 0 to 1`)
      read.push(r)
    }
  })
  if (problems.length) return { problems: problems.slice(0, 5) }
  const timedCount = read.filter((p) => p.t !== undefined).length
  if (timedCount !== 0 && timedCount !== read.length)
    return {
      problems: [
        'every point carries a time or none does: a path is replayed by its own timing, or evenly over ms',
      ],
    }
  const timed = timedCount > 0
  if (timed) {
    for (let i = 1; i < read.length; i++)
      if ((read[i].t as number) < (read[i - 1].t as number))
        return {
          problems: [`point ${i}'s time runs backwards (times never decrease)`],
        }
  }
  const t0 = timed ? (read[0].t as number) : 0
  return {
    timed,
    points: read.map((p) => ({
      x: p.x,
      y: p.y,
      at: timed ? (p.t as number) - t0 : 0,
      ...(p.pressure !== undefined ? { pressure: p.pressure } : {}),
    })),
  }
}

/**
 * The path's schedule: a timed path keeps its own times (from its first
 * point), an untimed one spreads its points evenly over `ms` (default
 * 700). The last point is at the path's whole duration.
 */
export function schedulePath(
  path: { points: PathSample[]; timed: boolean },
  ms: number | undefined,
): PathSample[] {
  if (path.timed) return path.points
  const dur = ms ?? PATH_DEFAULT_MS
  const n = path.points.length
  return path.points.map((p, i) => ({
    ...p,
    at: n > 1 ? Math.round((dur * i) / (n - 1)) : 0,
  }))
}

/** How long a scheduled path takes, ms. */
export const pathDurationMs = (s: readonly PathSample[]): number =>
  s.length ? s[s.length - 1].at : 0

/**
 * A paced gesture that ran past its script: the wall time it took against
 * the time the script planned for it (a drag's travel, a path's timing,
 * typing's characters × delay, a key sequence's gaps). Reported when the
 * gesture took more than a fifth longer, the sign of a page that could not
 * keep up with what it was sent.
 */
export interface StepOverrun {
  step: number
  id?: string
  do: string
  plannedMs: number
  tookMs: number
  overrunMs: number
}

/** The share past the plan that counts as an overrun. */
export const OVERRUN_SHARE = 0.2
/** A plan shorter than this is not measured: its noise is the round trip. */
export const OVERRUN_MIN_PLANNED_MS = 100

/** The overrun, ms, or null when the gesture kept to its plan. */
export function overrunOf(plannedMs: number, tookMs: number): number | null {
  if (!(plannedMs >= OVERRUN_MIN_PLANNED_MS)) return null
  if (tookMs <= plannedMs * (1 + OVERRUN_SHARE)) return null
  return Math.round(tookMs - plannedMs)
}

/** The overruns in one line for the log and the done event, or null when none. */
export function overrunLine(overruns: readonly StepOverrun[]): string | null {
  if (!overruns.length) return null
  const planned = overruns.reduce((a, o) => a + o.plannedMs, 0)
  const took = overruns.reduce((a, o) => a + o.tookMs, 0)
  const ratio = planned > 0 ? took / planned : 0
  const n = overruns.length
  const which = overruns
    .map((o) => `#${o.step}${o.id ? ` (${o.id})` : ''} ${o.do}`)
    .join(', ')
  return `${n} step${n === 1 ? '' : 's'} ran ${ratio.toFixed(1)}× slower than scripted (${which}): the page could not keep up; add settle or raise ms`
}
