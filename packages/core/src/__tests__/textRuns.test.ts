import { describe, expect, it } from 'vitest'
import { hasTextErrors, lintVosText } from '../lint'
import { textElementSchema, textRunSchema } from '../schema/configJsonSchema'
import type { TextElement, VosConfigJson } from '../types'

/**
 * A text element's `content` is a string, a `{$data}` binding, or a list of
 * runs: a piece of text and the fields in which it departs from the
 * element's font. The schema takes the shape; the lint says what the frame
 * would silently drop.
 */

const base = { version: 2, duration: 4 } as unknown as VosConfigJson
const text = (content: unknown, over: Record<string, unknown> = {}) => ({
  id: 'cap',
  type: 'text',
  content,
  font: { family: 'Lexend', size: 48, weight: 400 },
  ...over,
})
const lint = (el: unknown, fonts?: unknown) =>
  lintVosText({ ...base, elements: [el], ...(fonts ? { fonts } : {}) } as never)

describe('the schema', () => {
  it('takes runs, a string and a binding as content', () => {
    for (const content of [
      'Ship it',
      { $data: 'headline' },
      [{ text: 'Ship ' }, { text: 'faster', weight: 700, underline: true }],
      [{ text: { $data: 'word' }, color: '#e37358', italic: true }],
      [
        {
          text: 'faster',
          color: { $data: 'accent' },
          highlight: { $data: 'w' },
        },
      ],
    ]) {
      expect(textElementSchema.safeParse(text(content)).success).toBe(true)
    }
  })

  it('holds a run to its types, and passes what it does not know', () => {
    expect(textRunSchema.safeParse({ text: 'a', weight: '700' }).success).toBe(
      false,
    )
    expect(textRunSchema.safeParse({ weight: 700 }).success).toBe(false)
    const kept = textRunSchema.parse({ text: 'a', note: 'mine' })
    expect(kept).toEqual({ text: 'a', note: 'mine' })
  })

  it('types a run in a config with words that may be bound', () => {
    const el: TextElement = {
      type: 'text',
      position: 'center',
      content: [
        { text: 'Meet ' },
        { text: { $data: 'name' }, weight: 700, highlight: '#222' },
      ],
    }
    expect(Array.isArray(el.content)).toBe(true)
  })
})

describe('lintVosText', () => {
  it('is quiet about a string, a binding and well-formed runs', () => {
    expect(lint(text('Ship it'))).toEqual([])
    expect(lint(text({ $data: 'headline' }))).toEqual([])
    expect(
      lintVosText({
        ...base,
        data: { word: 'faster' },
        elements: [
          text([
            { text: 'Ship ' },
            {
              text: { $data: 'word' },
              weight: 700,
              italic: false,
              color: '#e37358',
              underline: true,
              strike: true,
              highlight: '#222',
            },
          ]),
        ],
      } as never),
    ).toEqual([])
  })

  it('a run with no words is an error: it is skipped, so nothing is drawn', () => {
    const issues = lint(text([{ text: 'Ship ' }, 'faster', { weight: 700 }]))
    expect(issues.map((i) => [i.rule, i.severity, i.run])).toEqual([
      ['run-shape', 'error', 1],
      ['run-shape', 'error', 2],
    ])
    expect(hasTextErrors(issues)).toBe(true)
    expect(issues[0].message).toContain('text element "cap", run 1')
  })

  it('names a field that is not a run’s, and what was meant', () => {
    const issues = lint(
      text([
        { text: 'faster', bold: true, style: 'italic', size: 60, note: 1 },
      ]),
    )
    expect(issues.map((i) => i.rule)).toEqual([
      'unknown-run-field',
      'unknown-run-field',
      'unknown-run-field',
      'unknown-run-field',
    ])
    expect(issues[0].message).toContain('write weight: 700')
    expect(issues[1].message).toContain('write italic: true')
    expect(issues[2].message).toContain("the element's font.size")
    expect(issues[3].message).not.toContain('write ')
    expect(hasTextErrors(issues)).toBe(false)
  })

  it('names a field of the wrong type', () => {
    const issues = lint(
      text([{ text: 'a', weight: '700', italic: 'true', underline: 1 }]),
    )
    expect(issues.map((i) => i.rule)).toEqual([
      'run-field-type',
      'run-field-type',
      'run-field-type',
    ])
    expect(issues[0].message).toContain('"weight" must be a number')
  })

  it('a run weight no declared face holds is faked, and says so', () => {
    const runs = text([{ text: 'Ship ' }, { text: 'faster', weight: 700 }])
    const face = (weight?: unknown) => ({
      family: 'Lexend',
      url: 'https://assets.vos.so/fonts/lexend/400.woff2',
      ...(weight === undefined ? {} : { weight }),
    })
    const issues = lint(runs, [face(400)])
    expect(issues.map((i) => i.rule)).toEqual(['undeclared-run-weight'])
    expect(issues[0].message).toContain('weight: 700')
    // Declared, as a number, a string or inside a variable face's range.
    expect(lint(runs, [face(400), face(700)])).toEqual([])
    expect(lint(runs, [face('700')])).toEqual([])
    expect(lint(runs, [face('100 900')])).toEqual([])
    expect(lint(runs, [face('bold')])).toEqual([])
    // A family with no declared face at all is the fonts lint's to report.
    expect(lint(runs)).toEqual([])
    expect(lint(runs, [{ family: 'Sora', url: 'x', weight: 400 }])).toEqual([])
  })

  it('takes a colour or a highlight bound to data, and says when the key is not there', () => {
    const runs = text([
      { text: 'Ship it ' },
      {
        text: 'faster',
        color: { $data: 'accent' },
        highlight: { $data: 'wash' },
      },
    ])
    const lintWith = (data?: Record<string, unknown>) =>
      lintVosText({
        ...base,
        elements: [runs],
        ...(data ? { data } : {}),
      } as never)
    expect(lintWith({ accent: '#e37358', wash: '#222' })).toEqual([])
    const missing = lintWith({ accent: '#e37358' })
    expect(missing.map((i) => [i.rule, i.severity])).toEqual([
      ['unbound-run-key', 'warn'],
    ])
    expect(missing[0].message).toContain('"highlight" reads data.wash')
    expect(lintWith().map((i) => i.rule)).toEqual([
      'unbound-run-key',
      'unbound-run-key',
    ])
    // Bound words with no value draw nothing, and say so.
    const words = lintVosText({
      ...base,
      elements: [text([{ text: { $data: 'name' }, weight: 700 }])],
    } as never)
    expect(words[0].message).toContain('the run draws no words')
    // A colour that is neither a string nor a binding is ignored, and named.
    const wrong = lint(text([{ text: 'a', color: 7, highlight: { key: 'x' } }]))
    expect(wrong.map((i) => i.rule)).toEqual([
      'run-field-type',
      'run-field-type',
    ])
    expect(wrong[0].message).toContain('a string or { "$data": "key" }')
  })

  it('reads nothing but text elements with a list for content', () => {
    expect(
      lintVosText({
        ...base,
        elements: [
          { type: 'image', content: [{ bold: true }] },
          text('plain'),
          null,
        ],
      } as never),
    ).toEqual([])
    expect(lintVosText(base)).toEqual([])
  })
})
