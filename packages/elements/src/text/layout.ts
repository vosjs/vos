/**
 * Styled-text layout, once.
 *
 * A text layer is lines of RUNS (a piece of text and how it is set). This
 * module turns them into what a painter draws and what an editor points at:
 * visual lines after the wrap, each a list of same-style FRAGMENTS at
 * measured positions, plus the UNITS a per-unit entrance animates.
 *
 * It imports nothing and touches no DOM: measurement is handed in, so the
 * page that paints, the host that picks and a plain node test all run the
 * same function over the same rules.
 *
 * The rules are the text layer's own, unchanged:
 *  - a line breaks only between word tokens (`\S+\s*`, trailing whitespace
 *    kept with its word), greedily, at measured widths; a token wider than
 *    the budget takes a line of its own; explicit lines wrap independently;
 *  - a fragment is measured whole, so kerning holds inside a style and
 *    stops at a style boundary (as it does in CSS);
 *  - a unit places by the advance of what precedes it in its fragment, so
 *    the settled frame of an entrance is the frame without one.
 */

/** How one piece of text is set. Absent fields are the layer's own. */
export interface RunStyle {
  /** Index into the layout's `fonts` (0, the layer's font, when absent). */
  f?: number
  /** Fill colour. */
  c?: string
  /** Underline. */
  u?: 1
  /** Strikethrough. */
  s?: 1
  /** A colour behind the text. */
  h?: string
}

export interface LayoutRun extends RunStyle {
  /** The text. Never holds a line break: lines are split before layout. */
  t: string
}

export type LayoutUnit = 'char' | 'word' | 'line'

export interface LayoutInput {
  /** Source lines, each a list of runs. */
  lines: LayoutRun[][]
  /** Wrap budget in the measure's own px; absent or 0 = no wrap. */
  maxWidth?: number
  /** Cut each visual line into units for a per-unit entrance. */
  unit?: LayoutUnit
}

/** `measure(text, fontIndex)`: the advance of `text` set in that font. */
export type Measure = (text: string, font: number) => number

/** A same-style stretch of one visual line. */
export interface Fragment extends RunStyle {
  t: string
  /** Left edge, from the line's left edge. */
  x: number
  /** Advance. */
  w: number
  /** Offset of its first character in the visual line. */
  o: number
}

/** One animated unit: the fragments (or parts of them) it draws. */
export interface Unit {
  x: number
  w: number
  parts: Fragment[]
}

export interface LayoutLine {
  /** Advance of the whole line (trailing whitespace included). */
  w: number
  frags: Fragment[]
  /** Present only when the input asked for a unit. */
  units?: Unit[]
  /** Offset of the line's first character in the whole plain text. */
  a: number
  /** Characters on the line (its break, when it ends in one, not counted). */
  n: number
}

export interface TextLayout {
  lines: LayoutLine[]
  /** The widest line. */
  width: number
}

const sameStyle = (a: RunStyle, b: RunStyle) =>
  (a.f || 0) === (b.f || 0) &&
  a.c === b.c &&
  a.u === b.u &&
  a.s === b.s &&
  a.h === b.h

/** Grapheme clusters (an emoji or a combining mark is one unit). */
export function graphemesOf(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const out: string[] = []
    for (const s of seg.segment(text)) out.push(s.segment)
    return out
  }
  return Array.from(text)
}

/** `[start, end)` of each word token in a line: `\S+\s*`, or the line whole. */
export function tokenRanges(line: string): [number, number][] {
  const out: [number, number][] = []
  const re = /\S+\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    out.push([m.index, m.index + m[0].length])
  }
  return out.length ? out : [[0, line.length]]
}

