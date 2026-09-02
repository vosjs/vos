import { describe, expect, it } from 'vitest'
import {
  composeBrand,
  extractHexes,
  isSaturated,
  mixHex,
  normalizeHex,
  parseDesignMd,
  parseLlmsTxt,
  renderBrandMd,
  rgbToHex,
} from '../brand'
import type { Witness } from '../brand'

const DESIGN_MD = `---
name: acme-brand
description: How agents build on-brand pages for Acme.
---

# Design pages like Acme

Use Geist Sans for prose, headings and controls. Use Geist Mono only for code.
The wordmark is https://cdn.acme.test/p/acme-wordmark.svg and the mark is
https://cdn.acme.test/p/acme-logo.svg. Tokens: --acme-bg, --acme-ink.

## Reject generated-design reflexes

- All-caps tracked eyebrows.
- Decorative gradients, glows, blobs.
- Nested cards.

## Accessibility

- Contrast 4.5:1.
`

function witness(over: Partial<Witness> = {}): Witness {
  return {
    title: 'Acme — the thing',
    siteName: 'Acme',
    themeColor: '#7c3aed',
    icons: [
      'https://acme.test/favicon.ico',
      'https://acme.test/apple-touch-icon.png',
    ],
    ogImage: 'https://acme.test/og.png',
    h1: {
      fontFamily: '"Bricolage Grotesque", sans-serif',
      color: 'rgb(2, 8, 23)',
    },
    body: {
      fontFamily: 'Inter, sans-serif',
      color: 'rgb(2, 8, 23)',
      backgroundColor: 'rgb(255, 255, 255)',
    },
    surfaces: [
      'rgb(249, 250, 251)',
      'rgb(249, 250, 251)',
      'rgb(255, 255, 255)',
    ],
    accents: [
      'rgb(124, 58, 237)',
      'rgb(124, 58, 237)',
      'rgb(28, 22, 56)',
      'rgb(124, 58, 237)',
      'rgba(0, 0, 0, 0)',
    ],
    ...over,
  }
}

describe('colour helpers', () => {
  it('normalizes hex and rgb', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('#7C3AED')).toBe('#7c3aed')
    expect(normalizeHex('red')).toBeNull()
    expect(rgbToHex('rgb(124, 58, 237)')).toBe('#7c3aed')
    expect(rgbToHex('rgba(0, 0, 0, 0)')).toBeNull()
  })
  it('tells a saturated accent from a neutral', () => {
    expect(isSaturated('#7c3aed')).toBe(true)
    expect(isSaturated('#f9fafb')).toBe(false)
    expect(isSaturated('#111111')).toBe(false)
  })
  it('mixes in sRGB', () => {
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080')
  })
  it('extracts hexes in order, deduped', () => {
    expect(extractHexes('a #FFF b #7c3aed c #fff')).toEqual([
      '#ffffff',
      '#7c3aed',
    ])
  })
})

describe('parseDesignMd', () => {
  it('reads the name, the fonts, the logos and the reject list', () => {
    const d = parseDesignMd(DESIGN_MD)
    expect(d.name).toBe('acme-brand')
    expect(d.fonts).toEqual(['Geist Sans', 'Geist Mono'])
    expect(d.logos).toEqual([
      'https://cdn.acme.test/p/acme-wordmark.svg',
      'https://cdn.acme.test/p/acme-logo.svg',
    ])
    expect(d.avoid).toEqual([
      'All-caps tracked eyebrows.',
      'Decorative gradients, glows, blobs.',
      'Nested cards.',
    ])
  })
})

describe('parseLlmsTxt', () => {
  it('splits the title into name and claim, and reads the blockquote', () => {
    expect(
      parseLlmsTxt('# vosso — the media of a release\n\n> One line.\n'),
    ).toEqual({
      name: 'vosso',
      claim: 'One line.',
    })
    expect(parseLlmsTxt('# Acme\n')).toEqual({ name: 'Acme', claim: null })
  })
})

describe('composeBrand', () => {
  it('the witness gives the colours, design.md the fonts and logos, llms the name', () => {
    const c = composeBrand({
      url: 'https://acme.test/',
      witness: witness(),
      design: parseDesignMd(DESIGN_MD),
      designUrl: 'https://acme.test/design.md',
      llms: { name: 'Acme', claim: 'The thing.' },
      llmsUrl: 'https://acme.test/llms.txt',
      today: '2026-09-02',
    })
    expect(c.kit.bgA).toBe('#ffffff')
    expect(c.kit.bgB).toBe('#f9fafb')
    expect(c.kit.accent).toBe('#7c3aed')
    expect(c.kit.ink).toBe('#020817')
    expect(c.kit.fontDisplay).toBe('Geist Sans')
    expect(c.kit.fontBody).toBe('Inter') // Geist Mono is the code face, never the body
    expect(c.kit.logoUrl).toBe('https://cdn.acme.test/p/acme-wordmark.svg')
    expect(c.kit.iconUrl).toBe('https://acme.test/apple-touch-icon.png')
    expect(c.kit.wordmark).toBe('Acme')
    expect(c.avoid).toHaveLength(3)
    expect(c.provenance.accent).toMatch(/buttons and links/)
  })

  it('without design.md the page faces stand in and the icon is the logo', () => {
    const c = composeBrand({
      url: 'https://acme.test/',
      witness: witness({ siteName: null }),
      design: null,
      designUrl: null,
      llms: null,
      llmsUrl: null,
      today: '2026-09-02',
    })
    expect(c.kit.fontDisplay).toBe('Bricolage Grotesque')
    expect(c.kit.fontBody).toBe('Inter')
    expect(c.kit.logoUrl).toBe('https://acme.test/apple-touch-icon.png')
    expect(c.kit.wordmark).toBe('Acme')
    expect(c.avoid).toEqual([])
  })

  it('a page with no saturated button falls back to theme-color, then ink', () => {
    const c = composeBrand({
      url: 'https://paper.test/',
      witness: witness({ accents: ['rgb(28, 26, 22)'], themeColor: '#b06a1b' }),
      design: null,
      designUrl: null,
      llms: null,
      llmsUrl: null,
      today: '2026-09-02',
    })
    expect(c.kit.accent).toBe('#b06a1b')
    expect(c.provenance.accent).toMatch(/theme-color/)
  })
})

describe('renderBrandMd', () => {
  it('writes frontmatter the poster family binds, provenance, and the avoid list', () => {
    const c = composeBrand({
      url: 'https://acme.test/',
      witness: witness(),
      design: parseDesignMd(DESIGN_MD),
      designUrl: 'https://acme.test/design.md',
      llms: { name: 'Acme', claim: 'The thing.' },
      llmsUrl: 'https://acme.test/llms.txt',
      today: '2026-09-02',
    })
    const md = renderBrandMd(c, 'The thing.')
    expect(md.startsWith('---\nname: "Acme"\n')).toBe(true)
    expect(md).toMatch(/^bgA: "#ffffff"$/m)
    expect(md).toMatch(/^accent: "#7c3aed"$/m)
    expect(md).toMatch(/^fontDisplay: "Geist Sans"$/m)
    expect(md).toMatch(/## Where each value came from/)
    expect(md).toMatch(
      /## Avoid \(the site says\)\n\n- All-caps tracked eyebrows\./,
    )
  })
})
