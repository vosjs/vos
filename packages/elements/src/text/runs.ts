/**
 * Styled text as a list of runs, and every edit made to one.
 *
 * A text layer's words are a string, or a list of RUNS: a piece of text and
 * the ways it departs from the layer's own style. There is no markup in the
 * words and no offset on the wire; a run names its text and its style in
 * the layer's own field names.
 *
 * The functions here are what an editor does to that list. They take
 * offsets into the PLAIN text (UTF-16 units, what a text field reports as
 * its selection), never let a style split a grapheme, and always hand back
 * the canonical form: neighbours set alike are one run, an empty run is
 * gone, and text with no style left is a string again.
 */
import { graphemesOf } from './layout'
import type { LayoutRun } from './layout'

/** How a run departs from its layer's style. Absent = the layer's own. */
export interface TextRunStyle {
  /** Font weight, snapped to the family's hosted steps like the layer's. */
  weight?: number
  /** Italic on, or (on an italic layer) off. */
  italic?: boolean
  /** Fill colour. */
  color?: string
  underline?: boolean
  strike?: boolean
  /** A colour behind the run. */
  highlight?: string
}

export interface TextRun extends TextRunStyle {
  /** The words. May hold line breaks. */
  text: string
}

/** A text layer's words: plain, or styled. */
export type RichText = string | TextRun[]

export const RUN_STYLE_KEYS = [
  'weight',
  'italic',
  'color',
  'underline',
  'strike',
  'highlight',
] as const
export type RunStyleKey = (typeof RUN_STYLE_KEYS)[number]

/** A style field's value over a selection that does not agree on it. */
export const MIXED = 'mixed'

/** The words alone: what a person reads, and what every label shows. */
export function plainText(text: RichText): string {
  if (typeof text === 'string') return text
  let out = ''
  for (const r of text) out += r.text
  return out
}

/** The list form of either shape (a string is one unstyled run). */
export function runsOf(text: RichText): TextRun[] {
  return typeof text === 'string' ? (text ? [{ text }] : []) : text
}

/** A run's style alone, without fields that say nothing. */
export function styleOf(run: TextRunStyle): TextRunStyle {
  const out: TextRunStyle = {}
  if (typeof run.weight === 'number') out.weight = run.weight
  // `italic: false` says something (upright words on an italic layer).
  if (typeof run.italic === 'boolean') out.italic = run.italic
  if (run.color) out.color = run.color
  if (run.underline) out.underline = true
  if (run.strike) out.strike = true
  if (run.highlight) out.highlight = run.highlight
  return out
}

const sameStyle = (a: TextRunStyle, b: TextRunStyle) =>
  RUN_STYLE_KEYS.every((k) => a[k] === b[k])

const isStyled = (s: TextRunStyle) =>
  RUN_STYLE_KEYS.some((k) => s[k] !== undefined)

/**
 * The canonical form: empty runs dropped, fields that say nothing dropped,
 * neighbours set alike merged, and a string when no style is left.
 */
export function normalizeRuns(text: RichText): RichText {
  if (typeof text === 'string') return text
  const out: TextRun[] = []
  for (const r of text) {
    if (typeof r.text !== 'string' || !r.text) continue
    const style = styleOf(r)
    const last = out[out.length - 1] as TextRun | undefined
    if (last && sameStyle(last, style)) last.text += r.text
    else out.push({ text: r.text, ...style })
  }
  if (!out.length) return ''
  if (out.length === 1 && !isStyled(out[0])) return out[0].text
  return out
}

/**
 * Whatever was handed in, as styled text. The guard at a boundary that takes
 * text from outside (a config, a message, a tween's write): a list keeps the
 * runs that are runs and the fields that are of their type, and anything
 * that is not a list becomes its words. Canonical, like `normalizeRuns`.
 */
