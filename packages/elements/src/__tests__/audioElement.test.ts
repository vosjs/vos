import { describe, expect, it } from 'vitest'
import { extractAssetUrls } from '../assetCache'
import { clampGain } from '../renderers/audio'

describe('extractAssetUrls', () => {
  it('collects audio srcs alongside the visual asset types', () => {
    const assets = extractAssetUrls([
      { type: 'image', src: 'a.png' },
      { type: 'audio', src: 'music.mp3' },
      { type: 'audio', src: 'music.mp3' }, // deduped
      { type: 'audio', src: 'sfx.wav' },
      { type: 'video', src: 'v.mp4' },
      { type: 'text', content: 'hi' },
    ])
    expect(assets.audios).toEqual(['music.mp3', 'sfx.wav'])
    expect(assets.images).toEqual(['a.png'])
    expect(assets.videos).toEqual(['v.mp4'])
  })

  it('ignores audio elements without a src', () => {
    expect(extractAssetUrls([{ type: 'audio' }]).audios).toEqual([])
  })
})

describe('clampGain', () => {
  it('clamps into the HTMLMediaElement volume range', () => {
    expect(clampGain(0.5)).toBe(0.5)
    expect(clampGain(2)).toBe(1)
    expect(clampGain(-1)).toBe(0)
  })

  it('defaults non-numeric input to full volume', () => {
    expect(clampGain(undefined)).toBe(1)
    expect(clampGain(NaN)).toBe(1)
    expect(clampGain('loud')).toBe(1)
  })
})
