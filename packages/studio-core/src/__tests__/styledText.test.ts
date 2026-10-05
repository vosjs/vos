import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { DOC_SCHEMA_VERSION, migrateHostedDoc } from '../docVersion'
import { lowerProgramDoc } from '../lower/lowerStudioDoc'
import { lowerToComposition } from '../lower/lowerToComposition'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import {
  boldWeightFor,
  overlayFontFaces,
  overlayPlainText,
  overlayRect,
  resolveOverlayFx,
  snapRunWeight,
  styledTextOf,
} from '../overlayText'
import {
  marksEmphasis,
  migrateText,
  migrateTextClip,
} from '../richText/migrateEmphasis'
import { overlaysLane } from '../timeline/lanes'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { studioEntryOf } from './helpers/studio'
import type { ProgramAnchorDoc } from '../doc/studioDoc'
import type { OverlayClip, ProjectDoc, TextOverlayClip } from '../types'

/**
 * A text layer's words are a string or a list of runs, each a piece of text
 * and the fields in which it departs from the layer's style. The lowering
 * resolves the runs against the layer (weights snap, italic inherits) into
 * the styled payload the page lays out and paints; the host measures with
 * the same layout. The retired `*marked*` emphasis is read into runs.
 */

function clip(over: Partial<TextOverlayClip> = {}): TextOverlayClip {
  return {
    id: 'o1',
    kind: 'text',
    start: 0.5,
    duration: 3,
    text: 'Hello',
    preset: 'caption',
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    ...over,
  }
}

/** A layer in the retired spelling (the type no longer admits it). */
const legacy = (
  text: string,
  emphasis: { weight?: number; color?: string } | null = {},
  over: Partial<TextOverlayClip> = {},
) => ({ ...clip(over), text, emphasis }) as unknown as TextOverlayClip

