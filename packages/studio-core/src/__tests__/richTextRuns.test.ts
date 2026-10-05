import { describe, expect, it } from 'vitest'
import {
  MIXED,
  clearStyle,
  commonStyle,
  diffInput,
  normalizeRuns,
  plainText,
  replaceRange,
  runsOf,
  setStyle,
  sliceRuns,
  snapOffset,
  styleAt,
  toggleStyle,
} from '../richText/runs'
import type { RichText, TextRun } from '../richText/runs'

const SHIP: TextRun[] = [
  { text: 'Ship ' },
  { text: 'faster', weight: 700 },
  { text: ' now' },
]

describe('the two shapes', () => {
  it('reads the words of either', () => {
    expect(plainText('Ship it')).toBe('Ship it')
    expect(plainText(SHIP)).toBe('Ship faster now')
    expect(plainText([])).toBe('')
  })

  it('lists either as runs', () => {
    expect(runsOf('a')).toEqual([{ text: 'a' }])
    expect(runsOf('')).toEqual([])
    expect(runsOf(SHIP)).toBe(SHIP)
  })
})

describe('the canonical form', () => {
  it('merges neighbours set alike and drops empty runs', () => {
    expect(
      normalizeRuns([
        { text: 'a', weight: 700 },
        { text: '' },
        { text: 'b', weight: 700 },
        { text: 'c' },
      ]),
    ).toEqual([{ text: 'ab', weight: 700 }, { text: 'c' }])
  })

  it('is a string again when no style is left', () => {
    expect(normalizeRuns([{ text: 'a' }, { text: 'b' }])).toBe('ab')
    expect(normalizeRuns([])).toBe('')
    expect(normalizeRuns('as typed')).toBe('as typed')
  })

  it('drops fields that say nothing, and keeps an italic turned off', () => {
    expect(
      normalizeRuns([
        { text: 'a', underline: false, strike: false, color: '' },
        { text: 'b', italic: false },
      ]),
    ).toEqual([{ text: 'a' }, { text: 'b', italic: false }])
  })

  it('never changes the list it was given', () => {
    const input: TextRun[] = [
      { text: 'a' },
      { text: 'b' },
      { text: 'c', strike: true },
    ]
    const copy = JSON.parse(JSON.stringify(input))
    normalizeRuns(input)
    expect(input).toEqual(copy)
  })
})

describe('typing', () => {
  it('a character takes the style of the one before it', () => {
    expect(replaceRange(SHIP, 11, 11, '!')).toEqual([
      { text: 'Ship ' },
      { text: 'faster!', weight: 700 },
      { text: ' now' },
    ])
    expect(replaceRange(SHIP, 5, 5, 'x')).toEqual([
      { text: 'Ship x' },
      { text: 'faster', weight: 700 },
      { text: ' now' },
    ])
  })

  it('at the very start it takes the style of what follows', () => {
    expect(
      replaceRange([{ text: 'a', weight: 700 }, { text: 'b' }], 0, 0, 'x'),
    ).toEqual([{ text: 'xa', weight: 700 }, { text: 'b' }])
  })

  it('typed over a selection it takes the style of the first character replaced', () => {
    expect(replaceRange(SHIP, 5, 15, 'slow')).toEqual([
      { text: 'Ship ' },
      { text: 'slow', weight: 700 },
    ])
  })

  it('takes the pending style when one is given, even none', () => {
    expect(replaceRange('ab', 1, 1, 'x', { underline: true })).toEqual([
      { text: 'a' },
      { text: 'x', underline: true },
      { text: 'b' },
    ])
    expect(replaceRange(SHIP, 11, 11, '!', {})).toEqual([
      { text: 'Ship ' },
      { text: 'faster', weight: 700 },
      { text: '! now' },
    ])
  })

  it('deleting the styled words leaves a string', () => {
    expect(replaceRange(SHIP, 5, 11, '')).toBe('Ship  now')
  })

  it('a plain string stays a string', () => {
    expect(replaceRange('Ship it', 7, 7, '!')).toBe('Ship it!')
    expect(replaceRange('', 0, 0, 'a')).toBe('a')
  })

  it('a line break is text like any other', () => {
    expect(plainText(replaceRange(SHIP, 11, 11, '\n'))).toBe(
      'Ship faster\n now',
    )
  })
})

