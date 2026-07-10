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

  it('bare family names default to .out, matching gsap.parseEase', () => {
    for (const fam of ['power1', 'power2', 'sine', 'expo', 'back', 'elastic', 'bounce']) {
      const ours = resolveEase(fam)
      const theirs = gsap.parseEase(fam)
      for (const x of SAMPLES) {
        expect(ours(x), `${fam}(${x})`).toBeCloseTo(theirs(x), 6)
      }
    }
  })
})

describe('parameterized eases ↔ gsap.parseEase parity', () => {
  const CASES = [
    'back.out(1.7)',
    'back.in(3)',
    'back.inOut(2)',
    'elastic.out(1, 0.3)',
    'elastic.out(1.2, 0.5)',
    'elastic.in(1, 0.4)',
    'elastic.in(1.5, 0.4)',
    'elastic.inOut(1, 0.3)',
    'elastic.inOut(1.3, 0.6)',
    'elastic.inOut(2, 0.4)',
    'steps(5)',
    'steps(12)',
  ]
  for (const name of CASES) {
    it(`matches gsap for '${name}'`, () => {
      const ours = resolveEase(name)
      const theirs = gsap.parseEase(name)
      expect(theirs).toBeTruthy()
      for (const x of SAMPLES) {
        expect(ours(x), `${name}(${x})`).toBeCloseTo(theirs(x), 6)
      }
    })
  }

  it('caches parsed eases (same fn for same string)', () => {
    expect(resolveEase('back.out(1.7)')).toBe(resolveEase('back.out(1.7)'))
  })

  it('malformed parameterized names fall back to linear', () => {
    expect(resolveEase('back.out(abc)')(0.3)).toBe(0.3)
    expect(resolveEase('steps()')(0.3)).toBe(0.3)
  })
})
