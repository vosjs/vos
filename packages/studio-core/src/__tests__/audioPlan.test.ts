import { describe, expect, it } from 'vitest'
import { envelopeAt, studioAudioPlan } from '../lower/audioPlan'
import type { LoweredAudioClip } from '../lower/audioPlan'

// The studio's clips as the engine's audio plan: what every export
// path hands mixAudio, from the same lowered data the preview plays.

const clip = (over: Partial<LoweredAudioClip> = {}): LoweredAudioClip => ({
  key: 'bed.mp3',
  start: 2,
  in: 1,
  out: 4,
  gain: 0.8,
  loop: false,
  len: 3,
  duck: false,
  env: [
    { t: 2, g: 0 },
    { t: 3, g: 0.8 },
    { t: 4, g: 0.8 },
    { t: 5, g: 0 },
  ],
  ...over,
})

describe('studioAudioPlan', () => {
  it('a clip plays from its start, reading the source from `in`, at its envelope', () => {
    const plan = studioAudioPlan([clip()], [], 8)
    expect(plan.tracks).toHaveLength(1)
    const at = (t: number) => plan.tracks[0].points[Math.round(t / plan.step)]
    expect(at(1).on).toBe(false)
    expect(at(1).gain).toBe(0)
    expect(at(2).on).toBe(true)
    expect(at(2).pos).toBeCloseTo(1, 6)
    expect(at(3.5).pos).toBeCloseTo(2.5, 6)
    expect(at(3.5).gain).toBeCloseTo(0.8, 6)
    expect(at(2.5).gain).toBeCloseTo(0.4, 6) // mid fade-in
    expect(at(5).on).toBe(false) // start + len
  })

  it('a looped clip wraps over [in, out] and fills its placed length', () => {
    const plan = studioAudioPlan(
      [clip({ loop: true, len: 7, env: [] })],
      [],
      10,
    )
    const at = (t: number) => plan.tracks[0].points[Math.round(t / plan.step)]
    expect(at(2).pos).toBeCloseTo(1, 6)
    expect(at(4.9).pos).toBeCloseTo(3.9, 6)
    expect(at(5.5).pos).toBeCloseTo(1.5, 6) // wrapped: 3.5 s in → 0.5 s past a 3 s span
    expect(at(8.9).on).toBe(true)
    expect(at(9).on).toBe(false)
    expect(at(6).gain).toBeCloseTo(0.8, 6) // the clip gain when there is no envelope
    // The plan never asks the mixer to loop the whole source.
    expect(plan.tracks[0].loop).toBe(false)
  })

  it('a ducking clip multiplies the duck curve in', () => {
    const duck = [
      { t: 0, g: 1 },
      { t: 3, g: 1 },
      { t: 3.5, g: 0.25 },
      { t: 6, g: 0.25 },
    ]
    const ducked = studioAudioPlan([clip({ duck: true })], duck, 8)
    const plain = studioAudioPlan([clip({ duck: false })], duck, 8)
    const at = (p: typeof ducked, t: number) =>
      p.tracks[0].points[Math.round(t / p.step)]
    expect(at(plain, 4).gain).toBeCloseTo(0.8, 6)
    expect(at(ducked, 4).gain).toBeCloseTo(0.2, 6)
  })

  it('drops what cannot play and keeps track ids stable by index', () => {
    const plan = studioAudioPlan(
      [
        clip({ start: 9 }),
        clip({ out: 1 }),
        clip({ key: 'sfx.wav', start: 0, in: 0, out: 1, len: 1 }),
      ],
      [],
      8,
    )
    expect(plan.tracks.map((t) => [t.id, t.src])).toEqual([
      ['clip2', 'sfx.wav'],
    ])
  })

  it('envelopeAt is linear between points and flat outside', () => {
    const env = [
      { t: 1, g: 0 },
      { t: 2, g: 1 },
    ]
    expect(envelopeAt(env, 0, 0.5)).toBe(0)
    expect(envelopeAt(env, 1.25, 0.5)).toBeCloseTo(0.25, 6)
    expect(envelopeAt(env, 3, 0.5)).toBe(1)
    expect(envelopeAt([], 3, 0.5)).toBe(0.5)
  })
})
