import { describe, expect, it } from 'vitest'
import { deriveSlug, parseVosId } from '../platform'
import { UsageError } from '../args'

describe('parseVosId', () => {
  it('passes bare ids through', () => {
    expect(parseVosId('abc-123_XYZ')).toBe('abc-123_XYZ')
  })

  it('extracts from watch URLs', () => {
    expect(parseVosId('https://vos.so/vos/9f3a-id')).toBe('9f3a-id')
  })

  it('extracts from embed URLs', () => {
    expect(parseVosId('https://vos.so/embed/vos/9f3a-id')).toBe('9f3a-id')
  })

  it('extracts from studio query URLs', () => {
    expect(parseVosId('https://vos.so/studio?vos=9f3a-id')).toBe('9f3a-id')
    // legacy stage links redirect with the query intact
    expect(parseVosId('https://vos.so/stage?vos=9f3a-id')).toBe('9f3a-id')
  })

  it('rejects things that are neither', () => {
    expect(() => parseVosId('https://vos.so/gallery')).toThrow(UsageError)
    expect(() => parseVosId('not a slug!')).toThrow(UsageError)
  })
})

describe('deriveSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(deriveSlug('Aurora Ribbons — dusk')).toBe('aurora-ribbons-dusk')
  })

  it('trims to the 50-char platform cap without a trailing hyphen', () => {
    const slug = deriveSlug('x'.repeat(49) + ' y')
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug.endsWith('-')).toBe(false)
  })

  it('never returns empty', () => {
    expect(deriveSlug('!!!')).toBe('remix')
  })
})
