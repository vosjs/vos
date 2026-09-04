import { describe, expect, it } from 'vitest'
import {
  aspectOf,
  fillTemplate,
  templateProblems,
  textLimitProblems,
} from '../template'
import { TEMPLATE_NAMES, templateByName } from '../templates'
import { bakeShot, encodePng } from '../shotBake'
import { decodePng } from '../picture'
import type { Rgba } from '../picture'
import type { TemplateSpec } from '../template'

describe('the bundled family honours the contract', () => {
  for (const name of TEMPLATE_NAMES) {
    it(name, () => {
      const cfg = templateByName(name)!
      expect(templateProblems(cfg)).toEqual([])
    })
  }

  it('a broken contract is said in words', () => {
    const cfg = templateByName('split-cover')!
    const t = cfg.template as TemplateSpec
    t.slots.push({ id: 'shot2', kind: 'image', required: true })
    t.text.push({ element: 'nope', param: 'ghost', role: 'body' })
    const problems = templateProblems(cfg)
    expect(problems).toContain('template.slots: no element with id "shot2"')
    expect(problems).toContain('template.text: no element with id "nope"')
    expect(problems).toContain('template.text: param "ghost" is not declared in config.params')
    expect(problems.some((p) => p.includes('layouts.landscape: slot "shot2" is not placed'))).toBe(true)
    expect(templateProblems({})).toEqual(['no template block: a poster template declares config.template'])
  })
})

describe('fillTemplate', () => {
  const values = {
    headline: 'Record it.\nCut it as data.',
    kicker: 'VOSSO 1.7',
    brand: 'vosso',
    bgA: '#ffffff',
    bgB: '#f5f5f5',
    bgC: '#ffe7e5',
    ink: '#111111',
  }

  it('places the shot per aspect in design px and writes the values into data and params', () => {
    const cfg = templateByName('split-cover')!
    const wide = fillTemplate(cfg, {
      size: { w: 1400, h: 560 },
      slots: { shot: { src: '/shot.png', aspect: 16 / 9 } },
      values,
    })
    expect(wide.aspect).toBe('landscape')
    const shot = (wide.config.elements as { id: string; src: string; size: { width: number }; position: { x: string } }[]).find((e) => e.id === 'shot')!
    expect(shot.src).toBe('/shot.png')
    // design width at 5:2 = 1080 × 2.5 = 2700; slot w 1.02 → 2754
    expect(shot.size.width).toBe(Math.round(1.02 * 2700))
    expect(shot.position.x).toBe('46.00%')
    const data = wide.config.data as Record<string, unknown>
    expect(data.headline).toBe(values.headline)
    expect(data.ink).toBe('#111111')
    const params = wide.config.params as { key: string; default: unknown }[]
    expect(params.find((p) => p.key === 'headline')!.default).toBe(values.headline)
    expect(wide.missing).toEqual([])

    const tall = fillTemplate(cfg, {
      size: { w: 1080, h: 1350 },
      slots: { shot: { src: '/shot.png', aspect: 16 / 9 } },
      values,
    })
    expect(tall.aspect).toBe('portrait')
    const title = (tall.config.elements as { id: string; position: { y: string }; font: { size: number } }[]).find((e) => e.id === 'title')!
    expect(title.position.y).toBe('26%')
    expect(title.font.size).toBe(64)
  })

  it('a baked shot grows by its pad so the card keeps the slot width', () => {
    const cfg = templateByName('card-on-gradient')!
    const r = fillTemplate(cfg, {
      size: { w: 440, h: 280 },
      slots: { shot: { src: '/shot.png', aspect: 16 / 9, pad: 0.06 } },
      values: {},
    })
    const shot = (r.config.elements as { id: string; size: { width: number }; position: { x: string } }[]).find((e) => e.id === 'shot')!
    const designW = (1080 * 440) / 280
    expect(shot.size.width).toBe(Math.round(0.82 * designW * 1.12))
    expect(Number(shot.position.x.replace('%', ''))).toBeCloseTo((0.09 - 0.82 * 0.06) * 100, 1)
  })

  it('reports the text boxes it placed, with role and colour, inside the frame', () => {
    const cfg = templateByName('split-cover')!
    const r = fillTemplate(cfg, {
      size: { w: 1200, h: 630 },
      slots: { shot: { src: '/shot.png', aspect: 16 / 9 } },
      values,
    })
    const title = r.text.find((b) => b.role === 'headline')!
    expect(title).toBeDefined()
    expect(title.color).toBe('#111111')
    expect(title.x).toBeGreaterThan(0.05)
    expect(title.x + title.w).toBeLessThan(0.7)
    expect(title.y).toBeGreaterThan(0.2)
    expect(r.text.map((b) => b.role)).toEqual(['headline', 'body', 'body'])
  })

  it('a missing required value is named, and a headline past the limits is said', () => {
    const cfg = templateByName('split-cover')!
    const r = fillTemplate(cfg, {
      size: { w: 1200, h: 630 },
      slots: { shot: { src: '/shot.png', aspect: 16 / 9 } },
      values: { brand: 'x' },
    })
    expect(r.missing).toEqual(['headline'])
    const t = cfg.template as TemplateSpec
    expect(textLimitProblems(t, { headline: 'one two three four five six seven eight nine' })).toEqual([
      'headline: 9 words, the template holds 8',
    ])
    expect(textLimitProblems(t, { headline: 'a\nb\nc\nd' })).toEqual(['headline: 4 lines, the template holds 3'])
  })

  it('aspects', () => {
    expect(aspectOf({ w: 1400, h: 560 })).toBe('landscape')
    expect(aspectOf({ w: 240, h: 240 })).toBe('square')
    expect(aspectOf({ w: 1080, h: 1350 })).toBe('portrait')
  })
})

