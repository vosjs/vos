/**
 * The callout grammar: three shapes composed from the product's register
 * by the distinguishability rules (value inversion in the product's hue,
 * the accent on the kicker, the title at CALLOUT_TYPE_RATIO times the
 * app's body as seen on screen, a real shadow and a hairline, a rise), a
 * box sized to the words, a gate-clean source; and the picture check's
 * helpers (the card's declared ground, ΔE).
 */
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_TYPE_RATIO,
  HOUSE_REGISTER,
  calloutBox,
  calloutClip,
  calloutGroundOf,
  calloutLook,
  deltaE,
  hexToRgb,
  relativeLuminance,
  rgbToHsl,
} from '../callout'
import { htmlLayerProblems } from '../htmlLayer'
import { HTML_STARTERS } from '../htmlStarters'
import { pinCandidates } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

describe('calloutLook', () => {
  it('inverts the value in the product hue: a light app gets a dark card, a dark app a light one', () => {
    const light = calloutLook({ ground: '#ffffff', accent: '#3b82f6' })
    expect(light.light).toBe(true)
    expect(relativeLuminance(hexToRgb(light.cardGround)!)).toBeLessThan(0.05)
    const dark = calloutLook({ ground: '#0b0b0d', accent: '#3b82f6' })
    expect(dark.light).toBe(false)
    expect(relativeLuminance(hexToRgb(dark.cardGround)!)).toBeGreaterThan(0.85)
    // the card's hue is the accent's, not a neutral
    const [h, s] = rgbToHsl(hexToRgb(light.cardGround)!)
    const [ha] = rgbToHsl(hexToRgb('#3b82f6')!)
    expect(Math.abs(h - ha)).toBeLessThan(0.03)
    expect(s).toBeGreaterThan(0.1)
    expect(light.accent).toBe('#3b82f6')
  })

  it('sets the title from the app body as it appears on screen, never below a floor', () => {
    const at1 = calloutLook({ ground: '#fff', accent: '#000', body: 14 }, 1.4)
    expect(at1.titlePx).toBe(Math.round(CALLOUT_TYPE_RATIO * 14 * 1.4))
    const zoomed = calloutLook(
      { ground: '#fff', accent: '#000', body: 14 },
      1.4 * 1.8,
    )
    expect(zoomed.titlePx).toBeGreaterThan(at1.titlePx)
    const tiny = calloutLook({ ground: '#fff', accent: '#000', body: 8 }, 0.5)
    expect(tiny.titlePx).toBe(20)
  })
})

describe('calloutClip', () => {
  const register = { ground: '#ffffff', accent: '#7c3aed', body: 14 }

  it('every shape passes the layer gate with nothing to say and carries the rules', () => {
    const note = calloutClip(
      'note',
      register,
      {
        kicker: 'Presets',
        title: 'Amethyst Haze, one of 43.',
        body: 'Every component re-themes at once.',
      },
      { id: 'n', start: 1, duration: 3, scale: 1.4 },
    )
    const tag = calloutClip(
      'tag',
      register,
      { kicker: 'New' },
      { id: 't', start: 1, duration: 3 },
    )
    const code = calloutClip(
      'code',
      register,
      { kicker: 'index.css', code: ':root {\n  --radius: 2rem;\n}' },
      { id: 'c', start: 1, duration: 3 },
    )
    for (const clip of [note, tag, code]) {
      expect(htmlLayerProblems(clip as never)).toEqual([])
      expect(clip.anim).toEqual({ enter: 'rise', exit: 'fade' })
      expect(clip.css).toContain('box-shadow')
      expect(clip.box.width).toBeGreaterThan(100)
      expect(clip.box.height).toBeGreaterThan(30)
    }
    expect(note.css).toContain('#7c3aed')
    expect(note.html).toContain('Amethyst Haze, one of 43.')
    expect(code.html).toContain('<pre')
    expect(tag.css).toContain('999px')
  })

  it('escapes the words and keeps code as typed', () => {
    const c = calloutClip(
      'code',
      register,
      { code: 'a < b && "c"' },
      { id: 'c', start: 0, duration: 1 },
    )
    expect(c.html).toContain('a &lt; b &amp;&amp; &quot;c&quot;')
    expect(htmlLayerProblems(c as never)).toEqual([])
  })

  it('a longer body grows the note, and a pin rides the clip', () => {
    const look = calloutLook(register, 1.4)
    const short = calloutBox('note', look, { title: 'Hue', body: 'One line.' })
    const long = calloutBox('note', look, {
      title: 'Hue turns the whole palette',
      body: 'One slider moves every token together, so the cards, the charts and the buttons all follow it at once.',
    })
    expect(long.height).toBeGreaterThan(short.height)
    const pinned = calloutClip(
      'note',
      register,
      { title: 'Hue' },
      {
        id: 'h',
        start: 1,
        duration: 2,
        pin: { step: 'hue-drag', mark: 'ring' },
      },
    )
    expect(pinned.pin).toEqual({ step: 'hue-drag', mark: 'ring' })
  })
})

describe('the starters', () => {
  it("lead with the grammar's three shapes in the house register", () => {
    expect(HTML_STARTERS.slice(0, 3).map((s) => s.id)).toEqual([
      'note',
      'tag',
      'code',
    ])
    const note = HTML_STARTERS[0]
    expect(calloutGroundOf(note.css)).toBe(
      calloutLook(HOUSE_REGISTER, 1.4).cardGround,
    )
  })
})

describe('calloutGroundOf and deltaE', () => {
  it('reads the root background as a hex, and a white card over a white app is within a few ΔE', () => {
    expect(calloutGroundOf('.c{background:#0b0b0d;color:#fff}')).toBe('#0b0b0d')
    expect(
      calloutGroundOf('.c{background-color: rgba(255, 255, 255, 0.9)}'),
    ).toBe('#ffffff')
    expect(calloutGroundOf('.c{color:#fff}')).toBeNull()
    expect(deltaE([255, 255, 255], [250, 250, 252])).toBeLessThan(3)
    expect(deltaE([255, 255, 255], [11, 11, 13])).toBeGreaterThan(90)
  })
})

describe('pinCandidates', () => {
  const COPY = { x: 1100, y: 80, w: 96, h: 36 }
  const doc: ProjectDoc = {
    source: {
      videoKey: 'blob:v',
      cursor: [
        { t: 2000, x: 1148, y: 98, type: 'down', rect: COPY },
        { t: 2100, x: 1148, y: 98, type: 'up', rect: COPY },
      ],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10000,
        width: 1280,
        height: 720,
        fps: 30,
        steps: [
          { step: 0, do: 'wait', tStart: 0, tEnd: 1.5 },
          {
            step: 1,
            id: 'copy',
            do: 'click',
            selector: 'button',
            tStart: 1.6,
            tEnd: 2.4,
            rect: COPY,
          },
          {
            step: 2,
            id: 'later',
            do: 'click',
            selector: 'a',
            tStart: 6,
            tEnd: 6.5,
            rect: COPY,
          },
        ],
      },
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 60, format: 'mp4' },
  }
  it('lists the steps with an element inside the layer window, most overlap first', () => {
    const c = pinCandidates(doc, { start: 1, duration: 3 })
    expect(c.map((x) => x.step)).toEqual(['copy'])
    expect(c[0].output.start).toBeCloseTo(1.6, 3)
    expect(
      pinCandidates(doc, { start: 5, duration: 3 }).map((x) => x.step),
    ).toEqual(['later'])
    expect(pinCandidates(doc, { start: 8, duration: 1 })).toEqual([])
  })
})
