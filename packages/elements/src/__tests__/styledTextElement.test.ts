import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  contentIsBound,
  extractTextBindings,
  resolveTextContent,
  resolveTextElement,
} from '../dataBinding'
import { renderElements } from '../renderElements'
import {
  rasterPropPatch,
  renderSplitTextElement,
  renderTextElement,
} from '../renderers/text'
import { layoutTextElement } from '../text/element'
import {
  MIXED,
  commonStyle,
  layoutLines,
  normalizeRuns,
  replaceRange,
  resolveRunColors,
  setStyle,
  toRichText,
  toggleStyle,
} from '../text/runs'
import type { RichText } from '../text/runs'
import {
  layoutSplitUnits,
  layoutTextBlock,
  plainLines,
  spacedAdvance,
} from '../textLayout'
import type { TextProbe } from '../text/element'
import type { LayoutRun, Measure } from '../text/layout'

/**
 * A text element's words are a string or a list of runs, each a piece of
 * text and the fields in which it departs from the element's font. Plain
 * and styled content are ONE layout and one painter: a string is one run a
 * line, so everything a plain element drew it still draws, call for call.
 */

/** 10 px a character; 13 in a bold face; 11 in an italic. */
const widthIn = (text: string, font: string) =>
  text.length * (/\s700\s/.test(font) ? 13 : /^italic\s/.test(font) ? 11 : 10)
const measure: Measure = (t, f) => t.length * (f === 1 ? 13 : 10)
const METRICS = { ascent: 20, descent: 5, advance: 30 }

// A canvas that records what was drawn, in which font and colour.
interface Call {
  op: 'fillText' | 'strokeText' | 'fillRect'
  text?: string
  x: number
  y: number
  w?: number
  h?: number
  font: string
  fill: string
  shadow: boolean
}
let calls: Call[] = []
function makeCtx(native: boolean) {
  const ctx: any = {
    font: '',
    textBaseline: '',
    textAlign: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: (t: string) => ({
      width: widthIn(t, ctx.font),
      fontBoundingBoxAscent: 20,
      fontBoundingBoxDescent: 5,
    }),
    fillText: (text: string, x: number, y: number) =>
      calls.push({
        op: 'fillText',
        text,
        x,
        y,
        font: ctx.font,
        fill: ctx.fillStyle,
        shadow: ctx.shadowBlur > 0,
      }),
    strokeText: (text: string, x: number, y: number) =>
      calls.push({
        op: 'strokeText',
        text,
        x,
        y,
        font: ctx.font,
        fill: ctx.fillStyle,
        shadow: ctx.shadowBlur > 0,
      }),
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push({
        op: 'fillRect',
        x,
        y,
        w,
        h,
        font: ctx.font,
        fill: ctx.fillStyle,
        shadow: ctx.shadowBlur > 0,
      }),
    clearRect() {},
  }
  if (native) ctx.letterSpacing = '0px'
  return ctx
}
let native = true
beforeAll(() => {
  ;(globalThis as any).document = {
    createElement: () => {
      const ctx = makeCtx(native)
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        // A sized canvas resets its context, as a real one does.
        set _w(_v: number) {},
      }
    },
  }
})
afterAll(() => {
  delete (globalThis as any).document
})

const RESOLUTION = {
  width: 1920,
  height: 1080,
  pixelRatio: 1,
  drawingBufferWidth: 1920,
  drawingBufferHeight: 1080,
}
const el = (over: Record<string, unknown> = {}): any => ({
  id: 't',
  type: 'text',
  content: 'Ship it',
  position: 'center',
  font: { size: 24, family: 'Lexend', weight: 400, color: '#fff' },
  ...over,
})
const RUNS = [
  { text: 'Ship ' },
  { text: 'faster', weight: 700, color: '#e37358', underline: true },
  { text: ' now', italic: true, strike: true },
]
const texts = () => calls.filter((c) => c.op === 'fillText')
const rects = () => calls.filter((c) => c.op === 'fillRect')
const draw = (config: any) => {
  calls = []
  return renderTextElement(config, RESOLUTION, THREE)
}

