import { describe, expect, it } from 'vitest'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
import { stageSplitCover } from '../stages'
import { applyAndValidate } from '../docOverride'
import { posterValues } from '../posterValues'
import type { ProjectDoc } from '@vosjs/studio-core'

function doc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [],
      meta: { dpr: 1, zoom: 1, t0: 0, durationMs: 35000, width: 1920, height: 1080, fps: 30 },
    },
    segments: [{ in: 0, out: 35 }],
    zoom: [{ id: 'z', in: 1, out: 4, level: 1.8, cx: 0.5, cy: 0.5 }],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'native',
      browserBar: { kind: 'mac-light', url: 'vos.so', showUrl: true, showControls: true, height: 44 },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const brand = {
  bgA: '#ffffff',
  bgB: '#f5f5f5',
  bgC: '#ffe7e5',
  ink: '#111111',
  accent: '#ff5148',
  fontDisplay: 'Lexend Variable',
  fontBody: 'Lexend Variable',
  wordmark: 'vosso',
}

describe('the split cover as a stage', () => {
  it('places the card at right in perspective, bled off two edges, and the words at left', () => {
    const fill = posterValues(brand, { headline: 'Every video\nis a program.', release: '1.7' })
    const stage = stageSplitCover({ size: { w: 1400, h: 560 }, values: fill.values, sourceSeconds: 35, outputSeconds: 35 })
    expect(stage.shot.x).toBeCloseTo(0.44, 6)
    expect(stage.shot.x + stage.shot.w).toBeGreaterThan(1)
    expect(stage.shot.y + stage.shot.h).toBeGreaterThan(1)
    const d = doc()
    applyAndValidate(d, { set: stage.set })
    expect(d.frame.fit).toBe('cover')
    expect(d.frame.focus).toEqual({ cx: 0, cy: 0 })
    expect(d.tilt![0].ry).toBe(10)
    expect(d.zoom).toEqual([])
    expect(d.frame.browserBar.kind).toBe('mac-light')
    const title = d.overlays!.find((o) => o.id === 'stage-title') as { text: string; family?: string; color?: string; transform: { x: number } }
    expect(title.text).toBe('Every video\nis a program.')
    expect(title.family).toBe('Fraunces')
    expect(title.color).toBe('#111111')
    expect(title.transform.x).toBeLessThan(0.44)
    expect(stage.text.map((b) => b.role)).toEqual(['body', 'headline', 'body'])
    expect(stage.text[1].x + stage.text[1].w).toBeLessThanOrEqual(0.44)
  })

  it('a brand with a serif display face keeps it; a sans falls to the house serif', () => {
    expect(posterValues({ ...brand, fontDisplay: 'Fraunces' }, {}).values.fontDisplay).toMatch(/Fraunces/)
    expect(posterValues(brand, {}).values.fontDisplay).toMatch(/Fraunces/)
    expect(posterValues(brand, {}).values.fontBody).toMatch(/Lexend/)
  })

  it('square and portrait stack the words over the card and drop the lean', () => {
    const fill = posterValues(brand, { headline: 'Ship it' })
    const tall = stageSplitCover({ size: { w: 1080, h: 1350 }, values: fill.values, sourceSeconds: 35, outputSeconds: 35 })
    expect(tall.shot.y).toBeCloseTo(0.44, 6)
    expect(tall.set.some((s) => s.includes('"ry":0'))).toBe(true)
    const d = doc()
    applyAndValidate(d, { set: tall.set })
    expect(d.overlays!.length).toBe(3)
  })
})
