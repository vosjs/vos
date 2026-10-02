import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  EM_CLOSE,
  EM_OPEN,
  measureEmphasized,
  overlayFontFaces,
  overlayRect,
  parseEmphasis,
  resolveEmphasis,
  stripEmphasis,
} from '../overlayText'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { bothFrames, lowerMerged as lowerToComposition } from './helpers/studio'
import type { OverlayClip, ProjectDoc, TextOverlayClip } from '../types'

/**
 * `*marked*` words in a text layer are set in the emphasis weight, so a
 * light line can carry bold words (the two-weight caption) with the
 * per-word reveal still working across them. The markers become two
 * control characters around every emphasized word at lowering; ON_FRAME
 * switches fonts at them, and the host's measure agrees with its draw. A
 * layer with no markers lowers and paints exactly as it did.
 */

const O = EM_OPEN
const C = EM_CLOSE

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

/** A clip with emphasis ON: its asterisks are markers. */
const emClip = (over: Partial<TextOverlayClip> = {}) =>
  clip({ emphasis: {}, ...over })

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

/** A width a bold run cannot fake: 10 px a char, 13 in a 700 face. */
const widthIn = (text: string, font: string) =>
  text.length * (/(^|\s)700\s/.test(font) ? 13 : 10)

describe('parsing the markers', () => {
  it('marks every emphasized word on its own, never across a space', () => {
    expect(parseEmphasis('Set up *different purposes*')).toBe(
      `Set up ${O}different${C} ${O}purposes${C}`,
    )
    expect(parseEmphasis('a *b* c')).toBe(`a ${O}b${C} c`)
  })

  it('keeps punctuation inside the marks where the author put it', () => {
    expect(parseEmphasis('Show *price*, *volume*')).toBe(
      `Show ${O}price${C}, ${O}volume${C}`,
    )
  })

  it('is null when nothing is marked, so the source stays as it is', () => {
    expect(parseEmphasis('Hello')).toBeNull()
    expect(parseEmphasis('2 * 3 = 6')).toBeNull()
    expect(parseEmphasis('an empty ** pair')).toBeNull()
  })

  it('reads \\* as a literal asterisk, and pairs markers per line', () => {
    expect(parseEmphasis('5\\* rated *app*')).toBe(`5* rated ${O}app${C}`)
    expect(parseEmphasis('*a\nb*')).toBeNull()
    expect(parseEmphasis('*a*\n*b*')).toBe(`${O}a${C}\n${O}b${C}`)
  })

  it('reads back as the words a person sees', () => {
    expect(stripEmphasis(parseEmphasis('Set up *different purposes*')!)).toBe(
      'Set up different purposes',
    )
  })
})

describe('emphasis is opt-in', () => {
  it('without `emphasis`, asterisks are text as typed: no marks, no em', () => {
    const c = clip({ text: 'Display *this* as typed' })
    expect(resolveEmphasis(c)).toBeNull()
    const { data } = lowerToComposition(makeDoc([c]))
    const ol = (data as { overlays: Record<string, unknown>[] }).overlays[0]
    expect(ol.lines).toEqual(['Display *this* as typed'])
    expect('em' in ol).toBe(false)
  })

  it('`emphasis: {}` is enough to turn the markers on', () => {
    expect(resolveEmphasis(emClip({ text: 'a *b*' }))).not.toBeNull()
  })
})

describe('lowering', () => {
  it('an unmarked layer bakes exactly what it did', () => {
    const { data } = lowerToComposition(
      makeDoc([clip({ text: 'Plain words' })]),
    )
    const ol = (data as { overlays: Record<string, unknown>[] }).overlays[0]
    expect(ol.lines).toEqual(['Plain words'])
    expect('em' in ol).toBe(false)
  })

  it('a marked layer bakes its displayed lines and its emphasis weight', () => {
    const { data } = lowerToComposition(
      makeDoc([emClip({ text: 'Read *every candle*' })]),
    )
    const ol = (data as { overlays: Record<string, unknown>[] }).overlays[0]
    expect(ol.lines).toEqual([`Read ${O}every${C} ${O}candle${C}`])
    expect(ol.em).toMatchObject({ w: 700 })
  })

  it('the emphasis weight and colour are the clip’s to set', () => {
    const c = clip({
      text: '*a*',
      family: 'Sora',
      emphasis: { weight: 600, color: '#ffffff' },
    })
    expect(resolveEmphasis(c)).toMatchObject({ weight: 600, color: '#ffffff' })
    expect(resolveEmphasis(clip({ text: 'none' }))).toBeNull()
  })

  it('the emphasis face loads with the rest, so the first frame has it', () => {
    const faces = overlayFontFaces(
      makeDoc([emClip({ text: '*bold*', family: 'Sora' })]),
    )
    expect(faces.some((f) => f.family === 'Sora' && f.weight === 700)).toBe(
      true,
    )
  })
})