describe('what a boundary takes as styled text', () => {
  it('a string, or anything that is not a list, is its words', () => {
    expect(toRichText('Ship it')).toBe('Ship it')
    expect(toRichText(42)).toBe('42')
    expect(toRichText(null)).toBe('')
    expect(toRichText(undefined)).toBe('')
  })

  it('a list keeps the runs that are runs and the fields of their type', () => {
    expect(
      toRichText([
        { text: 'Ship ' },
        'loose',
        null,
        { words: 'no text' },
        {
          text: 'faster',
          weight: 700,
          italic: 'yes',
          color: 7,
          underline: 1,
          strike: true,
          highlight: '#222',
          bold: true,
        },
        { text: ' now', weight: Number.NaN },
      ]),
    ).toEqual([
      { text: 'Ship ' },
      { text: 'faster', weight: 700, strike: true, highlight: '#222' },
      { text: ' now' },
    ])
  })

  it('is canonical: an unstyled list is a string, neighbours set alike merge', () => {
    expect(toRichText([{ text: 'Ship ' }, { text: 'it' }])).toBe('Ship it')
    expect(
      toRichText([
        { text: 'a', weight: 700 },
        { text: 'b', weight: 700 },
      ]),
    ).toEqual([{ text: 'ab', weight: 700 }])
    expect(toRichText([])).toBe('')
  })
})

describe('runs as lines', () => {
  const fontOf = (r: { weight?: number }) => (r.weight === 700 ? 1 : 0)

  it('a string is one run a line, an empty line an empty list', () => {
    expect(layoutLines('Ship\n\nit', fontOf)).toEqual([
      [{ t: 'Ship' }],
      [],
      [{ t: 'it' }],
    ])
    expect(layoutLines('', fontOf)).toEqual([[]])
    expect(layoutLines('Ship\n\nit', fontOf)).toEqual(plainLines('Ship\n\nit'))
  })

  it('a run that holds a line break keeps its style on both lines', () => {
    expect(
      layoutLines(
        [{ text: 'Ship ' }, { text: 'it\nfaster', weight: 700, color: '#f00' }],
        fontOf,
      ),
    ).toEqual([
      [{ t: 'Ship ' }, { t: 'it', f: 1, c: '#f00' }],
      [{ t: 'faster', f: 1, c: '#f00' }],
    ])
  })
})

describe('the block', () => {
  it('lays a plain line out as one stretch, placed by align', () => {
    const b = layoutTextBlock(
      plainLines('Ship it\nnow'),
      { align: 'center', metrics: METRICS },
      measure,
    )
    expect(b.width).toBe(70)
    expect(b.height).toBe(30 + 20 + 5)
    expect(b.lines.map((l) => [l.w, l.indent])).toEqual([
      [70, 0],
      [30, 20],
    ])
    expect(b.lines[0].frags).toEqual([{ t: 'Ship it', x: 0, w: 70, o: 0 }])
    // A block line is a layout line: it knows where it sits in the text.
    expect(b.lines.map((l) => [l.a, l.n])).toEqual([
      [0, 7],
      [8, 3],
    ])
  })

  it('places a styled stretch by the advance of what precedes it', () => {
    const lines: LayoutRun[][] = [
      [{ t: 'Ship ' }, { t: 'faster', f: 1, u: 1 }, { t: ' now' }],
    ]
    const b = layoutTextBlock(
      lines,
      { align: 'left', metrics: METRICS },
      measure,
    )
    expect(b.lines[0].frags.map((f) => [f.t, f.x, f.w])).toEqual([
      ['Ship ', 0, 50],
      ['faster', 50, 78],
      [' now', 128, 40],
    ])
    expect(b.width).toBe(168)
  })

  it('takes the gap after a line’s last grapheme off, where spacing is added by hand', () => {
    const spaced = spacedAdvance(measure, 4)
    const b = layoutTextBlock(
      plainLines('abc\n'),
      { align: 'left', metrics: METRICS, trailingGap: 4 },
      spaced,
    )
    // 30 + two gaps between three graphemes; an empty line is 0, never -4.
    expect(b.lines.map((l) => l.w)).toEqual([38, 0])
  })
})