export function toRichText(value: unknown): RichText {
  if (!Array.isArray(value)) return value == null ? '' : String(value)
  const runs: TextRun[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.text !== 'string') continue
    const run: TextRun = { text: r.text }
    if (typeof r.weight === 'number' && Number.isFinite(r.weight))
      run.weight = r.weight
    if (typeof r.italic === 'boolean') run.italic = r.italic
    if (typeof r.color === 'string' && r.color) run.color = r.color
    if (r.underline === true) run.underline = true
    if (r.strike === true) run.strike = true
    if (typeof r.highlight === 'string' && r.highlight)
      run.highlight = r.highlight
    runs.push(run)
  }
  return normalizeRuns(runs)
}

/**
 * Styled text as the layout takes it: source lines (split at every line
 * break), each a list of runs. `fontOf` names the font a run is set in as an
 * index into the caller's own table (0, the base font, for a run that
 * departs in neither weight nor slant); colour and decorations ride as they
 * are. An empty line is an empty list.
 */
export function layoutLines(
  text: RichText,
  fontOf: (style: TextRunStyle) => number,
): LayoutRun[][] {
  const lines: LayoutRun[][] = [[]]
  for (const run of runsOf(text)) {
    const f = fontOf(run)
    const set: Omit<LayoutRun, 't'> = {
      ...(f ? { f } : {}),
      ...(run.color ? { c: run.color } : {}),
      ...(run.underline ? { u: 1 as const } : {}),
      ...(run.strike ? { s: 1 as const } : {}),
      ...(run.highlight ? { h: run.highlight } : {}),
    }
    run.text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ t: part, ...set })
    })
  }
  return lines
}

/** The nearest grapheme boundary at or before (`-1`) or after (`1`) an offset. */
export function snapOffset(plain: string, offset: number, dir: -1 | 1): number {
  const o = Math.max(0, Math.min(plain.length, offset))
  let at = 0
  for (const g of graphemesOf(plain)) {
    const next = at + g.length
    if (o === at) return at
    if (o < next) return dir < 0 ? at : next
    at = next
  }
  return plain.length
}

/** The runs between two offsets (unnormalized: for building, not storing). */
export function sliceRuns(
  text: RichText,
  start: number,
  end: number,
): TextRun[] {
  const out: TextRun[] = []
  let at = 0
  for (const r of runsOf(text)) {
    const from = Math.max(start, at)
    const to = Math.min(end, at + r.text.length)
    if (to > from) out.push({ ...r, text: r.text.slice(from - at, to - at) })
    at += r.text.length
    if (at >= end) break
  }
  return out
}

/** The style of the character AT an offset (the layer's own past the end). */
function styleOfChar(text: RichText, offset: number): TextRunStyle {
  let at = 0
  for (const r of runsOf(text)) {
    if (offset < at + r.text.length) return styleOf(r)
    at += r.text.length
  }
  return {}
}

/**
 * The style typing at a caret takes: the character before it, or the one
 * after it at the very start.
 */
export function styleAt(text: RichText, offset: number): TextRunStyle {
  const len = plainText(text).length
  if (!len) return {}
  return styleOfChar(text, offset > 0 ? Math.min(offset, len) - 1 : 0)
}

/**
 * Replace `[start, end)` with `insert`: every keystroke, paste and
 * composition. The new text is set in `style` when one is given (the
 * pending style at a caret), else as the first character it replaces, else
 * as the character before it.
 */
export function replaceRange(
  text: RichText,
  start: number,
  end: number,
  insert: string,
  style?: TextRunStyle,
): RichText {
  const len = plainText(text).length
  const a = Math.max(0, Math.min(start, end, len))
  const b = Math.min(len, Math.max(start, end))
  const set = style ?? (b > a ? styleOfChar(text, a) : styleAt(text, a))
  return normalizeRuns([
    ...sliceRuns(text, 0, a),
    ...(insert ? [{ text: insert, ...styleOf(set) }] : []),
    ...sliceRuns(text, b, len),
  ])
}