describe('bakeShot', () => {
  function raster(w: number, h: number, fill: [number, number, number]): Rgba {
    const data = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = fill[0]
      data[i * 4 + 1] = fill[1]
      data[i * 4 + 2] = fill[2]
      data[i * 4 + 3] = 255
    }
    return { w, h, data }
  }

  it('pads, rounds, shadows and round-trips through PNG', () => {
    const shot = raster(200, 120, [250, 250, 250])
    const baked = bakeShot(shot, { margin: 0.1, radius: 0.05, shadow: 0.4, blur: 0.03, offsetY: 0.02 })
    expect(baked.w).toBe(240)
    expect(baked.h).toBe(160)
    const px = (x: number, y: number) => Array.from(baked.data.subarray((y * baked.w + x) * 4, (y * baked.w + x) * 4 + 4))
    // The margin corner is transparent; the shot's corner is rounded away.
    expect(px(0, 0)[3]).toBe(0)
    expect(px(20, 20)[3]).toBeLessThan(255)
    // The shot's centre is opaque and its colour.
    expect(px(120, 80)).toEqual([250, 250, 250, 255])
    // Under the shot's bottom edge the shadow reads as translucent black.
    const under = px(120, 20 + 120 + 4)
    expect(under[3]).toBeGreaterThan(10)
    expect(under[0]).toBe(0)
    const again = decodePng(encodePng(baked))
    expect(again).not.toBeNull()
    expect(Array.from(again!.data)).toEqual(Array.from(baked.data))
  })

  it('a hairline darkens the shot edge', () => {
    const shot = raster(100, 60, [255, 255, 255])
    const baked = bakeShot(shot, { margin: 0.1, radius: 0, shadow: 0, hairline: 0.2 })
    const o = ((10 + 30) * baked.w + 10) * 4
    expect(baked.data[o]).toBeLessThan(255)
    const oi = ((10 + 30) * baked.w + 50) * 4
    expect(baked.data[oi]).toBe(255)
  })
})
