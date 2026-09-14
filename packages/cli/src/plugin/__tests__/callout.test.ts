import { describe, expect, it } from 'vitest'
import {
  CALLOUT_DEFAULT_SECONDS,
  CALLOUT_LEAD_SECONDS,
  appScaleAt,
  composeCallout,
  groundFindings,
  registerFrom,
  windowForStep,
} from '../callout'
import type { ProjectDoc } from '@vosjs/studio-core'
import type { Rgba } from '../picture'

/**
 * `vos callout`: the register from BRAND.md or the flags, the window from
 * the step it is about (a beat after the press, cut short by the next
 * navigation), the type scale from the camera, the clip pinned to the step;
 * and the ground check's ΔE verdicts over fake footage.
 */
const COPY = { x: 1100, y: 80, w: 96, h: 36 }
const doc: ProjectDoc = {
  source: {
    videoKey: 'blob:v',
    cursor: [
      { t: 2000, x: 1148, y: 98, type: 'down', button: 0, rect: COPY },
      { t: 2100, x: 1148, y: 98, type: 'up', button: 0, rect: COPY },
    ],
    meta: {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 12000,
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
          id: 'hover',
          do: 'hover',
          selector: 'a',
          tStart: 3,
          tEnd: 3.8,
          rect: COPY,
        },
        { step: 3, do: 'scroll', tStart: 4, tEnd: 4.4 },
        {
          step: 4,
          id: 'gone',
          do: 'click',
          selector: 'x',
          tStart: 7,
          tEnd: 7.4,
          skipped: true,
        },
      ],
    },
  },
  segments: [{ in: 0, out: 12 }],
  zoom: [
    {
      id: 'z1',
      in: 1.8,
      out: 4,
      level: 1.8,
      cx: 0.86,
      cy: 0.11,
      source: 'manual',
    },
  ],
  audio: [],
  cursor: { smoothing: 0.5, size: 1 } as ProjectDoc['cursor'],
  cam: {} as ProjectDoc['cam'],
  frame: {
    background: '#fff',
    padding: 48,
    radius: 12,
    shadow: 0.4,
    border: 0,
    aspectRatio: 'auto',
    browserBar: { kind: 'none' },
    camera: 'stage',
  } as ProjectDoc['frame'],
  export: { resolution: '1080p', fps: 60, format: 'mp4' },
}

describe('registerFrom', () => {
  it('reads the ground and the accent from BRAND.md roles, flags win, a system face is not carried', () => {
    const r = registerFrom(
      { bgA: '#ffffff', accent: '#3b82f6', fontBody: 'ui-sans-serif' },
      {},
    )
    expect(r).toEqual({ ground: '#ffffff', accent: '#3b82f6', body: 14 })
    const over = registerFrom(
      { bgA: '#ffffff', accent: '#3b82f6', fontBody: 'Inter' },
      { accent: '#7c3aed', body: 16 },
    )
    expect(over).toMatchObject({ accent: '#7c3aed', face: 'Inter', body: 16 })
    expect(registerFrom(null, {})).toBeNull()
    expect(registerFrom({ bgA: 'white', accent: '#000' }, {})).toBeNull()
  })
})

describe('windowForStep', () => {
  it('opens a beat after a click lands and runs the default, cut short by the next scroll', () => {
    const w = windowForStep(doc, 'copy')!
    expect(w.start).toBeCloseTo(1.6 + CALLOUT_LEAD_SECONDS, 3)
    // the scroll at 4.0 cuts the default 3 s short
    expect(w.start + w.duration).toBeCloseTo(4 - 0.05, 2)
    expect(w.duration).toBeLessThan(CALLOUT_DEFAULT_SECONDS)
    // a hover opens after its gesture ends
    expect(windowForStep(doc, 'hover')!.start).toBeCloseTo(
      3.8 + CALLOUT_LEAD_SECONDS,
      3,
    )
    expect(windowForStep(doc, 'nope')).toBeNull()
    expect(windowForStep(doc, 'gone')).toBeNull()
    expect(windowForStep(doc, 1)!.start).toBeCloseTo(1.8, 3)
  })
})