describe('split units', () => {
  const opts = { letterSpacing: 0, align: 'left' as const, metrics: METRICS }

  it('a string and its lines of runs are one layout', () => {
    for (const type of ['chars', 'words', 'lines'] as const) {
      expect(layoutSplitUnits('Ship it\nnow', type, opts, measure)).toEqual(
        layoutSplitUnits(plainLines('Ship it\nnow'), type, opts, measure),
      )
    }
  })

  it('a unit set in one style draws one part, from its own left', () => {
    const u = layoutSplitUnits('Ship it', 'words', opts, measure).units
    expect(u.map((x) => x.text)).toEqual(['Ship', 'it'])
    expect(u[1].parts).toEqual([{ t: 'it', x: 0, w: 20, o: 0 }])
  })

  it('a word set half in bold draws each half in its own font, one after the other', () => {
    const lines: LayoutRun[][] = [
      [{ t: 're', f: 1, c: '#f00' }, { t: 'quest builder' }],
    ]
    const { units } = layoutSplitUnits(lines, 'words', opts, measure)
    expect(units.map((u) => u.text)).toEqual(['request', 'builder'])
    expect(units[0].parts).toEqual([
      { t: 're', f: 1, c: '#f00', x: 0, w: 26, o: 0 },
      { t: 'quest', x: 26, w: 50, o: 2 },
    ])
    expect(units[0].width).toBe(76)
    // The next word stands after the first one's advance and the space.
    expect(units[1].offsetX - units[1].width / 2).toBe(
      units[0].offsetX - units[0].width / 2 + 76 + 10,
    )
  })

  it('keeps a style through chars and lines', () => {
    const lines: LayoutRun[][] = [[{ t: 'a', f: 1 }, { t: 'b c' }]]
    const chars = layoutSplitUnits(lines, 'chars', opts, measure).units
    expect(chars.map((u) => [u.text, u.parts[0].f ?? 0])).toEqual([
      ['a', 1],
      ['b', 0],
      ['c', 0],
    ])
    const whole = layoutSplitUnits(lines, 'lines', opts, measure).units
    expect(whole[0].parts.map((p) => p.t)).toEqual(['a', 'b c'])
  })
})

