import { describe, expect, it } from 'vitest'
import { CHANNEL_ALIASES, resolveChannels } from '../deliver'

describe('resolveChannels', () => {
  it('accepts spec channel slugs verbatim', () => {
    expect(resolveChannels('cws,producthunt')).toEqual(['cws', 'producthunt'])
  })

  it('resolves the shorthands', () => {
    expect(resolveChannels('ph,yt,gh,li,shorts')).toEqual([
      'producthunt',
      'youtube',
      'github',
      'linkedin',
      'shorts-linkedin',
    ])
  })

  it('dedupes an alias against its slug', () => {
    expect(resolveChannels('ph,producthunt')).toEqual(['producthunt'])
  })

  it('expands all to every channel', () => {
    const all = resolveChannels('all')
    for (const c of ['cws', 'producthunt', 'x', 'linkedin', 'og', 'github'])
      expect(all).toContain(c)
  })

  it('refuses an unknown channel with the list in words', () => {
    expect(() => resolveChannels('cws,tiktok')).toThrow(/unknown channel/)
    expect(() => resolveChannels('cws,tiktok')).toThrow(/cws/)
  })

  it('refuses an empty list', () => {
    expect(() => resolveChannels(' ,')).toThrow(/channel list/)
  })

  it('every alias points at a real channel', () => {
    const known = resolveChannels('all')
    for (const target of Object.values(CHANNEL_ALIASES))
      expect(known).toContain(target)
  })
})
