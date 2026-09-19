import { describe, expect, it } from 'vitest'
import { catalogFamily } from '../fontName'
import { registerFrom } from '../callout'

describe('the catalog name for a face', () => {
  it('drops the Variable suffix when the catalog hosts the base family', () => {
    expect(catalogFamily('Inter Variable')).toBe('Inter')
    expect(catalogFamily('Lexend Variable')).toBe('Lexend')
    expect(catalogFamily('  lexend variable ')).toBe('Lexend')
  })

  it('leaves a hosted name and an unhosted family alone', () => {
    expect(catalogFamily('Inter')).toBe('Inter')
    expect(catalogFamily('Acme Grotesk Variable')).toBe('Acme Grotesk Variable')
    expect(catalogFamily('Acme Grotesk')).toBe('Acme Grotesk')
  })

  // The trap: a kit witnessed from a live site carries the site's CSS name,
  // and a callout written with it fell back to a system stack on the fleet.
  it('reaches the composed callout, from the kit and from --font', () => {
    const kit = { bgA: '#ffffff', accent: '#3b82f6', fontBody: 'Inter Variable' }
    expect(registerFrom(kit, {})?.face).toBe('Inter')
    expect(registerFrom(kit, { face: 'Lexend Variable' })?.face).toBe('Lexend')
  })
})