describe('the painter', () => {
  it('draws a plain element as it always did: one fill a line, in its font', () => {
    draw(el({ content: 'Ship it\nnow' }))
    expect(texts().map((c) => [c.text, c.x, c.font, c.fill])).toEqual([
      ['Ship it', 10, 'normal 400 24px Lexend', '#fff'],
      ['now', 10, 'normal 400 24px Lexend', '#fff'],
    ])
    expect(rects()).toEqual([])
  })

  it('draws each stretch of a styled line in its own font and colour', () => {
    draw(el({ content: RUNS }))
    expect(texts().map((c) => [c.text, c.font, c.fill])).toEqual([
      ['Ship ', 'normal 400 24px Lexend', '#fff'],
      ['faster', 'normal 700 24px Lexend', '#e37358'],
      [' now', 'italic 400 24px Lexend', '#fff'],
    ])
    // Each stands after the advance of what precedes it (10 is the padding).
    expect(texts().map((c) => c.x)).toEqual([10, 60, 60 + 6 * 13])
  })

  it('the underline goes under its glyphs and the strikethrough over them', () => {
    draw(el({ content: RUNS }))
    const order = calls.map((c) => (c.op === 'fillRect' ? 'rect' : c.text))
    expect(order).toEqual(['Ship ', 'rect', 'faster', ' now', 'rect'])
    const [underline, strike] = rects()
    expect(underline.fill).toBe('#e37358')
    expect(underline.x).toBe(60)
    expect(underline.w).toBe(78)
    // Below the baseline, and above it.
    const baseline = texts()[0].y
    expect(underline.y).toBeGreaterThan(baseline)
    expect(strike.y).toBeLessThan(baseline)
  })

  it('a highlight is drawn first and never wears the text’s shadow', () => {
    draw(
      el({
        content: [{ text: 'Ship ' }, { text: 'faster', highlight: '#222' }],
        shadow: { color: '#000', blur: 8 },
      }),
    )
    expect(calls[0]).toMatchObject({ op: 'fillRect', fill: '#222' })
    expect(calls[0].shadow).toBe(false)
    expect(texts().every((c) => c.shadow)).toBe(true)
  })

  it('a run is upright on an italic element when it says so', () => {
    draw(
      el({
        content: [{ text: 'All ' }, { text: 'this', italic: false }],
        font: { size: 24, family: 'Lexend', weight: 400, style: 'italic' },
      }),
    )
    expect(texts().map((c) => c.font)).toEqual([
      'italic 400 24px Lexend',
      'normal 400 24px Lexend',
    ])
  })

  it('a styled word under a stroke is stroked under its fill', () => {
    draw(el({ content: RUNS, stroke: { color: '#000', width: 2 } }))
    const ink = calls.filter((c) => c.op !== 'fillRect').map((c) => c.op)
    expect(ink).toEqual([
      'strokeText',
      'fillText',
      'strokeText',
      'fillText',
      'strokeText',
      'fillText',
    ])
  })

  it('split units draw their parts: a word set in two styles is one mesh', () => {
    calls = []
    const r = renderSplitTextElement(
      el({
        content: [{ text: 're', weight: 700 }, { text: 'quest now' }],
        split: { type: 'words' },
      }),
      RESOLUTION,
      THREE,
    )
    expect(r.meshes.map((m) => m.text)).toEqual(['request', 'now'])
    expect(texts().map((c) => [c.text, c.font])).toEqual([
      ['re', 'normal 700 24px Lexend'],
      ['quest', 'normal 400 24px Lexend'],
      ['now', 'normal 400 24px Lexend'],
    ])
  })

  it('adds letter-spacing by hand, stretch by stretch, where the platform has none', () => {
    native = false
    try {
      const r = draw(
        el({
          content: [{ text: 'ab' }, { text: 'cd', weight: 700 }],
          font: { size: 24, family: 'Lexend', weight: 400, letterSpacing: 4 },
        }),
      )
      // Per grapheme, each after the one before it and one gap.
      expect(texts().map((c) => [c.text, c.x])).toEqual([
        ['a', 10],
        ['b', 24],
        ['c', 38],
        ['d', 55],
      ])
      // 20 + 26 and three gaps between four graphemes, plus the padding.
      expect(r.width).toBe(20 + 26 + 12 + 20)
    } finally {
      native = true
    }
  })
})

