/**
 * Differential parity harness: the same dialect script drives BOTH a real,
 * paused GSAP timeline and the vos sampler backend; every animated property is
 * compared numerically at a monotonic sweep of sample times (the export seek
 * pattern). This is the correctness contract for `@vosjs/tween`'s sampler —
 * black-box behavioral equivalence, not source-derived.
 */
import { describe, expect, it } from 'vitest'
import gsap from 'gsap'
import { createTweenRecorder } from '../index'

type Targets = Record<string, Record<string, number>>

interface Case {
  name: string
  /** Fresh targets per backend (plain numeric objects). */
  targets: () => Targets
  /** Author the same timeline against either backend. */
  build: (tl: TimelineLike, o: Targets) => void
  /** Extra interesting sample times (boundaries etc.). */
  extraTimes?: number[]
  /** Cap for the sweep when the timeline is infinite. */
  sweepEnd?: number
  /** Comparison tolerance override. */
  tolerance?: number
  /**
   * Declared one-tick transient windows (defined divergences): comparisons are
   * skipped for samples inside (from, to]. GSAP's value in these windows is
   * grid-dependent (depends on where the sweep's ticks land), so there is no
   * stable value to compare against.
   */
  skip?: Array<{ from: number; to: number }>
}

interface TimelineLike {
  to(target: unknown, vars: object, position?: number | string): unknown
  from(target: unknown, vars: object, position?: number | string): unknown
  fromTo(target: unknown, from: object, to: object, position?: number | string): unknown
  set(target: unknown, vars: object, position?: number | string): unknown
  addLabel(label: string, position?: number | string): unknown
  seek(t: number, suppress?: boolean): unknown
  duration(): number
}