describe('styling a range', () => {
  it('sets a field from the middle of one word to the middle of another', () => {
    expect(setStyle('Ship faster', 2, 7, { underline: true })).toEqual([
      { text: 'Sh' },
      { text: 'ip fa', underline: true },
      { text: 'ster' },
    ])
  })

  it('composes fields on the same characters', () => {
    const t = setStyle(setStyle('abc', 1, 2, { weight: 700 }), 1, 2, {
      color: '#ff0000',
    })
    expect(t).toEqual([
      { text: 'a' },
      { text: 'b', weight: 700, color: '#ff0000' },
      { text: 'c' },
    ])
  })

  it('removes a field given as undefined, and only that one', () => {
    const t: RichText = [{ text: 'ab', weight: 700, underline: true }]
    expect(setStyle(t, 0, 2, { weight: undefined })).toEqual([
      { text: 'ab', underline: true },
    ])
    expect(
      setStyle(t, 0, 1, { underline: undefined, weight: undefined }),
    ).toEqual([{ text: 'a' }, { text: 'b', weight: 700, underline: true }])
  })

  it('crosses a line break', () => {
    expect(setStyle('ab\ncd', 1, 4, { strike: true })).toEqual([
      { text: 'a' },
      { text: 'b\nc', strike: true },
      { text: 'd' },
    ])
  })

  it('an empty range changes nothing', () => {
    expect(setStyle(SHIP, 3, 3, { underline: true })).toEqual(SHIP)
    expect(setStyle('abc', 2, 2, { underline: true })).toBe('abc')
  })

  it('never splits a grapheme', () => {
    const t = setStyle('a👍🏽b', 2, 3, { underline: true })
    expect(t).toEqual([
      { text: 'a' },
      { text: '👍🏽', underline: true },
      { text: 'b' },
    ])
    expect(snapOffset('a👍🏽b', 3, -1)).toBe(1)
    expect(snapOffset('a👍🏽b', 3, 1)).toBe(5)
    expect(snapOffset('abc', 2, 1)).toBe(2)
  })

  it('clears every style off a range', () => {
    expect(clearStyle(SHIP, 0, 15)).toBe('Ship faster now')
    expect(clearStyle(SHIP, 5, 8)).toEqual([
      { text: 'Ship fas' },
      { text: 'ter', weight: 700 },
      { text: ' now' },
    ])
  })
})

describe('the toggle a format key makes', () => {
  it('puts the field on when any of the selection lacks it', () => {
    expect(toggleStyle(SHIP, 0, 11, 'weight', 700)).toEqual([
      { text: 'Ship faster', weight: 700 },
      { text: ' now' },
    ])
  })

  it('takes it off when the whole selection has it', () => {
    expect(toggleStyle(SHIP, 5, 11, 'weight', 700)).toBe('Ship faster now')
  })

  it('replaces another value rather than removing it', () => {
    expect(toggleStyle(SHIP, 5, 11, 'weight', 900)).toEqual([
      { text: 'Ship ' },
      { text: 'faster', weight: 900 },
      { text: ' now' },
    ])
  })

  it('twice is where it started', () => {
    const once = toggleStyle('Ship it', 5, 7, 'underline', true)
    expect(toggleStyle(once, 5, 7, 'underline', true)).toBe('Ship it')
  })
})

describe('what a selection agrees on', () => {
  it('reports a value all of it has, and MIXED where it differs', () => {
    expect(commonStyle(SHIP, 5, 11)).toEqual({ weight: 700 })
    expect(commonStyle(SHIP, 0, 11)).toEqual({ weight: MIXED })
    expect(commonStyle(SHIP, 0, 5)).toEqual({})
  })

  it('at a caret it is the style typing would take', () => {
    expect(commonStyle(SHIP, 11, 11)).toEqual({ weight: 700 })
    expect(styleAt(SHIP, 5)).toEqual({})
    expect(styleAt(SHIP, 6)).toEqual({ weight: 700 })
    expect(styleAt('', 0)).toEqual({})
  })
})

describe('reading a text field change', () => {
  const apply = (prev: string, d: ReturnType<typeof diffInput>) =>
    prev.slice(0, d.start) + d.insert + prev.slice(d.end)

  it('a typed character', () => {
    expect(diffInput('abc', 'abxc', 3)).toEqual({
      start: 2,
      end: 2,
      insert: 'x',
    })
  })

  it('a repeated character lands where the caret says', () => {
    // 'a|a' → 'aa|a': the new 'a' is the SECOND one.
    expect(diffInput('aa', 'aaa', 2)).toEqual({ start: 1, end: 1, insert: 'a' })
    expect(diffInput('aa', 'aaa', 1)).toEqual({ start: 0, end: 0, insert: 'a' })
    expect(diffInput('aa', 'aaa', 3)).toEqual({ start: 2, end: 2, insert: 'a' })
  })

  it('a backspace, a forward delete, a typed-over selection, a paste', () => {
    expect(diffInput('abc', 'ac', 1)).toEqual({ start: 1, end: 2, insert: '' })
    expect(diffInput('abcd', 'aXd', 2)).toEqual({
      start: 1,
      end: 3,
      insert: 'X',
    })
    expect(diffInput('ab', 'a hello b', 8)).toEqual({
      start: 1,
      end: 1,
      insert: ' hello ',
    })
  })

  it('always rebuilds the new value from the old', () => {
    const cases: [string, string, number][] = [
      ['', 'a', 1],
      ['a', '', 0],
      ['abc', 'abc', 2],
      ['ni', '你', 1],
      ['hello world', 'hello brave world', 12],
      ['aaa', 'aa', 1],
      ['abc', 'xyz', 3],
    ]
    for (const [prev, next, caret] of cases) {
      expect(apply(prev, diffInput(prev, next, caret))).toBe(next)
    }
  })

  it('keeps the styles around what changed', () => {
    const d = diffInput(plainText(SHIP), 'Ship fastest now', 12)
    expect(replaceRange(SHIP, d.start, d.end, d.insert)).toEqual([
      { text: 'Ship ' },
      { text: 'fastest', weight: 700 },
      { text: ' now' },
    ])
  })
})

describe('slicing', () => {
  it('cuts runs to a range', () => {
    expect(sliceRuns(SHIP, 3, 8)).toEqual([
      { text: 'p ' },
      { text: 'fas', weight: 700 },
    ])
  })
})