describe('the measured layout, as a host reads it', () => {
  // A host stands a caret on an element with a probe over a canvas of its
  // own: the same function the renderer measures with, so the same box.
  const probe = (nativeSpacing: boolean): TextProbe => ({
    nativeSpacing,
    advance: (t, font, ls) =>
      widthIn(t, font) + (nativeSpacing ? ls * t.length : 0),
    lineBox: () => ({ fontBoundingBoxAscent: 20, fontBoundingBoxDescent: 5 }),
  })

  it('is the box the renderer draws in', () => {
    for (const content of ['Ship it\nnow', RUNS]) {
      const config = el({ content, stroke: { color: '#000', width: 3 } })
      const laid = layoutTextElement(config, probe(true))
      const drawn = draw(config)
      expect([laid.designWidth, laid.designHeight]).toEqual([
        drawn.width,
        drawn.height,
      ])
      expect(laid.padding).toBe(16)
    }
  })

  it('names each stretch, its font and where its line sits in the text', () => {
    const laid = layoutTextElement(el({ content: RUNS }), probe(true))
    expect(laid.variants).toEqual([
      { weight: 400, style: 'normal' },
      { weight: 700, style: 'normal' },
      { weight: 400, style: 'italic' },
    ])
    expect(laid.block.lines[0].frags.map((f) => [f.t, f.f ?? 0, f.x])).toEqual([
      ['Ship ', 0, 0],
      ['faster', 1, 50],
      [' now', 2, 128],
    ])
    expect(laid.block.lines[0]).toMatchObject({ a: 0, n: 15 })
  })

  it('adds letter-spacing where the probe has none, to the same ink width less the last gap', () => {
    const font = { size: 24, family: 'Lexend', weight: 400, letterSpacing: 4 }
    const withNative = layoutTextElement(
      el({ content: 'abcd', font }),
      probe(true),
    )
    const byHand = layoutTextElement(
      el({ content: 'abcd', font }),
      probe(false),
    )
    expect(withNative.block.width).toBe(40 + 16)
    expect(byHand.block.width).toBe(40 + 12)
  })
})

describe('live edits', () => {
  it('a content write takes a string or runs, and anything else as words', () => {
    expect(rasterPropPatch('content', 'Hi', {})).toEqual({ content: 'Hi' })
    expect(rasterPropPatch('content', RUNS, {})).toEqual({ content: RUNS })
    expect(rasterPropPatch('content', 3, {})).toEqual({ content: '3' })
    expect(rasterPropPatch('content', [{ text: 'a' }], {})).toEqual({
      content: 'a',
    })
  })

  it('rerender(runs) re-measures and redraws in place', () => {
    const r = draw(el())
    const mesh = r.mesh
    const before = r.width
    calls = []
    const dims = r.rerender({ content: RUNS })
    expect(r.mesh).toBe(mesh)
    expect(dims.width).toBeGreaterThan(before)
    expect(texts().map((c) => c.text)).toEqual(['Ship ', 'faster', ' now'])
    // And back to a string: one fill again.
    calls = []
    r.rerender({ content: 'Ship it' })
    expect(texts().map((c) => c.text)).toEqual(['Ship it'])
  })
})

