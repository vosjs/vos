import { describe, expect, it } from 'vitest'
import { CHANNEL_ALIASES, lookOverrides, resolveChannels } from '../deliver'
import { houseLook } from '@vosjs/studio-core'

describe('resolveChannels', () => {
  it('accepts spec channel slugs verbatim', () => {
    expect(resolveChannels('x,github')).toEqual(['x', 'github'])
  })

  it('resolves the shorthands', () => {
    expect(resolveChannels('yt,gh,shorts')).toEqual([
      'youtube',
      'github',
      'shorts-linkedin',
    ])
  })

  it('dedupes an alias against its slug', () => {
    expect(resolveChannels('gh,github')).toEqual(['github'])
  })

  it('expands all to every video channel', () => {
    expect(resolveChannels('all')).toEqual([
      'youtube',
      'x',
      'shorts-linkedin',
      'github',
    ])
  })

  it('refuses an unknown channel with the list in words', () => {
    expect(() => resolveChannels('x,tiktok')).toThrow(/unknown channel/)
    expect(() => resolveChannels('x,tiktok')).toThrow(/youtube, x/)
  })

  it('refuses a channel that has no video destination', () => {
    for (const c of ['cws', 'producthunt', 'og', 'linkedin', 'ph'])
      expect(() => resolveChannels(c)).toThrow(
        new RegExp(`unknown channel "${c}".*video cuts`),
      )
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

describe('lookOverrides', () => {
  it('presents the card on the look and keeps the camera', () => {
    const set = lookOverrides(
      houseLook('gradient'),
      'hero',
      { w: 1920, h: 1080 },
      { w: 1280, h: 800 },
    )
    expect(set).toContain('frame.fit=contain')
    expect(set.some((s) => s.startsWith('frame.inset='))).toBe(true)
    expect(set).toContain('frame.backgroundMedia=null')
    expect(set.some((s) => s.startsWith('zoom='))).toBe(false)
  })

  it('keeps a backdrop the run asked for', () => {
    const set = lookOverrides(
      houseLook('plate'),
      'hero',
      { w: 1920, h: 1080 },
      { w: 1280, h: 800 },
      { keepMedia: true },
    )
    expect(set).not.toContain('frame.backgroundMedia=null')
  })
})
