import { describe, expect, it } from 'vitest'
import { EASINGS } from '../easings'
import { lerpArray, sample, sortKeyframes } from '../sample'
import type { KeyframeTrack } from '../types'

const track: KeyframeTrack = {
  keyframes: [
    { t: 1, value: 0 },
    { t: 2, value: 10, ease: 'power2.inOut' },
    { t: 4, value: 10 },
    { t: 5, value: 0, ease: 'none' },
  ],
}

describe('sample', () => {
  it('clamps before the first and after the last keyframe', () => {
    expect(sample(track, -3)).toBe(0)
    expect(sample(track, 0.999)).toBe(0)
    expect(sample(track, 5)).toBe(0)
    expect(sample(track, 99)).toBe(0)
  })

  it('is exact at keyframe times', () => {
    expect(sample(track, 1)).toBe(0)
    expect(sample(track, 2)).toBe(10)
    expect(sample(track, 4)).toBe(10)
  })

  it('eases INTO a keyframe with that keyframe’s ease', () => {
    // segment [1,2] approaches k(t=2), eased by its 'power2.inOut'
    const u = EASINGS['power2.inOut'](0.25)
    expect(sample(track, 1.25)).toBeCloseTo(10 * u, 9)
  })

  it('holds through equal-value spans and interpolates linearly by default', () => {
    expect(sample(track, 3)).toBe(10) // between two value-10 keyframes
    expect(sample(track, 4.5)).toBeCloseTo(5, 9) // 'none' → linear down-ramp
  })

  it('supports step interpolation (hold previous value)', () => {
    const step: KeyframeTrack = { ...track, interpolate: 'step' }
    expect(sample(step, 1.99)).toBe(0)
    expect(sample(step, 2)).toBe(10)
    expect(sample(step, 4.999)).toBe(10)
  })

  it('handles coincident keyframes without dividing by zero', () => {
    const dup: KeyframeTrack = {
      keyframes: [
        { t: 0, value: 1 },
        { t: 1, value: 2 },
        { t: 1, value: 5 },
        { t: 2, value: 5 },
      ],
    }
    expect(sample(dup, 1.5)).toBe(5)
    expect(Number.isFinite(sample(dup, 1))).toBe(true)
  })

  it('interpolates arbitrary values via a custom lerp', () => {
    const vec: KeyframeTrack<readonly number[]> = {
      keyframes: [
        { t: 0, value: [1, 0.5, 0.5] },
        { t: 1, value: [2, 0.25, 0.75], ease: 'none' },
      ],
    }
    expect(sample(vec, 0.5, lerpArray)).toEqual([1.5, 0.375, 0.625])
  })

  it('throws on an empty track (authoring bug, not a runtime state)', () => {
    expect(() => sample({ keyframes: [] }, 0)).toThrow()
  })
})

describe('sortKeyframes', () => {
  it('sorts by t, stable for ties', () => {
    const a = { t: 1, value: 1 }
    const b = { t: 1, value: 2 }
    const c = { t: 0, value: 3 }
    expect(sortKeyframes([a, b, c])).toEqual([c, a, b])
  })
})
