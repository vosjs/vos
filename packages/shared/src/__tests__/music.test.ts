import { describe, expect, it } from 'vitest'
import {
  BED_WEIGHTS,
  askWords,
  nearestBeat,
  pickBeds,
  placeBed,
  rankBeds,
  stableHash,
  trackBySlug,
} from '../music'
import type { BedTrack, FilmSummary } from '../music'

const grid = (bpm: number, first = 0.25) => ({
  first,
  period: 60 / bpm,
  error: 0.005,
})

const track = (over: Partial<BedTrack> & { slug: string }): BedTrack => ({
  title: over.slug,
  mood: 'upbeat',
  duration: 120,
  url: `https://assets.vos.so/music/${over.slug}.mp3`,
  swells: [{ from: 10, at: 20, peakAt: 22, riseDb: 8 }],
  bpm: 120,
  beat: grid(120),
  beatConfidence: 'high',
  intro: 0.3,
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

const film = (over: Partial<FilmSummary> = {}): FilmSummary => ({
  duration: 24,
  cuts: [2, 4, 6, 8],
  voice: false,
  seed: 'vos-1',
  ...over,
})

describe('placement', () => {
  it('lands the strongest swell on the payoff, snapped to a beat', () => {
    const t = track({
      slug: 'a',
      swells: [
        { from: 5, at: 30.1, peakAt: 32, riseDb: 6 },
        { from: 40, at: 60.2, peakAt: 61, riseDb: 9 },
      ],
    })
    const placed = placeBed(t, film({ payoff: 12 }))
    expect('placement' in placed).toBe(true)
    if ('placement' in placed) {
      // The 9 dB swell at 60.2 lands on 12: in = 48.2, then the swell's
      // instant snaps to the grid (60.25) so in = 48.25.
      expect(placed.placement.in).toBeCloseTo(48.25, 2)
      expect(placed.placement.swellAt).toBe(12)
      expect(placed.placement.riseDb).toBe(9)
      expect(placed.placement.loop).toBe(false)
    }
  })

  it('starts past the quiet intro on a beat when there is no payoff', () => {
    const t = track({ slug: 'a', intro: 6.1, beat: grid(120, 0) })
    const placed = placeBed(t, film())
    if ('placement' in placed) expect(placed.placement.in).toBe(6)
    else throw new Error(placed.refused)
  })

  it('refuses a track that ends before the film and does not loop', () => {
    const placed = placeBed(track({ slug: 'a', duration: 20 }), film())
    expect('refused' in placed && placed.refused).toMatch(
      /ends at 0:20, 4 s before the film; does not loop/,
    )
  })

  it('loops a whole number of bars when the track loops', () => {
    const placed = placeBed(
      track({ slug: 'a', duration: 20, loops: true, beat: grid(120, 0) }),
      film({ duration: 60 }),
    )
    if (!('placement' in placed)) throw new Error(placed.refused)
    expect(placed.placement.loop).toBe(true)
    expect(placed.placement.loopLen).toBe(60)
    // The intro's 0.3 s snaps to the beat at 0.5; from there, whole bars
    // of 2 s inside the 20 s track: nine, so the span ends at 18.5.
    expect(placed.placement.in).toBe(0.5)
    expect(placed.placement.out).toBe(18.5)
    expect((placed.placement.out - placed.placement.in) % 2).toBe(0)
  })
})

describe('the ranking', () => {
  it('refuses a sung lead under a voice and says so', () => {
    const r = rankBeds(
      [track({ slug: 'sung', vocals: 'lead' }), track({ slug: 'inst' })],
      film({ voice: true }),
    )
    expect(r.map((x) => x.slug)).toEqual(['inst', 'sung'])
    expect(r[1].refused).toBe('has a sung lead; your film has a voice')
    expect(r[1].score).toBeNull()
  })

  it('refuses a placement that starts inside a quiet intro', () => {
    const r = rankBeds(
      [
        track({
          slug: 'quiet',
          intro: 8,
          swells: [],
          beat: null,
          beatConfidence: null,
        }),
      ],
      film({ payoff: 12 }),
    )
    expect(r[0].refused).toBeNull()
    // Past the intro it is fine; a film that opens on its first frame
    // under the quiet part is not.
    const r2 = rankBeds(
      [
        track({
          slug: 'quiet',
          intro: 8,
          swells: [{ from: 0, at: 4, peakAt: 5, riseDb: 6 }],
        }),
      ],
      film({ payoff: 2 }),
    )
    expect(r2[0].refused).toMatch(/starts \d+ s into a quiet intro/)
  })

  it('prefers cuts on the beat, and does not score an uncertain beat', () => {
    const onBeat = track({ slug: 'on', beat: grid(120, 0) }) // cuts at 2,4,6,8 land on 0.5 s beats
    const off = track({ slug: 'off', beat: grid(97, 0.13) })
    const low = track({ slug: 'low', beatConfidence: 'low' })
    const r = rankBeds([off, onBeat, low], film())
    const by = Object.fromEntries(r.map((x) => [x.slug, x]))
    expect(by.on.scores!.beat).toBe(1)
    expect(by.off.scores!.beat).toBeLessThan(0.8)
    expect(by.low.scores!.beat).toBe(0.5)
    expect(by.low.reasons).toContain('tempo uncertain, beat not scored')
    expect(by.on.reasons).toContain('4 of 4 cuts within a tenth of a beat')
    expect(r[0].slug).toBe('on')
  })

  it('reads the ask as a genre, a tag, or words in the description', () => {
    const chill = track({ slug: 'chill', mood: 'chill' })
    const tagged = track({ slug: 'tagged', tags: ['calm', 'piano'] })
    const described = track({
      slug: 'described',
      description: 'A soft piano figure over brushed drums.',
    })
    const plain = track({ slug: 'plain' })
    const byMood = Object.fromEntries(
      rankBeds([chill, plain], film({ mood: 'chill' })).map((x) => [x.slug, x]),
    )
    expect(byMood.chill.scores!.fit).toBe(1)
    expect(byMood.plain.scores!.fit).toBe(0)
    const byTag = rankBeds([tagged, plain], film({ mood: 'calm' }))
    expect(byTag[0].slug).toBe('tagged')
    const byWords = Object.fromEntries(
      rankBeds([described, tagged, plain], film({ words: 'soft piano' })).map(
        (x) => [x.slug, x],
      ),
    )
    expect(byWords.described.scores!.fit).toBe(1)
    expect(byWords.tagged.scores!.fit).toBe(0.5)
    expect(byWords.plain.scores!.fit).toBe(0)
  })

  it('wants a calm bed under a voice, and charges chops', () => {
    const busy = track({ slug: 'busy', busyness: 0.9 })
    const calm = track({ slug: 'calm', busyness: 0.1 })
    const chops = track({ slug: 'chops', busyness: 0.1, vocals: 'chops' })
    const r = rankBeds([busy, calm, chops], film({ voice: true }))
    expect(r[0].slug).toBe('calm')
    const by = Object.fromEntries(r.map((x) => [x.slug, x]))
    expect(by.chops.scores!.bed).toBeCloseTo(0.6, 5)
    expect(by.calm.reasons).toContain('calm under your voice')
    expect(by.busy.reasons).toContain('busy under a voice')
  })

  it('keeps every track scored against the published weights', () => {
    const r = rankBeds([track({ slug: 'a' })], film())
    const s = r[0].scores!
    const sum =
      BED_WEIGHTS.payoff * s.payoff +
      BED_WEIGHTS.beat * s.beat +
      BED_WEIGHTS.fit * s.fit +
      BED_WEIGHTS.bed * s.bed +
      BED_WEIGHTS.shape * s.shape
    expect(r[0].score).toBeCloseTo(sum, 3)
    expect(Object.values(BED_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(
      1,
      9,
    )
  })

  it('breaks a tie by the seed: stable per film, different across films', () => {
    const catalog = ['a', 'b', 'c', 'd'].map((slug) => track({ slug }))
    const one = rankBeds(catalog, film({ seed: 'vos-1' })).map((x) => x.slug)
    const again = rankBeds(catalog, film({ seed: 'vos-1' })).map((x) => x.slug)
    expect(again).toEqual(one)
    const seeds = ['vos-2', 'vos-3', 'vos-4', 'vos-5', 'vos-6']
    const firsts = new Set(
      seeds.map((seed) => rankBeds(catalog, film({ seed }))[0].slug),
    )
    expect(firsts.size).toBeGreaterThan(1)
  })

  it('nudges a bed the project already uses', () => {
    const catalog = [track({ slug: 'a' }), track({ slug: 'b' })]
    const r = rankBeds(catalog, film({ like: ['b'] }))
    expect(r[0].slug).toBe('b')
    expect(r[0].reasons).toContain('the project already uses it')
  })

  it('leaves a removed track out and keeps a long film to loops or long tracks', () => {
    const catalog = [
      track({ slug: 'gone', removedAt: '2026-01-01' }),
      track({ slug: 'short', duration: 30 }),
      track({ slug: 'loop', duration: 30, loops: true }),
      track({ slug: 'long', duration: 200 }),
    ]
    const r = rankBeds(catalog, film({ duration: 150 }))
    expect(r.map((x) => x.slug)).not.toContain('gone')
    expect(
      r
        .filter((x) => x.score !== null)
        .map((x) => x.slug)
        .sort(),
    ).toEqual(['long', 'loop'])
    expect(pickBeds(catalog, film({ duration: 150 }), 1)).toHaveLength(1)
  })

  it('ranks a track measured before the facts existed, without its beat', () => {
    const r = rankBeds(
      [
        track({
          slug: 'old',
          bpm: null,
          beat: null,
          beatConfidence: null,
          intro: null,
          seam: null,
          ending: null,
          sections: null,
          busyness: null,
        }),
      ],
      film({ payoff: 12 }),
    )
    expect(r[0].score).not.toBeNull()
    expect(r[0].reasons).toContain('beat not measured, not scored')
  })
})

describe('helpers', () => {
  it('finds the nearest beat on a grid or a list', () => {
    expect(nearestBeat(1.6, { first: 0.5, period: 0.5 })).toBeCloseTo(1.5)
    expect(nearestBeat(1.6, { first: 0.5, period: 0.5 }, [0.4, 1.7])).toBe(1.7)
  })
  it('hashes stably and reads words plainly', () => {
    expect(stableHash('a')).toBe(stableHash('a'))
    expect(stableHash('a')).not.toBe(stableHash('b'))
    expect(askWords('Soft piano, warm!')).toEqual(['soft', 'piano', 'warm'])
    expect(askWords(undefined)).toEqual([])
  })
  it('keeps a slug a slug', () => {
    const c = [track({ slug: 'fresh-focus' })]
    expect(trackBySlug(c, 'Fresh-Focus')?.slug).toBe('fresh-focus')
    expect(trackBySlug(c, 'upbeat')).toBeNull()
  })
})