const CASES: Case[] = [
  {
    name: 'fromTo + ease',
    targets: () => ({ a: { opacity: 0.5, scale: 2 } }),
    build: (tl, o) => {
      tl.fromTo(
        o.a,
        { opacity: 0, scale: 0.8 },
        { opacity: 1, scale: 1, duration: 1.5, ease: 'power2.out' },
        0.5,
      )
    },
  },
  {
    name: 'set anchor + chained implicit .to',
    targets: () => ({ a: { x: 42 } }),
    build: (tl, o) => {
      tl.set(o.a, { x: 0 }, 0)
      tl.to(o.a, { x: 100, duration: 1, ease: 'none' }, 0)
      tl.to(o.a, { x: 200, duration: 1, ease: 'sine.inOut' }, 1)
    },
  },
  {
    name: 'leading .to (implicit from = current value)',
    targets: () => ({ a: { y: 10 } }),
    build: (tl, o) => {
      tl.to(o.a, { y: 110, duration: 2, ease: 'power1.inOut' }, 1)
    },
  },
  {
    name: '.from render-on-add semantics',
    targets: () => ({ a: { y: 5 } }),
    build: (tl, o) => {
      tl.from(o.a, { y: 50, duration: 1, ease: 'none' }, 1)
    },
  },
  {
    name: 'delay + position params + label',
    targets: () => ({ a: { x: 0, y: 0, z: 0, w: 0 } }),
    build: (tl, o) => {
      tl.to(o.a, { x: 1, duration: 2, ease: 'none' })
      tl.to(o.a, { y: 1, duration: 1, ease: 'none', delay: 0.25 }, '<')
      tl.addLabel('mark', 1.5)
      tl.to(o.a, { z: 1, duration: 1, ease: 'none' }, 'mark')
      tl.to(o.a, { w: 1, duration: 0.5, ease: 'none' }, '+=0.5')
    },
  },
  {
    name: 'repeat + yoyo + repeatDelay',
    targets: () => ({ a: { x: 0 }, b: { y: 0 } }),
    build: (tl, o) => {
      tl.to(o.a, { x: 10, duration: 1, ease: 'none', repeat: 2, yoyo: true }, 0)
      tl.to(o.b, { y: 4, duration: 0.5, ease: 'power1.in', repeat: 3, repeatDelay: 0.25 }, 0)
    },
    extraTimes: [0.999, 1.001, 1.5, 2.999, 3.0],
  },
  {
    name: 'infinite repeat (values over a finite window)',
    targets: () => ({ a: { r: 0 } }),
    build: (tl, o) => {
      tl.to(o.a, { r: 1, duration: 0.8, ease: 'none', repeat: -1, yoyo: true }, 0)
    },
    sweepEnd: 5,
  },
  {
    name: 'stagger: numeric each on array target',
    targets: () => ({
      a: { y: 0 },
      b: { y: 0 },
      c: { y: 0 },
      d: { y: 0 },
    }),
    build: (tl, o) => {
      tl.to([o.a, o.b, o.c, o.d], { y: 1, duration: 0.5, ease: 'none', stagger: 0.2 }, 0)
    },
  },
  {
    name: "stagger: {each, from:'center'} and {amount, from:'end'}",
    targets: () => ({
      a: { y: 0, z: 0 },
      b: { y: 0, z: 0 },
      c: { y: 0, z: 0 },
      d: { y: 0, z: 0 },
      e: { y: 0, z: 0 },
    }),
    build: (tl, o) => {
      const arr = [o.a, o.b, o.c, o.d, o.e]
      tl.to(arr, { y: 1, duration: 0.4, ease: 'none', stagger: { each: 0.3, from: 'center' } }, 0)
      tl.to(arr, { z: 2, duration: 0.4, ease: 'none', stagger: { amount: 1, from: 'end' } }, 3)
    },
  },
  {
    name: "stagger: {each, from:'edges'}",
    targets: () => ({
      a: { y: 0 },
      b: { y: 0 },
      c: { y: 0 },
      d: { y: 0 },
      e: { y: 0 },
    }),
    build: (tl, o) => {
      tl.to([o.a, o.b, o.c, o.d, o.e], { y: 1, duration: 0.4, ease: 'none', stagger: { each: 0.25, from: 'edges' } }, 0)
    },
  },
  {
    name: 'parameterized + extended eases in tweens',
    targets: () => ({ a: { p: 0, q: 0, r: 0, s: 0, t: 0 } }),
    build: (tl, o) => {
      tl.to(o.a, { p: 1, duration: 1, ease: 'back.out(1.7)' }, 0)
      tl.to(o.a, { q: 1, duration: 1, ease: 'elastic.out(1, 0.3)' }, 0)
      tl.to(o.a, { r: 1, duration: 1, ease: 'bounce.out' }, 0)
      tl.to(o.a, { s: 1, duration: 1, ease: 'steps(5)' }, 0)
      tl.to(o.a, { t: 1, duration: 1, ease: 'power2' }, 0) // bare family
    },
  },
  {
    name: 'overlapping tweens on one property',
    targets: () => ({ a: { x: 0 } }),
    build: (tl, o) => {
      tl.set(o.a, { x: 0 }, 0)
      tl.to(o.a, { x: 100, duration: 4, ease: 'none' }, 0) // long
      tl.to(o.a, { x: -50, duration: 1, ease: 'none' }, 1) // short, inside
    },
    // Two DEFINED one-tick transients around the nested tween's boundaries
    // (both grid-dependent in GSAP, analytic in the sampler):
    // 1. Lazy capture: GSAP reads the short tween's implicit start value at its
    //    first render TICK; the sampler captures at the tween's exact start.
    //    Error bounded by grid-step × the overwritten tween's slope.
    // 2. End crossing: on the single tick that first crosses the short tween's
    //    end, GSAP's clamped final render (insertion order) wins; the long
    //    tween resumes on the very next tick (probed: monotonic 2.001 → -50,
    //    then 2.1 → 52.5 matching the sampler). Whichever sample lands first
    //    after 2.0 shows it — hence the skip window.
    extraTimes: [0.999, 1.001, 1.999, 3.5, 4.001],
    tolerance: 0.05,
    skip: [{ from: 2.0, to: 2.11 }],
  },
  {
    name: 'default duration and default ease',
    targets: () => ({ a: { x: 0 } }),
    build: (tl, o) => {
      tl.set(o.a, { x: 0 }, 0)
      tl.to(o.a, { x: 1 }, 0) // duration 0.5, ease power1.out defaults
    },
  },
]