describe('appScaleAt', () => {
  it('is the footage scale times the level under the camera', () => {
    const rest = appScaleAt(doc, 0.5)
    const apex = appScaleAt(doc, 3)
    expect(rest).toBeGreaterThan(1)
    expect(apex / rest).toBeCloseTo(1.8, 1)
  })
})

describe('composeCallout', () => {
  const register = { ground: '#ffffff', accent: '#3b82f6', body: 14 }
  it('writes a note pinned to its step, in the window, in the product hue, sized to the camera', () => {
    const { clip, window } = composeCallout(doc, register, {
      shape: 'note',
      words: { kicker: 'Copy', title: 'Every token, as CSS variables.' },
      step: 'copy',
      mark: 'ring',
      leader: true,
    })
    expect(clip.kind).toBe('html')
    expect(clip.start).toBeCloseTo(window.start, 6)
    expect(clip.pin).toEqual({ step: 'copy', mark: 'ring', leader: true })
    expect(clip.transform).toEqual({ x: 0.5, y: 0.82, scale: 1, rotation: 0 })
    expect(clip.css).toContain('#3b82f6')
    expect(clip.id).toBe('note-copy')
    // at the apex the app is 1.8× larger, so is the title
    const rest = composeCallout(doc, register, {
      shape: 'note',
      words: { title: 'T' },
      at: 0.2,
      seconds: 1,
    })
    const apex = composeCallout(doc, register, {
      shape: 'note',
      words: { title: 'T' },
      at: 2.6,
      seconds: 1,
    })
    const px = (css: string) => Number(/\.t\{font-size:(\d+)px/.exec(css)![1])
    expect(px(apex.clip.css ?? '') / px(rest.clip.css ?? '')).toBeGreaterThan(1.5)
  })

  it('an unknown step, or neither a step nor a time, is refused in words; ids never collide', () => {
    expect(() =>
      composeCallout(doc, register, {
        shape: 'tag',
        words: { kicker: 'x' },
        step: 'nope',
      }),
    ).toThrow(/not in the take/)
    expect(() =>
      composeCallout(doc, register, { shape: 'tag', words: { kicker: 'x' } }),
    ).toThrow(/--step/)
    const withOne = {
      ...doc,
      overlays: [
        composeCallout(doc, register, {
          shape: 'tag',
          words: { kicker: 'x' },
          step: 'copy',
        }).clip,
      ],
    }
    const second = composeCallout(withOne, register, {
      shape: 'tag',
      words: { kicker: 'y' },
      step: 'copy',
    })
    expect(second.clip.id).toBe('tag-copy-2')
  })
})

describe('groundFindings', () => {
  const solid = (r: number, g: number, b: number): Rgba => {
    const w = 192
    const h = 108
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = r
      data[i * 4 + 1] = g
      data[i * 4 + 2] = b
      data[i * 4 + 3] = 255
    }
    return { w, h, data }
  }
  const layer = (css: string) => ({
    id: 'h0',
    kind: 'html' as const,
    start: 1,
    duration: 3,
    html: '<div class="c">x</div>',
    css,
    box: { width: 420, height: 120 },
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  })

  it('a white card over white footage is a problem; a dark one reads as lifted; no background is a note', async () => {
    const white = await groundFindings(
      { ...doc, overlays: [layer('.c{background:#ffffff}')] },
      async () => solid(250, 250, 252),
    )
    expect(white[0].level).toBe('problem')
    expect(white[0].deltaE).toBeLessThan(8)
    expect(white[0].message).toContain('one more panel')
    const dark = await groundFindings(
      { ...doc, overlays: [layer('.c{background:#0b0b0d}')] },
      async () => solid(250, 250, 252),
    )
    expect(dark[0].level).toBe('note')
    expect(dark[0].deltaE).toBeGreaterThan(80)
    const none = await groundFindings(
      { ...doc, overlays: [layer('.c{color:#fff}')] },
      async () => solid(0, 0, 0),
    )
    expect(none[0].level).toBe('note')
    expect(none[0].deltaE).toBeNull()
  })
})
