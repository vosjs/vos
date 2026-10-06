import { describe, expect, it } from 'vitest'
import {
  caretAt,
  caretStops,
  lineOfOffset,
  offsetAtX,
  rangeRects,
} from '../richText/caret'
import { decorationRect, layoutText, tokenRanges } from '../richText/layout'
import type { LayoutRun, Measure } from '../richText/layout'

/** 10 px a character in font 0, 13 in font 1: a bold run cannot hide. */
const measure: Measure = (t, f) => t.length * (f === 1 ? 13 : 10)

const plain = (t: string): LayoutRun[] => [{ t }]

/**
 * The greedy token wrap the text layer painted with before it took the
 * layout module, kept as the oracle the layout is held to on plain lines.
 */
const oldWrap = (line: string, max: number): string[] => {
  const width = (t: string) => t.length * 10
  if (!line || width(line) <= max) return [line]
  const out: string[] = []
  let current = ''
  for (const token of line.match(/\S+\s*/g) ?? [line]) {
    if (!current) current = token
    else if (width(current + token) <= max) current += token
    else {
      out.push(current)
      current = token
    }
  }
  if (current) out.push(current)
  return out
}
const text = (line: { frags: { t: string }[] }) =>
  line.frags.map((f) => f.t).join('')

describe('fragments', () => {
  it('lays one plain line out as one fragment', () => {
    const l = layoutText({ lines: [plain('Ship it')] }, measure)
    expect(l.width).toBe(70)
    expect(l.lines).toHaveLength(1)
    expect(l.lines[0].frags).toEqual([{ t: 'Ship it', x: 0, w: 70, o: 0 }])
  })

  it('places a styled run by the advance of what precedes it', () => {
    const l = layoutText(
      { lines: [[{ t: 'Ship ' }, { t: 'faster', f: 1, u: 1 }, { t: ' now' }]] },
      measure,
    )
    expect(l.lines[0].frags.map((f) => [f.t, f.x, f.w, f.o])).toEqual([
      ['Ship ', 0, 50, 0],
      ['faster', 50, 78, 5],
      [' now', 128, 40, 11],
    ])
    expect(l.lines[0].frags[1].u).toBe(1)
    expect(l.width).toBe(168)
  })

  it('merges neighbours set the same way, so a fragment is measured whole', () => {
    const calls: string[] = []
    const l = layoutText({ lines: [[{ t: 'AV' }, { t: 'AV' }]] }, (t, f) => {
      calls.push(t)
      return measure(t, f)
    })
    expect(l.lines[0].frags).toHaveLength(1)
    expect(calls).toEqual(['AVAV'])
  })

  it('keeps an empty line, and an empty text is one empty line', () => {
    const l = layoutText({ lines: [plain('a'), [], plain('b')] }, measure)
    expect(l.lines.map((x) => x.w)).toEqual([10, 0, 10])
    expect(l.lines.map((x) => x.a)).toEqual([0, 2, 3])
    expect(layoutText({ lines: [] }, measure).lines).toHaveLength(1)
  })
})

describe('the wrap', () => {
  it('breaks between word tokens, greedily, each keeping its trailing space', () => {
    const l = layoutText(
      { lines: [plain('one two three four')], maxWidth: 90 },
      measure,
    )
    expect(l.lines.map(text)).toEqual(['one two ', 'three ', 'four'])
    expect(l.lines.map((x) => [x.a, x.n])).toEqual([
      [0, 8],
      [8, 6],
      [14, 4],
    ])
  })

  it('agrees with the text layer wrap on plain lines', () => {
    const cases: [string, number][] = [
      ['one two three four', 90],
      ['Set up different purposes for every page', 140],
      ['a verylongtokenthatcannotfit b', 60],
      ['short', 500],
      ['two  spaces   between words here', 110],
    ]
    for (const [line, max] of cases) {
      const mine = layoutText(
        { lines: [plain(line)], maxWidth: max },
        measure,
      ).lines.map(text)
      expect(mine).toEqual(oldWrap(line, max))
    }
  })

  it('tokenizes as the text layer does', () => {
    for (const line of ['one two', 'a  b ', 'word', 'x y z']) {
      expect(tokenRanges(line).map(([a, b]) => line.slice(a, b))).toEqual(
        line.match(/\S+\s*/g) ?? [line],
      )
    }
  })

  it('gives a token wider than the budget a line of its own', () => {
    const l = layoutText(
      { lines: [plain('a verylongtoken b')], maxWidth: 50 },
      measure,
    )
    expect(l.lines.map(text)).toEqual(['a ', 'verylongtoken ', 'b'])
  })

  it('counts a styled word at its own width when it decides the break', () => {
    // 'aaaa bbbb' is 90 px plain and fits; with a bold second word it is 102.
    const runs = [{ t: 'aaaa ' }, { t: 'bbbb', f: 1 }]
    expect(
      layoutText({ lines: [runs], maxWidth: 95 }, measure).lines,
    ).toHaveLength(2)
    expect(
      layoutText({ lines: [plain('aaaa bbbb')], maxWidth: 95 }, measure).lines,
    ).toHaveLength(1)
  })

  it('carries a style across a break, and wraps each source line on its own', () => {
    const l = layoutText(
      {
        lines: [[{ t: 'aa ' }, { t: 'bb cc', f: 1 }], plain('dd')],
        maxWidth: 60,
      },
      measure,
    )
    expect(l.lines.map(text)).toEqual(['aa ', 'bb ', 'cc', 'dd'])
    expect(l.lines[1].frags[0].f).toBe(1)
    expect(l.lines[2].frags[0].f).toBe(1)
    expect(l.lines[3].a).toBe(9)
  })
})