// The sweep starts at ε rather than exactly 0: zero-duration tweens at t=0 are
// a DEFINED divergence (the sampler applies them for all t >= start,
// direction-independent; GSAP only renders them once the playhead moves).
// See the dedicated zero-duration test below.
function sampleTimes(duration: number, extra: number[] = []): number[] {
  const ts = new Set<number>([1e-6, ...extra])
  const end = duration * 1.05
  for (let i = 1; i <= 40; i++) ts.add((end * i) / 40)
  return [...ts].sort((a, b) => a - b)
}

// GSAP attaches a `_gsap` cache object to its targets — compare numbers only.
function flatten(o: Targets): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, obj] of Object.entries(o)) {
    for (const [p, v] of Object.entries(obj)) {
      if (typeof v === 'number') out[`${k}.${p}`] = v
    }
  }
  return out
}

describe('differential parity: gsap backend vs vos sampler', () => {
  for (const c of CASES) {
    it(c.name, () => {
      // Real GSAP side (paused root timeline + monotonic seek = export pattern).
      const og = c.targets()
      const gtl = gsap.timeline({ paused: true })
      c.build(gtl as unknown as TimelineLike, og)

      // vos sampler side.
      const ov = c.targets()
      const rec = createTweenRecorder()
      const vtl = rec.timeline({ paused: true })
      c.build(vtl as unknown as TimelineLike, ov)

      const dur = c.sweepEnd ?? vtl.recordedDuration
      expect(dur).toBeGreaterThan(0)
      if (!c.sweepEnd) {
        // Duration itself must agree with GSAP.
        expect(vtl.recordedDuration).toBeCloseTo(gtl.duration(), 6)
      }

      const tol = c.tolerance ?? 1e-4
      for (const t of sampleTimes(dur, c.extraTimes)) {
        gtl.seek(t, false)
        vtl.seek(t, false)
        if (c.skip?.some((w) => t > w.from && t <= w.to)) continue
        const fg = flatten(og)
        const fv = flatten(ov)
        for (const key of Object.keys(fv)) {
          const diff = Math.abs(fg[key] - fv[key])
          expect(
            diff,
            `${c.name} @ t=${t.toFixed(4)} ${key}: gsap=${fg[key]} vos=${fv[key]}`,
          ).toBeLessThanOrEqual(tol)
        }
      }
    })
  }

  it('zero-duration boundary: defined divergence at exactly t = start', () => {
    // Our semantics: a .set applies for ALL t >= startTime, direction-independent.
    // (GSAP renders zero-duration tweens only when the playhead moves onto/past
    // them, so a paused seek(0) shows the pre-set value — a footgun the sampler
    // deliberately removes.)
    const rec = createTweenRecorder()
    const o = { x: 42 }
    const tl = rec.timeline({ paused: true })
    tl.set(o, { x: 0 }, 0)
    tl.seek(0, true)
    expect(o.x).toBe(0)
  })

  it('sampler is seek-order independent (direction-independent semantics)', () => {
    const rec = createTweenRecorder()
    const o = { x: 0, y: 5 }
    const tl = rec.timeline({ paused: true })
    tl.set(o, { x: 0 }, 0)
    tl.to(o, { x: 100, duration: 2, ease: 'none' }, 0)
    tl.from(o, { y: 50, duration: 1, ease: 'none' }, 1)

    // Reference values from a fresh monotonic pass.
    const ref = new Map<number, { x: number; y: number }>()
    const times = [0, 0.5, 1, 1.25, 1.75, 2, 2.5]
    for (const t of times) {
      tl.seek(t, true)
      ref.set(t, { x: o.x, y: o.y })
    }
    // Scrub in a scrambled order — every revisit must reproduce the reference.
    for (const t of [2.5, 0.5, 2, 0, 1.75, 1, 1.25, 0.5, 2.5]) {
      tl.seek(t, true)
      expect(o.x, `x @ ${t}`).toBeCloseTo(ref.get(t)!.x, 9)
      expect(o.y, `y @ ${t}`).toBeCloseTo(ref.get(t)!.y, 9)
    }
  })
})