describe('drawing (stub ON_FRAME)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function draw(overlays: OverlayClip[], time: number) {
    const { config, data } = lowerToComposition(makeDoc(overlays))
    const onFrame = bothFrames(config)
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map(),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const texts: { text: string; x: number; font: string; align: string }[] = []
    const mk = (tag: string) => {
      const st = { font: '', textAlign: 'start' }
      return new Proxy(
        {},
        {
          get: (_t, key: string) => {
            if (key === 'measureText')
              return (text: string) => ({ width: widthIn(text, st.font) })
            if (key === 'createLinearGradient')
              return () => ({ addColorStop: () => {} })
            if (key === 'fillText')
              return (text: string, x: number) => {
                if (tag === 'ov')
                  texts.push({ text, x, font: st.font, align: st.textAlign })
              }
            if (key === 'font') return st.font
            if (key === 'textAlign') return st.textAlign
            return () => undefined
          },
          set: (_t, key: string, v: unknown) => {
            if (key === 'font') st.font = String(v)
            if (key === 'textAlign') st.textAlign = String(v)
            return true
          },
        },
      )
    }
    const layer = (tag: string) => ({
      c2d: mk(tag),
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    onFrame(
      {
        time,
        data,
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
          bg: layer('bg'),
          card: layer('card'),
          ov: layer('ov'),
          video: {
            videoWidth: 1600,
            videoHeight: 900,
            readyState: 2,
            paused: true,
            currentTime: 0,
            play: () => undefined,
            pause: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          },
          cam: null,
        },
      },
      1 / 30,
    )
    return texts
  }

  it('an unmarked layer draws its line whole, centred, as before', () => {
    const t = draw([clip({ text: 'Plain words' })], 1.5)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ text: 'Plain words', x: 0, align: 'center' })
  })

  it('draws the runs side by side, each in its weight', () => {
    const t = draw([emClip({ text: 'Set up *different purposes*' })], 1.5)
    expect(t.map((r) => r.text)).toEqual([
      'Set up ',
      'different',
      ' ',
      'purposes',
    ])
    expect(t.map((r) => /(^|\s)700\s/.test(r.font))).toEqual([
      false,
      true,
      false,
      true,
    ])
    // Contiguous: each run starts where the last ended.
    for (let i = 1; i < t.length; i++) {
      const prev = t[i - 1]
      expect(t[i].x).toBeCloseTo(prev.x + widthIn(prev.text, prev.font), 6)
    }
    // Centred as a line: its left edge is half its width left of the anchor.
    const total = t.reduce((w, r) => w + widthIn(r.text, r.font), 0)
    expect(t[0].x).toBeCloseTo(-total / 2, 6)
  })

  it('the host measures the width the painter draws (picking agrees)', () => {
    const c = emClip({ text: 'Set up *different purposes*' })
    const t = draw([c], 1.5)
    const painted = t.reduce((w, r) => w + widthIn(r.text, r.font), 0)
    const rect = overlayRect(c, (text, font) => widthIn(text, font), 1920)
    expect(rect.w).toBeCloseTo(painted, 6)
    expect(
      measureEmphasized(
        parseEmphasis(c.text)!,
        widthIn,
        '400 32px x',
        '700 32px x',
      ),
    ).toBe(painted)
  })

  it('a word-by-word reveal keeps each word in its weight', () => {
    const c = emClip({
      text: 'Read *every candle*',
      anim: { enter: { kind: 'fade', unit: 'word', stagger: 0.05 } },
    })
    const t = draw([c], 3) // settled
    const byText = Object.fromEntries(
      t.map((r) => [r.text.trim(), /(^|\s)700\s/.test(r.font)]),
    )
    expect(byText).toMatchObject({ Read: false, every: true, candle: true })
  })

  it('a char reveal inside a marked word is still bold', () => {
    const c = emClip({
      text: 'a *bc*',
      anim: { enter: { kind: 'fade', unit: 'char', stagger: 0.02 } },
    })
    const t = draw([c], 3)
    const b = t.find((r) => r.text === 'b')!
    const cc = t.find((r) => r.text === 'c')!
    const a = t.find((r) => r.text === 'a')!
    expect(/(^|\s)700\s/.test(b.font)).toBe(true)
    expect(/(^|\s)700\s/.test(cc.font)).toBe(true)
    expect(/(^|\s)700\s/.test(a.font)).toBe(false)
  })
})