describe('runs bound to data', () => {
  const config = el({
    content: [
      { text: { $data: 'lead' } },
      { text: { $data: 'word' }, weight: 700, color: '#e37358' },
      { text: '!' },
    ],
  })
  const ACCENT = el({
    content: [
      { text: 'Ship it ' },
      { text: 'faster', weight: 700, color: { $data: 'accent' } },
      { text: ' today', highlight: { $data: 'wash' } },
    ],
  })

  it('says whether a content reads data: its whole, a run’s words, a run’s colours', () => {
    expect(contentIsBound({ $data: 'headline' })).toBe(true)
    expect(contentIsBound(config.content)).toBe(true)
    expect(contentIsBound(ACCENT.content)).toBe(true)
    expect(contentIsBound(RUNS)).toBe(false)
    expect(contentIsBound('Ship it')).toBe(false)
    expect(extractTextBindings(config)).toEqual({ runs: true })
    expect(extractTextBindings(ACCENT)).toEqual({ runs: true })
    expect(extractTextBindings(el({ content: RUNS }))).toBeNull()
  })

  it('reads bound words and keeps their style, and the config its refs', () => {
    const data = { lead: 'Meet ', word: 'Genesis' }
    const resolved = resolveTextElement(
      config,
      extractTextBindings(config)!,
      data,
    )
    expect(resolved.content).toEqual([
      { text: 'Meet ' },
      { text: 'Genesis', weight: 700, color: '#e37358' },
      { text: '!' },
    ])
    expect(config.content[0].text).toEqual({ $data: 'lead' })
    // A key that holds no words leaves the run empty, and it is dropped:
    // what is left is set in one style, so it is a string again.
    expect(resolveTextContent(config.content, { lead: 'Meet ' })).toBe('Meet !')
  })

  it('reads a bound colour, and paints the element’s own where the key holds none', () => {
    expect(
      resolveTextContent(ACCENT.content, { accent: '#00ff88', wash: '#222' }),
    ).toEqual([
      { text: 'Ship it ' },
      { text: 'faster', weight: 700, color: '#00ff88' },
      { text: ' today', highlight: '#222' },
    ])
    expect(resolveTextContent(ACCENT.content, { accent: 7 })).toEqual([
      { text: 'Ship it ' },
      { text: 'faster', weight: 700 },
      { text: ' today' },
    ])
    // Content that reads nothing comes back as it was written.
    expect(resolveTextContent(RUNS, {})).toBe(RUNS)
  })

  it('a data edit redraws the words under their style, and only when they changed', async () => {
    const scenes = { 100: new THREE.Scene() }
    const map = await renderElements(
      [JSON.parse(JSON.stringify(config))],
      scenes as any,
      RESOLUTION,
      THREE,
      { lead: 'Meet ', word: 'Genesis' },
    )
    const inst = map.get('t')
    expect(inst.updateData({ lead: 'Meet ', word: 'Genesis' })).toBe(false)
    calls = []
    expect(inst.updateData({ lead: 'Meet ', word: 'Exodus' })).toBe(true)
    inst.flushRaster()
    expect(texts().map((c) => [c.text, c.font, c.fill])).toEqual([
      ['Meet ', 'normal 400 24px Lexend', '#fff'],
      ['Exodus', 'normal 700 24px Lexend', '#e37358'],
      ['!', 'normal 400 24px Lexend', '#fff'],
    ])
  })

  it('a knob turns a bound colour with no word touched', async () => {
    const map = await renderElements(
      [JSON.parse(JSON.stringify(ACCENT))],
      { 100: new THREE.Scene() } as any,
      RESOLUTION,
      THREE,
      { accent: '#e37358' },
    )
    const inst = map.get('t')
    const mesh = inst.mesh
    expect(inst.updateData({ accent: '#e37358' })).toBe(false)
    calls = []
    expect(inst.updateData({ accent: '#00ff88', wash: '#222' })).toBe(true)
    inst.flushRaster()
    // The same mesh, redrawn: the accent word in the knob's colour, and the
    // highlight that now has one.
    expect(inst.mesh).toBe(mesh)
    expect(texts().map((c) => [c.text, c.fill])).toEqual([
      ['Ship it ', '#fff'],
      ['faster', '#00ff88'],
      [' today', '#fff'],
    ])
    expect(rects().map((c) => c.fill)).toEqual(['#222'])
  })

  it('a live write may carry bindings: they are read now, and again when the data moves', async () => {
    // The element's own config binds nothing.
    const map = await renderElements(
      [el({ content: 'Ship it' })],
      { 100: new THREE.Scene() } as any,
      RESOLUTION,
      THREE,
      { accent: '#e37358' },
    )
    const inst = map.get('t')
    expect(inst.updateData({ accent: '#00ff88' })).toBe(false)
    calls = []
    inst.setContent([
      { text: 'Ship ' },
      { text: 'it', color: { $data: 'accent' } },
    ])
    inst.flushRaster()
    expect(texts().map((c) => [c.text, c.fill])).toEqual([
      ['Ship ', '#fff'],
      ['it', '#00ff88'],
    ])
    calls = []
    expect(inst.updateData({ accent: '#123456' })).toBe(true)
    inst.flushRaster()
    expect(texts().map((c) => c.fill)).toEqual(['#fff', '#123456'])
    // A plain write after it reads nothing: the data no longer moves it.
    inst.setContent('Ship it')
    inst.flushRaster()
    expect(inst.updateData({ accent: '#abcdef' })).toBe(false)
  })

  it('a bound split text rebuilds its units in the new colour', async () => {
    const map = await renderElements(
      [{ ...JSON.parse(JSON.stringify(ACCENT)), split: { type: 'words' } }],
      { 100: new THREE.Scene() } as any,
      RESOLUTION,
      THREE,
      { accent: '#e37358' },
    )
    const inst = map.get('t')
    calls = []
    expect(inst.updateData({ accent: '#00ff88' })).toBe(true)
    expect(inst.structural).toBe(true)
    expect(texts().find((c) => c.text === 'faster')!.fill).toBe('#00ff88')
  })
})

