import { describe, expect, it } from 'vitest'
import {
  HOUSE_GRADIENT,
  PLATE_GROUND,
  applyLook,
  cardInset,
  houseLook,
  lookFromBrand,
  lookKindForGround,
} from '../look'
import { computeCardLayout } from '../layout'
import { DEFAULT_BROWSER_BAR, DEFAULT_FRAME_STYLE } from '../types'

/**
 * A look is the card's presentation resolved to frame fields. The numbers
 * pinned here are the reference band the feature clips and poster cards
 * were measured to: the card at 74 to 89% of the width, headroom above,
 * a bottom bleed on wide frames, a shadow always, a hairline when the card
 * and the ground are both light.
 */

const LANDSCAPE = { w: 1600, h: 900 }

describe('cardInset', () => {
  it('hero on a 16:9 frame: 84% wide, 16% headroom, bled off the bottom', () => {
    const i = cardInset(
      houseLook('gradient'),
      { w: 1920, h: 1080 },
      LANDSCAPE,
      'hero',
    )
    expect(i.left).toBeCloseTo(0.08, 6)
    expect(i.right).toBeCloseTo(0.08, 6)
    expect(i.top).toBeCloseTo(0.16, 6)
    // The 16:9 card at 84% width is 84% tall; with 16% above it the bottom
    // edge lands on the frame edge, and the look bleeds it 2% past.
    expect(i.bottom).toBeCloseTo(-0.02, 6)
  })

  it('hero on a 5:2 marquee: the card runs a third off the bottom', () => {
    const i = cardInset(
      houseLook('plate'),
      { w: 1400, h: 560 },
      LANDSCAPE,
      'hero',
    )
    // card height = 0.84 × 2.5 / 1.778 = 1.18 of the frame
    expect(i.bottom!).toBeLessThan(-0.3)
    expect(i.top).toBeCloseTo(0.16, 6)
  })

  it('card on an 11:7 tile: centred with even room around it', () => {
    const i = cardInset(
      houseLook('gradient'),
      { w: 440, h: 280 },
      LANDSCAPE,
      'card',
    )
    expect(i.left).toBeCloseTo(0.08, 6)
    expect(i.top).toBeCloseTo(i.bottom!, 6)
    expect(i.top!).toBeGreaterThan(0.1)
    expect(i.top!).toBeLessThan(0.15)
  })

  it('card on a frame too wide for the card falls back to hero', () => {
    const i = cardInset(
      houseLook('gradient'),
      { w: 1400, h: 560 },
      LANDSCAPE,
      'card',
    )
    expect(i.top).toBeCloseTo(0.16, 6)
    expect(i.bottom!).toBeLessThan(0)
  })
})

describe('the card placement under a look measures inside the reference band', () => {
  for (const [w, h] of [
    [1920, 1080],
    [1400, 560],
    [1280, 640],
    [1200, 630],
    [440, 280],
  ]) {
    it(`${w}x${h}`, () => {
      const frame = applyLook(
        DEFAULT_FRAME_STYLE,
        houseLook('plate'),
        { w, h },
        LANDSCAPE,
        'card',
      )
      const l = computeCardLayout(
        { ...frame, browserBar: DEFAULT_BROWSER_BAR },
        { width: LANDSCAPE.w, height: LANDSCAPE.h },
        w,
        h,
      )
      const widthPct = l.cardW / w
      expect(widthPct).toBeGreaterThanOrEqual(0.74)
      expect(widthPct).toBeLessThanOrEqual(0.89)
      // Side padding is symmetric.
      expect(l.cardX).toBeCloseTo(w - (l.cardX + l.cardW), 3)
      // Headroom sits in the band, or the card is centred with room above.
      expect(l.cardY / h).toBeGreaterThanOrEqual(0.08)
      expect(l.cardY / h).toBeLessThanOrEqual(0.28)
      expect(frame.shadow).toBeGreaterThan(0)
    })
  }
})

describe('house looks and the brand', () => {
  it('the plate is the measured Chrome ground with a hairline', () => {
    const p = houseLook('plate')
    expect(p.ground).toBe(PLATE_GROUND)
    expect(p.border).toBeGreaterThan(0)
    expect(p.borderColor).toBe('#000000')
  })

  it('a site picks its look from its own ground', () => {
    expect(lookKindForGround('#ffffff')).toBe('plate')
    expect(lookKindForGround('#f7f7f5')).toBe('plate')
    expect(lookKindForGround('#0b0b0f')).toBe('dark')
    expect(lookKindForGround('#3a5fcd')).toBe('gradient')
    expect(lookKindForGround(undefined)).toBe('gradient')
  })

  it('the look role wins, then the kit colours the house look', () => {
    const plate = lookFromBrand({
      look: 'plate',
      bgA: '#000000',
      bgB: '#eef0f3',
    })
    expect(plate.kind).toBe('plate')
    expect(plate.ground).toBe('#eef0f3')
    const grad = lookFromBrand({
      bgA: '#3a5fcd',
      accent: '#ff5148',
      bgC: '#ffe0dc',
    })
    expect(grad.kind).toBe('gradient')
    expect(grad.ground).toBe('linear-gradient(135deg, #ff5148, #ffe0dc)')
    const dark = lookFromBrand({ bgA: '#0a0a0c', accent: '#ff5148' })
    expect(dark.kind).toBe('dark')
    expect(dark.ground).toMatch(
      /^radial-gradient\(ellipse at 82% 0%, #[0-9a-f]{6}, #0a0a0c\)$/,
    )
    const own = lookFromBrand({ look: 'gradient', ground: '#123456' })
    expect(own.ground).toBe('#123456')
    expect(lookFromBrand(null).ground).toBe(HOUSE_GRADIENT)
  })

  it('applyLook keeps the bar and the media, drops focus, forces contain', () => {
    const frame = applyLook(
      {
        ...DEFAULT_FRAME_STYLE,
        fit: 'cover',
        focus: { cx: 0.2, cy: 0.1 },
        browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'mac-light' },
        backgroundMedia: { kind: 'image', key: '/bg.png', dim: 0 },
      },
      houseLook('dark'),
      { w: 1920, h: 1080 },
      LANDSCAPE,
      'hero',
    )
    expect(frame.fit).toBe('contain')
    expect(frame.focus).toBeUndefined()
    expect(frame.browserBar.kind).toBe('mac-light')
    expect(frame.backgroundMedia?.key).toBe('/bg.png')
    expect(frame.borderWidth).toBe(1)
    expect(frame.borderColor).toBe('#ffffff')
  })
})
