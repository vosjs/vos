import { describe, expect, it } from 'vitest'
import {
  bpmRange,
  filterTracks,
  pickWords,
  scoreLine,
  trackLine,
} from '../musicCmd'
import { pickBed, pickTrack } from '../motionPlan'
import type { BedTrack, FilmSummary } from '@vosjs/shared/music'
import type { MusicCatalog } from '../motionPlan'

const track = (over: Partial<BedTrack> & { slug: string }): BedTrack => ({
  title: over.slug,
  mood: 'upbeat',
  duration: 120,
  url: `https://assets.vos.so/music/${over.slug}.mp3`,
  swells: [{ from: 10, at: 20, peakAt: 22, riseDb: 8 }],
  bpm: 120,
  beat: { first: 0, period: 0.5, error: 0.004 },
  beatConfidence: 'high',
  intro: 0,
  seam: 0.9,
  ending: 'fade',
  sections: [{ at: 0, level: 0.8 }],
  busyness: 0.4,
  vocals: 'none',
  tags: [],
  description: null,
  loops: false,
  ...over,
})

const catalog: MusicCatalog = {
  tracks: [
    track({ slug: 'bright-day', mood: 'upbeat', bpm: 140, tags: ['bright'] }),
    track({
      slug: 'slow-tide',
      mood: 'chill',
      bpm: 90,
      vocals: 'none',
      loops: true,
      description: 'A soft piano figure.',
    }),
    track({
      slug: 'sung-thing',
      mood: 'chill',
      bpm: 100,
      beat: { first: 0.13, period: 0.6, error: 0.004 },
      vocals: 'lead',
    }),
    track({
      slug: 'short-loop',
      mood: 'groove',
      duration: 30,
      loops: true,
      bpm: 110,
    }),
  ],
  sfx: [],
}

const film: FilmSummary = {
  duration: 24,
  cuts: [2, 4, 6],
  voice: false,
  seed: 'take-1',
}

describe('vos music ls', () => {
  it('filters by mood or tag, vocals, loops, tempo, length and words', () => {
    const slugs = (f: Parameters<typeof filterTracks>[1]) =>
      filterTracks(catalog.tracks, f).map((t) => t.slug)
    expect(slugs({ mood: 'chill' })).toEqual(['slow-tide', 'sung-thing'])
    expect(slugs({ mood: 'bright' })).toEqual(['bright-day'])
    expect(slugs({ vocals: 'lead' })).toEqual(['sung-thing'])
    expect(slugs({ loops: true })).toEqual(['slow-tide', 'short-loop'])
    expect(slugs({ bpm: [100, 120] })).toEqual(['sung-thing', 'short-loop'])
    // A loop is long enough for anything.
    expect(slugs({ minLength: 60 })).toEqual([
      'bright-day',
      'slow-tide',
      'sung-thing',
      'short-loop',
    ])
    expect(slugs({ q: 'soft piano' })).toEqual(['slow-tide'])
  })

  it('reads a tempo range, or a floor', () => {
    expect(bpmRange('90-120')).toEqual([90, 120])
    expect(bpmRange('100')).toEqual([100, Infinity])
    expect(bpmRange(undefined)).toBeNull()
    expect(() => bpmRange('fast')).toThrow(/--bpm expects/)
  })

  it('prints a line an agent can read without listening', () => {
    const line = trackLine(
      track({
        slug: 'slow-tide',
        mood: 'chill',
        bpm: 90.5,
        beatConfidence: 'low',
        loops: true,
        description: 'A soft piano figure.',
      }),
    )
    expect(line).toMatch(
      /^slow-tide\s+chill\s+2:00\s+90\.5 bpm\?\s+no vocals\s+loops\s+"A soft piano figure\."$/,
    )
  })
})

describe('vos music pick', () => {
  it('ranks for the film, names the runner-up and the score line', () => {
    const picked = pickBed(catalog, 'chill', film)!
    expect(picked.via).toBe('ranked')
    expect(picked.track.slug).toBe('slow-tide')
    expect(picked.ranked?.placement).toBeTruthy()
    expect(picked.runnerUp?.slug).toBeDefined()
    expect(scoreLine('film', picked.ranked!, { ...film, payoff: 12 })).toBe(
      'vos score film --track slow-tide --at 12',
    )
  })

  it('keeps a slug a slug, and a mood without a film the first of its kind', () => {
    expect(pickBed(catalog, 'bright-day', film)?.via).toBe('slug')
    expect(pickTrack(catalog, 'chill')?.slug).toBe('slow-tide')
    expect(pickBed(catalog, 'chill')?.via).toBe('first')
    expect(pickBed(catalog, 'none', film)).toBeNull()
    expect(pickBed(null, 'chill', film)).toBeNull()
  })

  it('answers nothing for a word the library has no name for', () => {
    expect(pickBed(catalog, 'polka', film)).toBeNull()
    // Several words are matched against the tracks' words.
    expect(pickBed(catalog, 'soft piano', film)?.track.slug).toBe('slow-tide')
    expect(pickBed(catalog, 'tuba march', film)).toBeNull()
  })

  it('refuses a sung lead under a voice and says why when nothing fits', () => {
    const voiced = pickBed(catalog, 'chill', { ...film, voice: true })!
    expect(voiced.track.slug).toBe('slow-tide')
    const words = pickWords(
      [],
      [
        {
          slug: 'x',
          track: track({ slug: 'x' }),
          score: null,
          refused: 'ends at 0:30, 10 s before the film; does not loop',
          placement: null,
          scores: null,
          reasons: [],
        },
      ],
      { ...film, duration: 40 },
      'film',
    )
    expect(words).toMatch(/No bed in the library fits/)
    expect(words).toMatch(/vos-score/)
  })
})