describe('units', () => {
  it('a word unit keeps its trailing space and places by prefix advance', () => {
    const l = layoutText({ lines: [plain('one two')], unit: 'word' }, measure)
    expect(l.lines[0].units!.map((u) => [u.x, u.w, u.parts[0].t])).toEqual([
      [0, 40, 'one '],
      [40, 30, 'two'],
    ])
  })

  it('a word that changes style inside is one unit of several parts', () => {
    const l = layoutText(
      {
        lines: [[{ t: 'un' }, { t: 'believ', f: 1 }, { t: 'able now' }]],
        unit: 'word',
      },
      measure,
    )
    const [word, now] = l.lines[0].units!
    expect(word.parts.map((p) => [p.t, p.x, p.f ?? 0])).toEqual([
      ['un', 0, 0],
      ['believ', 20, 1],
      ['able ', 98, 0],
    ])
    expect([word.x, word.w]).toEqual([0, 148])
    expect([now.x, now.parts[0].t]).toEqual([148, 'now'])
  })

  it('a char unit is a grapheme, spaces included, in its own style', () => {
    const l = layoutText(
      { lines: [[{ t: 'a ' }, { t: 'b', f: 1 }]], unit: 'char' },
      measure,
    )
    expect(l.lines[0].units!.map((u) => [u.parts[0].t, u.x, u.w])).toEqual([
      ['a', 0, 10],
      [' ', 10, 10],
      ['b', 20, 13],
    ])
  })

  it('a line unit is the visual line after the wrap', () => {
    const l = layoutText(
      { lines: [plain('one two three')], maxWidth: 80, unit: 'line' },
      measure,
    )
    expect(l.lines.map((x) => x.units!.length)).toEqual([1, 1])
    expect(l.lines[1].units![0].parts[0].t).toBe('three')
  })

  it('cuts no units unless asked', () => {
    expect(layoutText({ lines: [plain('a b')] }, measure).lines[0].units).toBe(
      undefined,
    )
  })
})

describe('the caret', () => {
  const layout = layoutText(
    {
      lines: [[{ t: 'ab ' }, { t: 'cd', f: 1 }, { t: ' ef' }], plain('gh')],
      maxWidth: 70,
    },
    measure,
  )
  // Visual lines: 'ab cd ' (a 0), 'ef' (a 6), 'gh' (a 9).

  it('stands on every grapheme boundary at the measured advance', () => {
    expect(caretStops(layout.lines[0], measure)).toEqual([
      { o: 0, x: 0 },
      { o: 1, x: 10 },
      { o: 2, x: 20 },
      { o: 3, x: 30 },
      { o: 4, x: 43 },
      { o: 5, x: 56 },
      { o: 6, x: 66 },
    ])
  })

  it('an offset at a wrap point is on the line that starts there', () => {
    expect(lineOfOffset(layout, 6)).toBe(1)
    expect(caretAt(layout, 6, measure)).toEqual({ line: 1, x: 0 })
    expect(caretAt(layout, 11, measure)).toEqual({ line: 2, x: 20 })
  })

  it('a press lands on the nearer edge, and reads back where it was put', () => {
    expect(offsetAtX(layout.lines[0], 34, measure)).toBe(3)
    expect(offsetAtX(layout.lines[0], 38, measure)).toBe(4)
    for (const line of layout.lines) {
      for (const s of caretStops(line, measure)) {
        expect(offsetAtX(line, s.x, measure)).toBe(s.o)
      }
    }
  })

  it('never splits a grapheme', () => {
    const l = layoutText({ lines: [plain('a👍🏽b')] }, measure)
    const stops = caretStops(l.lines[0], measure).map((s) => s.o)
    expect(stops).toEqual([0, 1, 5, 6])
  })

  it('a selection is one stretch per line it touches', () => {
    expect(rangeRects(layout, 1, 4, measure)).toEqual([
      { line: 0, x: 10, w: 33 },
    ])
    expect(rangeRects(layout, 4, 10, measure, 6)).toEqual([
      { line: 0, x: 43, w: 23 },
      { line: 1, x: 0, w: 26 },
      { line: 2, x: 0, w: 10 },
    ])
    expect(rangeRects(layout, 3, 3, measure)).toEqual([])
  })
})

describe('decorations', () => {
  it('land on whole pixels, so neighbouring stretches meet', () => {
    const a = decorationRect('u', 10.4, 20.3, 100, 64)
    const b = decorationRect('u', 30.7, 15.2, 100, 64)
    expect(a.x + a.w).toBe(b.x)
    expect(Number.isInteger(a.y) && Number.isInteger(a.h)).toBe(true)
    expect(a.h).toBeGreaterThanOrEqual(1)
  })

  it('an underline sits below the middle, a strike near it, a highlight around it', () => {
    const u = decorationRect('u', 0, 10, 100, 100)
    const s = decorationRect('s', 0, 10, 100, 100)
    const h = decorationRect('h', 0, 10, 100, 100)
    expect(u.y).toBeGreaterThan(s.y)
    expect(s.y).toBeGreaterThanOrEqual(100)
    expect(h.y).toBeLessThan(100)
    expect(h.y + h.h).toBeGreaterThan(u.y)
  })
})