describe('a binding is a value: it rides its run through every edit', () => {
  const REF = { $data: 'accent' }
  const text: RichText = [
    { text: 'Ship it ' },
    { text: 'faster', weight: 700, color: REF },
    { text: ' today' },
  ]

  it('is kept at a boundary, alone, and dropped when it is not one', () => {
    expect(
      toRichText([
        { text: 'a', color: { $data: 'accent', note: 'mine' } },
        { text: 'b', color: { $data: '' } },
        { text: 'c', highlight: { key: 'wash' } },
      ]),
    ).toEqual([{ text: 'a', color: { $data: 'accent' } }, { text: 'bc' }])
  })

  it('neighbours bound to the same key are one run; to another key, two', () => {
    expect(
      normalizeRuns([
        { text: 'a', color: { $data: 'accent' } },
        { text: 'b', color: { $data: 'accent' } },
        { text: 'c', color: { $data: 'other' } },
      ]),
    ).toEqual([
      { text: 'ab', color: { $data: 'accent' } },
      { text: 'c', color: { $data: 'other' } },
    ])
  })

  it('typing inside a bound run keeps the binding', () => {
    expect(replaceRange(text, 11, 11, 'XY')).toEqual([
      { text: 'Ship it ' },
      { text: 'fasXYter', weight: 700, color: REF },
      { text: ' today' },
    ])
  })

  it('a style set over part of it cuts it in two, each half still bound', () => {
    expect(toggleStyle(text, 8, 11, 'underline', true)).toEqual([
      { text: 'Ship it ' },
      { text: 'fas', weight: 700, color: REF, underline: true },
      { text: 'ter', weight: 700, color: REF },
      { text: ' today' },
    ])
  })

  it('a literal colour set over it replaces the binding there, and only there', () => {
    expect(setStyle(text, 8, 11, { color: '#fff' })).toEqual([
      { text: 'Ship it ' },
      { text: 'fas', weight: 700, color: '#fff' },
      { text: 'ter', weight: 700, color: REF },
      { text: ' today' },
    ])
  })

  it('a selection agrees on a binding, or is mixed with a literal', () => {
    expect(commonStyle(text, 8, 14).color).toEqual(REF)
    expect(commonStyle(text, 0, 14).color).toBe(MIXED)
    const two: RichText = [
      { text: 'a', color: { $data: 'accent' } },
      { text: 'b', color: { $data: 'accent' }, underline: true },
    ]
    expect(commonStyle(two, 0, 2).color).toEqual(REF)
  })

  it('is read where the run is drawn, and paints nothing of its own until then', () => {
    expect(resolveRunColors(text, { accent: '#0f8' })).toEqual([
      { text: 'Ship it ' },
      { text: 'faster', weight: 700, color: '#0f8' },
      { text: ' today' },
    ])
    // Unread, the words take the colour of what they are set in.
    expect(resolveRunColors(text, null)).toEqual([
      { text: 'Ship it ' },
      { text: 'faster', weight: 700 },
      { text: ' today' },
    ])
    expect(layoutLines(text, () => 0)[0].map((r) => r.c)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })
})