function makeDoc(overlays: OverlayClip[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    overlays,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

/** 10 px a char; 13 in a 700 face; 11 in an italic. A style cannot hide. */
const widthIn = (text: string, font: string) =>
  text.length *
  (/(^|\s)700\s/.test(font) ? 13 : /^italic\s/.test(font) ? 11 : 10)

describe('the words of a layer', () => {
  it('are the same whichever shape the text is in', () => {
    expect(overlayPlainText(clip({ text: 'Ship it' }))).toBe('Ship it')
    expect(
      overlayPlainText(
        clip({ text: [{ text: 'Ship ' }, { text: 'it', weight: 700 }] }),
      ),
    ).toBe('Ship it')
  })

  it('label the timeline clip without any markup', () => {
    const doc = makeDoc([
      clip({ text: [{ text: 'Ship ' }, { text: 'faster', weight: 700 }] }),
    ])
    expect(overlaysLane.items(doc)[0].label).toBe('Ship faster')
  })

  it('feed a per-unit entrance as words, never as marks', () => {
    const fx = resolveOverlayFx(
      clip({
        text: [
          { text: 'Ship ' },
          { text: 'it', weight: 700 },
          { text: ' now' },
        ],
        anim: { enter: { kind: 'fade', unit: 'word' } },
      }),
      3,
    )!
    expect(fx.units).toEqual([['Ship ', 'it ', 'now']])
    expect(fx.n).toBe(3)
  })
})

describe('the styled payload', () => {
  it('is null for a layer set in one style, array or not', () => {
    expect(styledTextOf(clip({ text: 'plain' }))).toBeNull()
    expect(
      styledTextOf(clip({ text: [{ text: 'still ' }, { text: 'plain' }] })),
    ).toBeNull()
  })

  it('resolves each run against the layer: fonts by index, the rest as it is', () => {
    const styled = styledTextOf(
      clip({
        text: [
          { text: 'a ' },
          { text: 'b', weight: 700, color: '#ff0000' },
          { text: ' c', underline: true },
          { text: 'd', strike: true, highlight: '#222222' },
        ],
      }),
    )!
    expect(styled.fs).toEqual([{ w: 400 }, { w: 700 }])
    expect(styled.l).toEqual([
      [
        { t: 'a ' },
        { t: 'b', f: 1, c: '#ff0000' },
        { t: ' c', u: 1 },
        { t: 'd', s: 1, h: '#222222' },
      ],
    ])
  })

  it('splits lines at the breaks inside runs, the style carried across', () => {
    const styled = styledTextOf(
      clip({ text: [{ text: 'a\nb', weight: 700 }, { text: '\n\nc' }] }),
    )!
    expect(styled.l).toEqual([
      [{ t: 'a', f: 1 }],
      [{ t: 'b', f: 1 }],
      [],
      [{ t: 'c' }],
    ])
  })

  it('snaps a run weight to the family, like the layer weight', () => {
    // Lexend hosts 400 and 600 and 700 among others; 650 is not a step.
    const c = clip({ text: [{ text: 'a' }, { text: 'b', weight: 650 }] })
    expect(styledTextOf(c)!.fs[1].w).toBe(snapRunWeight(c, 650))
    expect([600, 700]).toContain(snapRunWeight(c, 650))
  })

  it('a weight the family cannot offer is no second style at all', () => {
    // Bebas Neue hosts one weight: bold resolves to the layer's own font.
    const c = clip({
      family: 'Bebas Neue',
      text: [{ text: 'a ' }, { text: 'b', weight: 700 }],
    })
    expect(boldWeightFor(c)).toBe(400)
    expect(styledTextOf(c)!.fs).toEqual([{ w: 400 }])
    expect(styledTextOf(c)!.l).toEqual([[{ t: 'a ' }, { t: 'b' }]])
  })

  it('an italic run on an upright layer, and an upright run on an italic one', () => {
    const up = styledTextOf(
      clip({ text: [{ text: 'a' }, { text: 'b', italic: true }] }),
    )!
    expect(up.fs).toEqual([{ w: 400 }, { w: 400, i: 1 }])
    const it = styledTextOf(
      clip({
        italic: true,
        text: [{ text: 'a' }, { text: 'b', italic: false }],
      }),
    )!
    expect(it.fs).toEqual([{ w: 400, i: 1 }, { w: 400 }])
  })

  it('names the faces to load beyond the layer own, and the document lists them', () => {
    const c = clip({
      family: 'Sora',
      text: [{ text: 'a' }, { text: 'b', weight: 700 }],
    })
    expect(styledTextOf(c)!.faces).toEqual([
      expect.objectContaining({ f: 'Sora', w: 700 }),
    ])
    expect(
      overlayFontFaces(makeDoc([c])).some(
        (f) => f.family === 'Sora' && f.weight === 700,
      ),
    ).toBe(true)
  })

  it('hashes what it paints, so an edit to a run is a new layout', () => {
    const h = (word: string, color?: string) =>
      styledTextOf(
        clip({ text: [{ text: 'a ' }, { text: word, weight: 700, color }] }),
      )!.h
    expect(h('b')).toBe(h('b'))
    expect(h('b')).not.toBe(h('c'))
    expect(h('b')).not.toBe(h('b', '#ff0000'))
  })
})

describe('lowering', () => {
  it('bakes the words as lines and the styling as `rt` beside them', () => {
    const lowered = lowerToComposition(
      makeDoc([
        clip({
          text: [{ text: 'Read ' }, { text: 'every candle', weight: 700 }],
        }),
      ]),
    )
    const ol = (
      lowered.stack[STUDIO_ENTRY_ID] as { overlays: Record<string, unknown>[] }
    ).overlays[0]
    expect(ol.text).toBe('Read every candle')
    expect(ol.lines).toEqual(['Read every candle'])
    expect(ol.rt).toMatchObject({
      l: [[{ t: 'Read ' }, { t: 'every candle', f: 1 }]],
      fs: [{ w: 400 }, { w: 700 }],
    })
  })

  it('a plain layer bakes no `rt`: its data is what it always was', () => {
    const lowered = lowerToComposition(makeDoc([clip({ text: 'Plain' })]))
    const ol = (
      lowered.stack[STUDIO_ENTRY_ID] as { overlays: Record<string, unknown>[] }
    ).overlays[0]
    expect('rt' in ol).toBe(false)
    expect(ol.lines).toEqual(['Plain'])
  })

  it('reads the retired spelling in a program document too', () => {
    const lowered = lowerProgramDoc({
      program: { config: { version: 2, duration: 4 } },
      overlays: [legacy('Read *every* candle')],
    } as unknown as ProgramAnchorDoc)
    const ol = (
      lowered.stack[STUDIO_ENTRY_ID] as { overlays: Record<string, unknown>[] }
    ).overlays[0]
    expect(ol.lines).toEqual(['Read every candle'])
    expect(ol.rt).toBeDefined()
  })

  it('reads the retired spelling on its way in', () => {
    const lowered = lowerToComposition(makeDoc([legacy('Read *every* candle')]))
    const ol = (
      lowered.stack[STUDIO_ENTRY_ID] as { overlays: Record<string, unknown>[] }
    ).overlays[0]
    expect(ol.lines).toEqual(['Read every candle'])
    expect(ol.rt).toMatchObject({
      l: [[{ t: 'Read ' }, { t: 'every', f: 1 }, { t: ' candle' }]],
    })
  })
})

describe('painting (the entry on a stub canvas)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  interface Drawn {
    text: string
    x: number
    font: string
    fill: string
  }
  function draw(overlays: OverlayClip[], time: number) {
    const lowered = lowerToComposition(makeDoc(overlays))
    const onFrame = new Function(
      `return (${studioEntryOf(lowered.config).onFrame})`,
    )() as (ctx: unknown, content: unknown, dt: number) => void
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map(),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const texts: Drawn[] = []
    const rects: {
      x: number
      y: number
      w: number
      h: number
      fill: string
    }[] = []
    const st = { font: '', fillStyle: '' }
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText')
            return (text: string) => ({ width: widthIn(text, st.font) })
          if (key === 'fillText')
            return (text: string, x: number) =>
              texts.push({ text, x, font: st.font, fill: st.fillStyle })
          if (key === 'fillRect')
            return (x: number, y: number, w: number, h: number) =>
              rects.push({ x, y, w, h, fill: st.fillStyle })
          if (key === 'font') return st.font
          if (key === 'fillStyle') return st.fillStyle
          return () => undefined
        },
        set: (_t, key: string, v: unknown) => {
          if (key === 'font') st.font = String(v)
          if (key === 'fillStyle') st.fillStyle = String(v)
          return true
        },
      },
    )
    onFrame(
      {
        time,
        data: lowered.stack[STUDIO_ENTRY_ID],
        renderer: undefined,
        resolution: {
          width: 1920,
          height: 1080,
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
        },
      },
      {
        refs: {
          ov: {
            c2d,
            canvas: { width: 1920, height: 1080 },
            texture: { needsUpdate: false, dispose: () => undefined },
            mesh: null,
          },
          objects: null,
        },
      },
      1 / 30,
    )
    return { texts, rects }
  }

  const SHIP = clip({
    text: [
      { text: 'Ship ' },
      { text: 'faster', weight: 700, color: '#ff0000' },
      { text: ' now' },
    ],
  })

  it('draws each run in its font and colour, left to right from the line edge', () => {
    const { texts } = draw([SHIP], 1.5)
    expect(texts.map((t) => t.text)).toEqual(['Ship ', 'faster', ' now'])
    expect(texts.map((t) => /(^|\s)700\s/.test(t.font))).toEqual([
      false,
      true,
      false,
    ])
    expect(texts[1].fill).toBe('#ff0000')
    expect(texts[0].fill).not.toBe('#ff0000')
    // 50 + 78 + 40 = 168 wide, centred on the anchor.
    expect(texts.map((t) => t.x)).toEqual([-84, -34, 44])
  })

  it('the host measures the width the painter draws (picking agrees)', () => {
    const { texts } = draw([SHIP], 1.5)
    const painted = texts.reduce((w, r) => w + widthIn(r.text, r.font), 0)
    const rect = overlayRect(SHIP, (text, font) => widthIn(text, font), 1920)
    expect(painted).toBe(168)
    expect(rect.w).toBeCloseTo(painted, 6)
  })

  it('an italic run is set in an italic font, at its own width', () => {
    const c = clip({ text: [{ text: 'ab ' }, { text: 'cd', italic: true }] })
    const { texts } = draw([c], 1.5)
    expect(texts[1].font.startsWith('italic ')).toBe(true)
    expect(texts[0].font.startsWith('italic ')).toBe(false)
    expect(overlayRect(c, widthIn, 1920).w).toBeCloseTo(30 + 22, 6)
  })

  it('an underline is drawn under its run, a strike over it, a highlight behind', () => {
    const c = clip({
      text: [
        { text: 'aa' },
        { text: 'bb', underline: true },
        { text: 'cc', strike: true },
        { text: 'dd', highlight: '#123456' },
      ],
    })
    const { rects, texts } = draw([c], 1.5)
    // 80 wide: runs start at -40, -20, 0, 20, each 20 wide.
    const at = (x: number) => rects.filter((r) => r.x === x && r.w === 20)
    expect(at(-20)).toHaveLength(1)
    expect(at(0)).toHaveLength(1)
    expect(at(20)).toHaveLength(1)
    expect(at(20)[0].fill).toBe('#123456')
    // Underline below the strike, the highlight around both.
    expect(at(-20)[0].y).toBeGreaterThan(at(0)[0].y)
    expect(at(20)[0].y).toBeLessThan(at(0)[0].y)
    expect(at(20)[0].h).toBeGreaterThan(at(-20)[0].h)
    expect(texts.map((t) => t.text)).toEqual(['aa', 'bb', 'cc', 'dd'])
  })

  it('a word-by-word reveal keeps each word in its style, mid-word changes included', () => {
    const c = clip({
      text: [
        { text: 'un' },
        { text: 'believ', weight: 700 },
        { text: 'able now' },
      ],
      anim: { enter: { kind: 'fade', unit: 'word', stagger: 0.05 } },
    })
    const { texts } = draw([c], 3)
    expect(texts.map((t) => [t.text, /(^|\s)700\s/.test(t.font)])).toEqual([
      ['un', false],
      ['believ', true],
      ['able ', false],
      ['now', false],
    ])
  })

  it('a styled run wraps at its own width', () => {
    // 'aaaa bbbb' fits 100 px plain (90) and not with a bold second word (102).
    const wide = (bold: boolean) =>
      draw(
        [
          clip({
            maxWidth: 100 / 1920,
            text: bold
              ? [{ text: 'aaaa ' }, { text: 'bbbb', weight: 700 }]
              : 'aaaa bbbb',
            align: 'left',
          }),
        ],
        1.5,
      ).texts
    expect(wide(false)).toHaveLength(1)
    const two = wide(true)
    expect(two.map((t) => t.text)).toEqual(['aaaa ', 'bbbb'])
    expect(two[0].x).toBe(two[1].x) // both at the block's left edge
  })
})

