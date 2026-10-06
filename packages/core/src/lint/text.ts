/**
 * Styled-text linter (a text element's `content` as a list of runs).
 *
 * The schema never rejects an element, and the renderer never throws on one:
 * a run it cannot read is skipped and a field it does not know does nothing.
 * Both are silent on the frame, so this says them before a render does not:
 * a run with no words, a field that is not a run's (`bold`, `style`, a
 * markdown habit), a value of the wrong type, and a run weight the declared
 * faces of its family do not hold, which a browser fakes by smearing the
 * regular face.
 */
import type { VosConfigJson } from '../types'

export type TextRule =
  | 'run-shape'
  | 'unknown-run-field'
  | 'run-field-type'
  | 'undeclared-run-weight'
  | 'unbound-run-key'
export type TextSeverity = 'error' | 'warn'

export interface TextIssue {
  rule: TextRule
  severity: TextSeverity
  /** Element id (or `element_<index>`). */
  elementId: string
  /** Index of the run in the element's content. */
  run: number
  message: string
}

/**
 * What a run may say, and the type each field takes. A `bindable` field is
 * a string or `{ "$data": "key" }`.
 */
const RUN_FIELDS: Record<string, 'text' | 'number' | 'boolean' | 'bindable'> = {
  text: 'text',
  weight: 'number',
  italic: 'boolean',
  color: 'bindable',
  underline: 'boolean',
  strike: 'boolean',
  highlight: 'bindable',
}

/** A field people reach for, and the one that does what they meant. */
const MEANT: Record<string, string> = {
  bold: 'weight: 700',
  fontWeight: 'weight',
  style: 'italic: true',
  fontStyle: 'italic: true',
  italics: 'italic: true',
  underlined: 'underline: true',
  strikethrough: 'strike: true',
  background: 'highlight',
  backgroundColor: 'highlight',
  fill: 'color',
  content: 'text',
  size: "the element's font.size (a run cannot change it)",
  fontSize: "the element's font.size (a run cannot change it)",
  family: "the element's font.family (a run cannot change it)",
  fontFamily: "the element's font.family (a run cannot change it)",
}

const isDataRef = (v: unknown): v is { $data: string } =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { $data?: unknown }).$data === 'string' &&
  (v as { $data: string }).$data.length > 0

function firstFamilyToken(stack: string): string {
  const first = stack.split(',')[0] ?? ''
  return first
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .toLowerCase()
}

/** Does a declared face's weight (`700`, `"700"`, `"100 900"`) hold `w`? */
function faceHolds(weight: unknown, w: number): boolean {
  if (weight === undefined || weight === null) return w === 400
  if (typeof weight === 'number') return weight === w
  const parts = String(weight)
    .trim()
    .split(/\s+/)
    .map((p) => (p === 'normal' ? 400 : p === 'bold' ? 700 : Number(p)))
  if (parts.some((p) => !Number.isFinite(p))) return true
  return parts.length === 2 ? w >= parts[0] && w <= parts[1] : parts[0] === w
}

export function lintVosText(config: VosConfigJson): TextIssue[] {
  const issues: TextIssue[] = []
  const elements = Array.isArray(config.elements) ? config.elements : []
  const faces = Array.isArray(config.fonts) ? config.fonts : []

  elements.forEach((el: any, index: number) => {
    if (el?.type !== 'text' || !Array.isArray(el.content)) return
    const elementId: string = el.id ?? `element_${index}`
    const say = (
      rule: TextRule,
      severity: TextSeverity,
      run: number,
      message: string,
    ) =>
      issues.push({
        rule,
        severity,
        elementId,
        run,
        message: `text element "${elementId}", run ${run}: ${message}`,
      })

    const bound = new Set(
      config.data && typeof config.data === 'object'
        ? Object.keys(config.data as object)
        : [],
    )
    const family =
      typeof el.font?.family === 'string'
        ? firstFamilyToken(el.font.family)
        : ''
    const declared = family
      ? faces.filter(
          (f: any) =>
            typeof f?.family === 'string' && f.family.toLowerCase() === family,
        )
      : []

    el.content.forEach((run: any, i: number) => {
      if (!run || typeof run !== 'object' || Array.isArray(run)) {
        say(
          'run-shape',
          'error',
          i,
          'is not a run. A run is an object: { "text": "words", "weight": 700 }. It is skipped, so its words are not drawn.',
        )
        return
      }
      if (typeof run.text !== 'string' && !isDataRef(run.text)) {
        say(
          'run-shape',
          'error',
          i,
          '"text" must be a string or { "$data": "key" }. The run is skipped, so its words are not drawn.',
        )
      }
      for (const key of Object.keys(run)) {
        const type = RUN_FIELDS[key]
        if (!type) {
          const meant = MEANT[key]
          say(
            'unknown-run-field',
            'warn',
            i,
            `"${key}" is not a run's field and does nothing${meant ? `: write ${meant}` : ''}. A run takes text, weight, italic, color, underline, strike, highlight.`,
          )
          continue
        }
        if (type === 'text') continue
        const value = run[key]
        const ok =
          type === 'number'
            ? typeof value === 'number' && Number.isFinite(value)
            : type === 'bindable'
              ? typeof value === 'string' || isDataRef(value)
              : typeof value === type
        if (!ok) {
          say(
            'run-field-type',
            'warn',
            i,
            `"${key}" must be ${
              type === 'bindable'
                ? 'a string or { "$data": "key" }'
                : `a ${type}`
            } and is ignored as written (${JSON.stringify(value)}).`,
          )
        }
      }
      // A binding to a key the program's data does not hold reads nothing
      // until a value arrives: no words, or the element's own colour.
      for (const key of ['text', 'color', 'highlight']) {
        const ref = run[key]
        if (!isDataRef(ref) || bound.has(ref.$data)) continue
        say(
          'unbound-run-key',
          'warn',
          i,
          `"${key}" reads data.${ref.$data}, which config.data does not hold: ${
            key === 'text'
              ? 'the run draws no words'
              : "the run draws in the element's own colour"
          } until a value arrives. Ship a default in data.`,
        )
      }
      // A weight no declared face of the family holds is faked from another.
      if (
        typeof run.weight === 'number' &&
        declared.length > 0 &&
        !declared.some((f: any) => faceHolds(f.weight, run.weight))
      ) {
        say(
          'undeclared-run-weight',
          'warn',
          i,
          `weight ${run.weight} has no "${el.font.family}" face in config.fonts, so the browser fakes it from another weight. Declare { family, url, weight: ${run.weight} } (catalog: https://vos.so/api/fonts).`,
        )
      }
    })
  })

  return issues
}

export function hasTextErrors(issues: readonly TextIssue[]): boolean {
  return issues.some((i) => i.severity === 'error')
}
