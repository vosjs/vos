import { describe, expect, it } from 'vitest'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
import { isTileSize, stageSplitCover, stageTile } from '../stages'
import { applyAndValidate } from '../docOverride'
import { posterValues } from '../posterValues'
import type { ProjectDoc } from '@vosjs/studio-core'

function doc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 35000,
        width: 1920,
        height: 1080,
        fps: 30,
      },
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
      browserBar: {
        kind: 'mac-light',
        url: 'vos.so',
        showUrl: true,
        showControls: true,
        height: 44,
      },
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
    const fill = posterValues(brand, {
      headline: 'Every video\nis a program.',
      release: '1.7',
    })
    const stage = stageSplitCover({
      size: { w: 1400, h: 560 },
      values: fill.values,
      sourceSeconds: 35,
      outputSeconds: 35,
    })
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
    const title = d.overlays!.find((o) => o.id === 'stage-title') as {
      text: string
      family?: string
      color?: string
      shadow?: number
      letterSpacing?: number
      transform: { x: number }
    }
    expect(title.text).toBe('Every video\nis a program.')
    expect(title.family).toBe('Lexend')
    expect(title.shadow).toBe(0)
    expect(title.letterSpacing).toBe(-2)
    expect(title.color).toBe('#111111')
    expect(title.transform.x).toBeLessThan(0.44)
    expect(stage.text.map((b) => b.role)).toEqual(['body', 'headline', 'body'])
    expect(stage.text[1].x + stage.text[1].w).toBeLessThanOrEqual(0.44)
  })

  it('the headline takes the brand display face, serif or sans', () => {
    expect(
      posterValues({ ...brand, fontDisplay: 'Fraunces' }, {}).values
        .fontDisplay,
    ).toMatch(/Fraunces/)
    expect(posterValues(brand, {}).values.fontDisplay).toMatch(/^Lexend/)
    expect(posterValues(brand, {}).values.fontBody).toMatch(/Lexend/)
  })

  it('a tile is a headline over a close crop of the hero, no lean, sized by its pixels', () => {
    expect(isTileSize({ w: 440, h: 280 })).toBe(true)
    expect(isTileSize({ w: 240, h: 240 })).toBe(true)
    expect(isTileSize({ w: 1280, h: 640 })).toBe(false)
    const fill = posterValues(brand, { headline: 'Every video\nis a program.' })
    const tile = stageTile({
      size: { w: 440, h: 280 },
      values: fill.values,
      sourceSeconds: 35,
      outputSeconds: 35,
    })
    expect(tile.shot.w).toBeGreaterThan(1.4)
    expect(tile.shot.x + tile.shot.w).toBeGreaterThan(1)
    const d = doc()
    applyAndValidate(d, { set: tile.set })
    expect(d.tilt).toEqual([])
    expect(d.frame.fit).toBe('cover')
    expect(d.overlays!.length).toBe(1)
    const title = d.overlays![0] as {
      size?: number
      shadow?: number
      family?: string
    }
    expect(title.size).toBe(108)
    expect(title.shadow).toBe(0)
    expect(title.family).toBe('Lexend')
    expect(tile.text[0].role).toBe('headline')
    // A destination that wants no words gets the crop alone, from the top.
    const mute = stageTile({
      size: { w: 240, h: 240 },
      values: fill.values,
      sourceSeconds: 35,
      outputSeconds: 35,
      text: 'none',
    })
    expect(mute.text).toEqual([])
    expect(mute.shot.y).toBeLessThan(0.2)
    // The crop box keeps the footage's aspect: cover crops nothing it framed.
    expect((mute.shot.w * 240) / (mute.shot.h * 240)).toBeCloseTo(16 / 9, 2)
    const tall = stageTile({
      size: { w: 440, h: 280 },
      values: fill.values,
      sourceSeconds: 35,
      outputSeconds: 35,
      text: 'none',
      footageAspect: 1.6,
    })
    expect((tall.shot.w * 440) / (tall.shot.h * 280)).toBeCloseTo(1.6, 2)
    expect(mute.set).toContain('overlays=[]')
    // No headline: the wordmark carries the tile.
    const bare = stageTile({
      size: { w: 240, h: 240 },
      values: posterValues(brand, {}).values,
      sourceSeconds: 35,
      outputSeconds: 35,
    })
    expect(
      (
        JSON.parse(
          bare.set.find((s) => s.startsWith('overlays='))!.slice(9),
        ) as { text: string }[]
      )[0].text,
    ).toBe('vosso')
  })

  it('square and portrait stack the words over the card and drop the lean', () => {
    const fill = posterValues(brand, { headline: 'Ship it' })
    const tall = stageSplitCover({
      size: { w: 1080, h: 1350 },
      values: fill.values,
      sourceSeconds: 35,
      outputSeconds: 35,
    })
    expect(tall.shot.y).toBeCloseTo(0.44, 6)
    expect(tall.set.some((s) => s.includes('"ry":0'))).toBe(true)
    const d = doc()
    applyAndValidate(d, { set: tall.set })
    expect(d.overlays!.length).toBe(3)
  })
})