describe('the retired emphasis, read into runs', () => {
  const runs = (text: string, em: Parameters<typeof legacy>[1] = {}) =>
    migrateTextClip(legacy(text, em)).text

  it('each marked word is a run in the bold step; a space is never marked', () => {
    expect(runs('Set up *different purposes*')).toEqual([
      { text: 'Set up ' },
      { text: 'different', weight: 700 },
      { text: ' ' },
      { text: 'purposes', weight: 700 },
    ])
  })

  it('keeps punctuation where the author put it', () => {
    expect(runs('Show *price*, *volume*')).toEqual([
      { text: 'Show ' },
      { text: 'price', weight: 700 },
      { text: ', ' },
      { text: 'volume', weight: 700 },
    ])
  })

  it('carries the weight and colour the layer named', () => {
    expect(runs('*a*', { weight: 600, color: '#ffffff' })).toEqual([
      { text: 'a', weight: 600, color: '#ffffff' },
    ])
  })

  it('pairs markers per line, and reads \\* as an asterisk', () => {
    expect(runs('*a\nb*')).toBe('*a\nb*')
    expect(runs('*a*\n*b*')).toEqual([
      { text: 'a', weight: 700 },
      { text: '\n' },
      { text: 'b', weight: 700 },
    ])
    expect(runs('5\\* rated *app*')).toEqual([
      { text: '5* rated ' },
      { text: 'app', weight: 700 },
    ])
  })

  it('nothing marked is a string, with the field gone', () => {
    const c = migrateTextClip(legacy('2 * 3 = 6'))
    expect(c.text).toBe('2 * 3 = 6')
    expect('emphasis' in c).toBe(false)
    expect(runs('an empty ** pair')).toBe('an empty ** pair')
  })

  it('a layer without the field is untouched, asterisks and all', () => {
    const c = clip({ text: 'Display *this* as typed' })
    expect(migrateTextClip(c)).toBe(c)
    expect(styledTextOf(c)).toBeNull()
  })

  it('`emphasis: null` only loses the field', () => {
    const c = migrateTextClip(legacy('keep *this*', null))
    expect(c.text).toBe('keep *this*')
    expect('emphasis' in c).toBe(false)
  })

  it('says whether a text marks anything (the lint asks)', () => {
    expect(marksEmphasis('a *b* c')).toBe(true)
    expect(marksEmphasis('2 * 3')).toBe(false)
  })

  it('a document with nothing to migrate is the same object, and twice is once', () => {
    const plainDoc = makeDoc([clip()])
    expect(migrateText(plainDoc)).toBe(plainDoc)
    const once = migrateText(makeDoc([legacy('a *b*')]))
    expect(migrateText(once)).toBe(once)
  })

  it('a hosted document is migrated on read and stamped', () => {
    const hosted = migrateHostedDoc({
      ...makeDoc([legacy('a *b*')]),
      docSchemaVersion: 5,
    } as unknown as Record<string, unknown>)
    expect(hosted.docSchemaVersion).toBe(DOC_SCHEMA_VERSION)
    expect(DOC_SCHEMA_VERSION).toBe(6)
    const o = (hosted.overlays as TextOverlayClip[])[0]
    expect(o.text).toEqual([{ text: 'a ' }, { text: 'b', weight: 700 }])
    expect('emphasis' in o).toBe(false)
  })

  it('is read even under a current stamp (an older client can still write it)', () => {
    const hosted = migrateHostedDoc({
      ...makeDoc([legacy('a *b*')]),
      docSchemaVersion: DOC_SCHEMA_VERSION,
    } as unknown as Record<string, unknown>)
    expect((hosted.overlays as TextOverlayClip[])[0].text).toEqual([
      { text: 'a ' },
      { text: 'b', weight: 700 },
    ])
    const current = {
      ...makeDoc([clip()]),
      docSchemaVersion: DOC_SCHEMA_VERSION,
    } as unknown as Record<string, unknown>
    expect(migrateHostedDoc(current)).toBe(current)
  })
})