/** `[start, end)` widened to whole graphemes, or null when it holds nothing. */
function rangeOf(
  text: RichText,
  start: number,
  end: number,
): { plain: string; a: number; b: number } | null {
  const plain = plainText(text)
  const a = snapOffset(plain, Math.min(start, end), -1)
  const b = snapOffset(plain, Math.max(start, end), 1)
  return b > a ? { plain, a, b } : null
}

/**
 * Set style fields over `[start, end)`. A field given as `undefined` is
 * REMOVED there (the words go back to the layer's own).
 */
export function setStyle(
  text: RichText,
  start: number,
  end: number,
  patch: { [K in RunStyleKey]?: TextRunStyle[K] | undefined },
): RichText {
  const r = rangeOf(text, start, end)
  if (!r) return normalizeRuns(text)
  const restyle = (run: TextRun): TextRun => {
    const next: TextRun = { ...run }
    for (const k of RUN_STYLE_KEYS) {
      if (!(k in patch)) continue
      if (patch[k] === undefined) delete next[k]
      else Object.assign(next, { [k]: patch[k] })
    }
    return next
  }
  return normalizeRuns([
    ...sliceRuns(text, 0, r.a),
    ...sliceRuns(text, r.a, r.b).map(restyle),
    ...sliceRuns(text, r.b, r.plain.length),
  ])
}

/** Every style off `[start, end)`. */
export function clearStyle(
  text: RichText,
  start: number,
  end: number,
): RichText {
  const patch: { [K in RunStyleKey]?: undefined } = {}
  for (const k of RUN_STYLE_KEYS) patch[k] = undefined
  return setStyle(text, start, end, patch)
}

/**
 * What a selection agrees on, field by field: the value every character
 * has, `undefined` when none has one, MIXED when they differ. The format
 * bar's state.
 */
export function commonStyle(
  text: RichText,
  start: number,
  end: number,
): { [K in RunStyleKey]?: TextRunStyle[K] | typeof MIXED } {
  const r = rangeOf(text, start, end)
  const runs = r ? sliceRuns(text, r.a, r.b) : []
  const out: Record<string, unknown> = {}
  if (!runs.length) return styleAt(text, start)
  for (const k of RUN_STYLE_KEYS) {
    const first = styleOf(runs[0])[k]
    const agree = runs.every((run) => styleOf(run)[k] === first)
    if (!agree) out[k] = MIXED
    else if (first !== undefined) out[k] = first
  }
  return out
}

/**
 * The toggle a format key makes: when the whole selection already has the
 * field at `value`, take it off; otherwise put it on all of it.
 */
export function toggleStyle<K extends RunStyleKey>(
  text: RichText,
  start: number,
  end: number,
  key: K,
  value: NonNullable<TextRunStyle[K]>,
): RichText {
  const on = commonStyle(text, start, end)[key] === value
  return setStyle(text, start, end, { [key]: on ? undefined : value } as {
    [P in RunStyleKey]?: TextRunStyle[P] | undefined
  })
}

/**
 * What a text field's change did, as one replacement of the old value:
 * the longest common tail (never past the caret, which sits at the end of
 * what was typed) and then the longest common head. Reads a keystroke, a
 * paste, an autocorrect, a dictation and a composition the same way, and
 * the caret settles a repeated character (`aa|` typed into `a|a`).
 */
export function diffInput(
  prev: string,
  next: string,
  caretAfter: number,
): { start: number; end: number; insert: string } {
  const caret = Math.max(0, Math.min(next.length, caretAfter))
  const maxTail = Math.min(prev.length, next.length - caret)
  let tail = 0
  while (
    tail < maxTail &&
    prev[prev.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++
  const maxHead = Math.min(prev.length - tail, next.length - tail)
  let head = 0
  while (head < maxHead && prev[head] === next[head]) head++
  return {
    start: head,
    end: prev.length - tail,
    insert: next.slice(head, next.length - tail),
  }
}
