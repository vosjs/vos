import { describe, expect, it } from 'vitest'
import gsap from 'gsap'
import { EASINGS, resolveEase, springSettleTime } from '../easings'

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
    for (const fam of [
      'power1',
      'power2',
      'sine',
      'expo',
      'back',
      'elastic',
      'bounce',
    ]) {
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

describe('css-bezier (dialect-only: the CSS cubic-bezier timing function)', () => {
  it('css-bezier(0, 0, 1, 1) is linear', () => {
    const ease = resolveEase('css-bezier(0, 0, 1, 1)')
    for (const x of SAMPLES) {
      expect(ease(x), `linear-bezier(${x})`).toBeCloseTo(x, 5)
    }
  })

  it('matches the CSS "ease" preset curve at reference points', () => {
    // cubic-bezier(0.25, 0.1, 0.25, 1): reference values computed independently
    // from the parametric curve definition (dense bisection, no solver).
    const ease = resolveEase('css-bezier(0.25, 0.1, 0.25, 1)')
    expect(ease(0.25)).toBeCloseTo(0.408511, 4)
    expect(ease(0.5)).toBeCloseTo(0.802403, 4)
    expect(ease(0.75)).toBeCloseTo(0.960459, 4)
  })

  it('is monotonic, hits the endpoints exactly, and clamps outside [0,1]', () => {
    const ease = resolveEase('css-bezier(0.16, 1, 0.3, 1)') // the Screen-Studio zoom curve
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(-0.5)).toBe(0)
    expect(ease(1.5)).toBe(1)
    let prev = 0
    for (const x of SAMPLES) {
      const y = ease(x)
      expect(y, `monotonic at ${x}`).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = y
    }
    // strong ease-out: the midpoint is already close to the target
    expect(ease(0.5)).toBeGreaterThan(0.85)
  })

  it('supports overshoot via out-of-range y control points', () => {
    const ease = resolveEase('css-bezier(0.34, 1.56, 0.64, 1)') // "easeOutBack"-ish
    const peak = Math.max(...SAMPLES.map((x) => ease(x)))
    expect(peak).toBeGreaterThan(1.01)
    expect(ease(1)).toBe(1)
  })

  it('is cached, and malformed forms fall back to linear', () => {
    expect(resolveEase('css-bezier(0.16, 1, 0.3, 1)')).toBe(
      resolveEase('css-bezier(0.16, 1, 0.3, 1)'),
    )
    expect(resolveEase('css-bezier(0.16, 1, 0.3)')(0.3)).toBe(0.3) // arity
    expect(resolveEase('css-bezier(a, b, c, d)')(0.3)).toBe(0.3)
  })
})

describe('spring (dialect-only: a damped spring stretched over the tween)', () => {
  // Remotion's spring, measured by running it (remotion 4.0.529) at 30 fps.
  const REMOTION_DEFAULT = [
    0, 0.04941510804510185, 0.17381586354057232, 0.3402998466082984,
    0.5213516324407459, 0.6958917272121958, 0.8494256348541122,
    0.9735341838620929, 1.0649395616400006, 1.1243547674084116,
    1.1552855913778497, 1.1629107356164519, 1.153122768414049,
  ]
  const REMOTION_SMOOTH = [
    0, 0.0446, 0.1443, 0.2642, 0.3849, 0.4963, 0.594, 0.6768, 0.7452, 0.8009,
  ]

  it("a tween as long as the spring's settle time moves as Remotion's spring", () => {
    const t = springSettleTime()
    const ease = resolveEase('spring')
    REMOTION_DEFAULT.forEach((v, f) =>
      expect(ease(f / 30 / t)).toBeCloseTo(v, 9),
    )
    const ts = springSettleTime(200)
    const smooth = resolveEase('spring(200)')
    REMOTION_SMOOTH.forEach((v, f) =>
      expect(smooth(f / 30 / ts)).toBeCloseTo(v, 4),
    )
  })

  it('lands exactly on 1 and starts at 0, overshooting between when underdamped', () => {
    const ease = resolveEase('spring(12, 180, 1)')
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    let peak = 0
    for (let x = 0; x < 1; x += 0.01) peak = Math.max(peak, ease(x))
    expect(peak).toBeGreaterThan(1.1)
    const crit = resolveEase('spring(200)')
    for (let x = 0; x <= 1; x += 0.01) expect(crit(x)).toBeLessThanOrEqual(1)
  })

  it('reads its defaults (10, 100, 1) in every spelling, and reflects in/inOut', () => {
    const bare = resolveEase('spring')
    for (const x of [0.1, 0.3, 0.7]) {
      expect(resolveEase('spring.out')(x)).toBe(bare(x))
      expect(resolveEase('spring(10, 100, 1)')(x)).toBe(bare(x))
      expect(resolveEase('spring(10)')(x)).toBe(bare(x))
      expect(resolveEase('spring.in')(x)).toBeCloseTo(1 - bare(1 - x), 12)
    }
    expect(resolveEase('spring.inOut')(0.5)).toBeCloseTo(0.5, 12)
  })

  it('is never mistaken for linear', () => {
    expect(resolveEase('spring')(0.2)).not.toBeCloseTo(0.2, 2)
    expect(resolveEase('spring(30, 300, 2)')(0.2)).not.toBeCloseTo(0.2, 2)
  })
})
