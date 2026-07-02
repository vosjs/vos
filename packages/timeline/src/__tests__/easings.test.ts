import { describe, expect, it } from 'vitest'
import gsap from 'gsap'
import { EASINGS, resolveEase } from '../easings'

// Curve parity with GSAP is the contract: one ease vocabulary spans freeform
// GSAP function-strings and declarative keyframe tracks. Every registered name
// must match gsap.parseEase across the domain.
const SAMPLES = Array.from({ length: 21 }, (_, i) => i / 20)

describe('EASINGS ↔ gsap.parseEase parity', () => {
  for (const name of Object.keys(EASINGS)) {
    it(`matches gsap for '${name}'`, () => {
      const ours = EASINGS[name as keyof typeof EASINGS]
      const theirs = gsap.parseEase(name)
      expect(theirs).toBeTruthy()
      for (const x of SAMPLES) {
        expect(ours(x)).toBeCloseTo(theirs(x), 6)
      }
    })
  }

  it('covers endpoints exactly for every ease', () => {
    for (const [name, fn] of Object.entries(EASINGS)) {
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 9)
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 9)
    }
  })
})

describe('resolveEase', () => {
  it('resolves known names and falls back to linear for unknown ones', () => {
    expect(resolveEase('power2.inOut')).toBe(EASINGS['power2.inOut'])
    expect(resolveEase('not-an-ease')(0.3)).toBe(0.3)
    expect(resolveEase(undefined)(0.7)).toBe(0.7)
  })
})
