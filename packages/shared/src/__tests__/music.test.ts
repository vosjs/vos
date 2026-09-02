import { describe, expect, it } from 'vitest'
import {
  MUSIC_CATALOG,
  MUSIC_MOODS,
  SFX_CATALOG,
  findMusicTrack,
  musicManifest,
  musicTrackUrl,
  sfxUrl,
} from '../music'

describe('music catalog integrity', () => {
  it('has tracks and unique slugs', () => {
    expect(MUSIC_CATALOG.length).toBeGreaterThan(0)
    const slugs = MUSIC_CATALOG.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(MUSIC_CATALOG.length)
  })

  it('every entry is well-formed', () => {
    for (const t of MUSIC_CATALOG) {
      expect(t.slug).toMatch(/^[a-z0-9-]+$/)
      expect(t.title.length).toBeGreaterThan(0)
      expect(t.artist.length).toBeGreaterThan(0)
      // Beds, not stingers or hour-long ambience: sane length band.
      expect(t.duration).toBeGreaterThan(30)
      expect(t.duration).toBeLessThan(600)
      // Redistribution-safe only — the whole point of the catalog.
      expect(t.license).toBe('CC0')
    }
  })

  it('every mood is in the product vocabulary, every chip has a track', () => {
    const vocabulary = MUSIC_MOODS.map((m) => m.mood)
    for (const t of MUSIC_CATALOG) {
      expect(vocabulary).toContain(t.mood)
    }
    for (const mood of vocabulary) {
      expect(MUSIC_CATALOG.some((t) => t.mood === mood)).toBe(true)
    }
  })

  it('sfx entries are well-formed', () => {
    const slugs = SFX_CATALOG.map((s) => s.slug)
    expect(new Set(slugs).size).toBe(SFX_CATALOG.length)
    for (const s of SFX_CATALOG) {
      expect(s.slug).toMatch(/^[a-z0-9-]+$/)
      expect(s.duration).toBeGreaterThan(0)
      expect(s.duration).toBeLessThan(5)
    }
  })
})

describe('helpers', () => {
  it('builds URLs on the public CDN', () => {
    expect(musicTrackUrl('fresh-focus')).toBe(
      'https://assets.vos.so/music/fresh-focus.mp3',
    )
    expect(sfxUrl('sfx-click')).toBe(
      'https://assets.vos.so/audio-sfx/sfx-click.wav',
    )
  })

  it('finds tracks by slug and by hosted URL', () => {
    const first = MUSIC_CATALOG[0]
    expect(findMusicTrack(first.slug)?.title).toBe(first.title)
    expect(findMusicTrack(musicTrackUrl(first.slug))?.title).toBe(first.title)
    expect(findMusicTrack('nope-nothing')).toBeUndefined()
    expect(findMusicTrack('blob:http://x/y')).toBeUndefined()
  })

  it('manifest mirrors the catalog with URLs, music and sfx', () => {
    const m = musicManifest()
    expect(m.tracks.length).toBe(MUSIC_CATALOG.length)
    expect(m.sfx.length).toBe(SFX_CATALOG.length)
    for (const t of m.tracks) {
      expect(t.url).toBe(musicTrackUrl(t.slug))
    }
  })
})