export function layoutText(input: LayoutInput, measure: Measure): TextLayout {
  const memo: Record<string, number> = {}
  const adv = (t: string, f: number) => {
    if (!t) return 0
    const key = f + '\u0000' + t
    let w = memo[key]
    if (w === undefined) {
      w = measure(t, f)
      memo[key] = w
    }
    return w
  }

  /** The runs of one source line cut to `[a, b)`, same-style neighbours merged. */
  const slice = (runs: LayoutRun[], a: number, b: number): LayoutRun[] => {
    const out: LayoutRun[] = []
    let at = 0
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i]
      const from = Math.max(a, at)
      const to = Math.min(b, at + r.t.length)
      if (to > from) {
        const t = r.t.slice(from - at, to - at)
        const last = out[out.length - 1]
        if (last && sameStyle(last, r)) last.t += t
        else out.push({ ...r, t })
      }
      at += r.t.length
      if (at >= b) break
    }
    return out
  }
  const widthOf = (runs: LayoutRun[]) => {
    let w = 0
    for (let i = 0; i < runs.length; i++) w += adv(runs[i].t, runs[i].f || 0)
    return w
  }

  /** The part of a line's fragments inside `[a, b)` (line-local offsets). */
  const partsIn = (frags: Fragment[], a: number, b: number): Fragment[] => {
    const out: Fragment[] = []
    for (let i = 0; i < frags.length; i++) {
      const fr = frags[i]
      const from = Math.max(a, fr.o)
      const to = Math.min(b, fr.o + fr.t.length)
      if (to <= from) continue
      const f = fr.f || 0
      const before = adv(fr.t.slice(0, from - fr.o), f)
      out.push({
        ...fr,
        t: fr.t.slice(from - fr.o, to - fr.o),
        x: fr.x + before,
        w: adv(fr.t.slice(0, to - fr.o), f) - before,
        o: from,
      })
    }
    return out
  }
  const unitOf = (frags: Fragment[], a: number, b: number): Unit => {
    const parts = partsIn(frags, a, b)
    if (!parts.length) return { x: 0, w: 0, parts }
    const last = parts[parts.length - 1]
    return { x: parts[0].x, w: last.x + last.w - parts[0].x, parts }
  }

  const lines: LayoutLine[] = []
  const max = input.maxWidth && input.maxWidth > 0 ? input.maxWidth : 0
  let width = 0
  // Offset of the current source line in the whole plain text.
  let base = 0

  const push = (runs: LayoutRun[], a: number, b: number) => {
    const cut = slice(runs, a, b)
    const frags: Fragment[] = []
    let x = 0
    let o = 0
    for (let i = 0; i < cut.length; i++) {
      const w = adv(cut[i].t, cut[i].f || 0)
      frags.push({ ...cut[i], x, w, o })
      x += w
      o += cut[i].t.length
    }
    const line: LayoutLine = { w: x, frags, a: base + a, n: b - a }
    if (input.unit) {
      const text = cut.map((r) => r.t).join('')
      const units: Unit[] = []
      if (input.unit === 'line') units.push(unitOf(frags, 0, text.length))
      else if (input.unit === 'word') {
        const toks = tokenRanges(text)
        for (let i = 0; i < toks.length; i++) {
          units.push(unitOf(frags, toks[i][0], toks[i][1]))
        }
      } else {
        let at = 0
        const gs = graphemesOf(text)
        for (let i = 0; i < gs.length; i++) {
          units.push(unitOf(frags, at, at + gs[i].length))
          at += gs[i].length
        }
      }
      line.units = units
    }
    if (x > width) width = x
    lines.push(line)
  }

  for (let li = 0; li < input.lines.length; li++) {
    const runs = input.lines[li]
    let len = 0
    for (let i = 0; i < runs.length; i++) len += runs[i].t.length
    if (!max || !len || widthOf(slice(runs, 0, len)) <= max) {
      push(runs, 0, len)
    } else {
      const text = runs.map((r) => r.t).join('')
      const toks = tokenRanges(text)
      // Whitespace ahead of the first word stays on the first line: every
      // character of the text is on some line, so a caret can stand at it.
      let a = 0
      let b = toks[0][1]
      for (let i = 1; i < toks.length; i++) {
        if (widthOf(slice(runs, a, toks[i][1])) <= max) b = toks[i][1]
        else {
          push(runs, a, b)
          a = toks[i][0]
          b = toks[i][1]
        }
      }
      push(runs, a, b)
    }
    base += len + 1
  }
  if (!lines.length) lines.push({ w: 0, frags: [], a: 0, n: 0 })
  return { lines, width }
}

// ---------------------------------------------------------------------------
// Decorations. Geometry in EMs of the paint size, measured from the middle
// of the em box (the baseline the text layer draws on). Constants and not
// font metrics, so every platform that paints a layer draws the same line.
// ---------------------------------------------------------------------------

/** Top of the underline, below the em box's middle. */
export const UNDERLINE_OFFSET_EM = 0.42
/** Thickness of the underline and the strikethrough. */
export const DECORATION_THICKNESS_EM = 0.065
/** Top of the strikethrough, relative to the em box's middle. */
export const STRIKE_OFFSET_EM = 0.02
/** The highlight's box, above and below the em box's middle. */
export const HIGHLIGHT_HALF_EM = 0.58

/**
 * A decoration's rectangle for a stretch at `x`, `w` on a line whose em
 * middle is `y`, at paint size `px`. Edges land on whole pixels, so the
 * stretches of neighbouring units meet without a seam.
 */
export function decorationRect(
  kind: 'u' | 's' | 'h',
  x: number,
  w: number,
  y: number,
  px: number,
): { x: number; y: number; w: number; h: number } {
  const x0 = Math.round(x)
  const x1 = Math.round(x + w)
  if (kind === 'h') {
    const top = Math.round(y - HIGHLIGHT_HALF_EM * px)
    const bottom = Math.round(y + HIGHLIGHT_HALF_EM * px)
    return { x: x0, y: top, w: x1 - x0, h: bottom - top }
  }
  const t = Math.max(1, Math.round(DECORATION_THICKNESS_EM * px))
  const top = Math.round(
    y + (kind === 'u' ? UNDERLINE_OFFSET_EM : STRIKE_OFFSET_EM) * px,
  )
  return { x: x0, y: top, w: x1 - x0, h: t }
}
