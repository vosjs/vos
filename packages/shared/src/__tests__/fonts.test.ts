import { describe, expect, it } from 'vitest'
import {
  FONT_CATALOG,
  findFontFamily,
  fontFaceUrl,
  fontManifest,
  fontStack,
  nearestFontWeight,
} from '../fonts'

describe('font catalog integrity', () => {
  it('has unique families and slugs', () => {
    const families = FONT_CATALOG.map((f) => f.family.toLowerCase())
    const slugs = FONT_CATALOG.map((f) => f.slug)
    expect(new Set(families).size).toBe(FONT_CATALOG.length)
    expect(new Set(slugs).size).toBe(FONT_CATALOG.length)
  })

  it('anchors the faces the product already uses', () => {
    for (const family of ['Lexend', 'JetBrains Mono', 'Inter']) {
      expect(findFontFamily(family)).toBeDefined()
    }
    // The overlay presets need these exact weights hosted.
    expect(findFontFamily('Lexend')!.weights).toContain(400)
    expect(findFontFamily('Lexend')!.weights).toContain(600)
    expect(findFontFamily('JetBrains Mono')!.weights).toContain(400)
  })

  it('every entry is well-formed', () => {
    for (const f of FONT_CATALOG) {
      expect(f.slug).toMatch(/^[a-z0-9-]+$/)
      expect(f.weights.length).toBeGreaterThan(0)
      expect([...f.weights]).toEqual([...f.weights].sort((a, b) => a - b))
      for (const w of f.weights) {
        expect(w).toBeGreaterThanOrEqual(100)
        expect(w).toBeLessThanOrEqual(900)
        expect(w % 100).toBe(0)
      }
    }
  })

  it('covers every category', () => {
    const categories = new Set(FONT_CATALOG.map((f) => f.category))
    expect([...categories].sort()).toEqual([
      'display',
      'handwriting',
      'mono',
      'sans',
      'serif',
    ])
  })
})

describe('helpers', () => {
  it('builds face URLs on the public CDN', () => {
    expect(fontFaceUrl('lexend', 600)).toBe(
      'https://assets.vos.so/fonts/lexend/600.woff2',
    )
  })

  it('finds families case-insensitively', () => {
    expect(findFontFamily('lexend')?.family).toBe('Lexend')
    expect(findFontFamily('Nope Sans')).toBeUndefined()
  })

  it('snaps to the nearest hosted weight', () => {
    const lexend = findFontFamily('Lexend')!
    expect(nearestFontWeight(lexend, 550)).toBe(600)
    expect(nearestFontWeight(lexend, 100)).toBe(400)
  })

  it('quotes multi-word families in stacks', () => {
    expect(fontStack(findFontFamily('Space Grotesk')!)).toMatch(
      /^'Space Grotesk', /,
    )
    expect(fontStack(findFontFamily('Inter')!)).toMatch(/^Inter, /)
  })

  it('manifest mirrors the catalog with per-weight files', () => {
    const m = fontManifest()
    expect(m.families.length).toBe(FONT_CATALOG.length)
    const lexend = m.families.find((f) => f.slug === 'lexend')!
    expect(lexend.files['600']).toBe(
      'https://assets.vos.so/fonts/lexend/600.woff2',
    )
  })
})
