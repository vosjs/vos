import type { EaseFn, EaseName } from './types'

/**
 * Pure easing registry, name- and curve-compatible with GSAP's built-ins.
 *
 * Each family defines only its `in` curve; `out`/`inOut` are derived with the
 * same construction GSAP uses (`out(x) = 1 - in(1 - x)`, `inOut` = mirrored
 * halves) — so parity with `gsap.parseEase` holds by construction and is
 * verified in tests. No RNG, no wall-clock, no state: safe for deterministic
 * sandbox evaluation.
 */

const out =
  (easeIn: EaseFn): EaseFn =>
  (x) =>
    1 - easeIn(1 - x)

const inOut =
  (easeIn: EaseFn): EaseFn =>
  (x) =>
    x < 0.5 ? easeIn(x * 2) / 2 : 1 - easeIn((1 - x) * 2) / 2

const family = (name: string, easeIn: EaseFn, target: Record<string, EaseFn>) => {
  target[`${name}.in`] = easeIn
  target[`${name}.out`] = out(easeIn)
  target[`${name}.inOut`] = inOut(easeIn)
}

const BACK_OVERSHOOT = 1.70158
const TAU = Math.PI * 2

/** Configurable back-in (classic overshoot cubic). */
const backIn =
  (overshoot = BACK_OVERSHOOT): EaseFn =>
  (x) =>
    x * x * ((overshoot + 1) * x - overshoot)

/**
 * Configurable elastic (exponentially-damped sine), curve-matched to GSAP
 * black-box: `out` is the primary definition (phase `x - s`), and both `in`
 * and `inOut` are its reflections (`in(x) = 1 - out(1 - x)`; `inOut` is the
 * half-scaled out-branch mirrored point-symmetrically through (0.5, 0.5) —
 * NOT the classic Penner in-branch, which differs for amplitude > 1).
 * Amplitude is clamped to >= 1; the phase shift `s` makes the curve land
 * exactly on 0/1.
 */
const elastic = (
  amplitude = 1,
  period = 0.3,
): { in: EaseFn; out: EaseFn; inOut: EaseFn } => {
  const a = Math.max(1, amplitude)
  const s = (period / TAU) * Math.asin(1 / a)
  const easeOut: EaseFn = (x) =>
    x === 0 || x === 1
      ? x
      : a * Math.pow(2, -10 * x) * Math.sin(((x - s) * TAU) / period) + 1

  const outHalf = (t: number): number =>
    0.5 * (a * Math.pow(2, -10 * t) * Math.sin(((t - s) * TAU) / period)) + 1
  const easeInOut: EaseFn = (x) => {
    if (x === 0 || x === 1) return x
    const t = 2 * x - 1
    return t >= 0 ? outHalf(t) : 1 - outHalf(-t)
  }

  return { in: (x) => 1 - easeOut(1 - x), out: easeOut, inOut: easeInOut }
}

/** Classic piecewise-parabola bounce (defined by its `out` curve). */
const bounceOut: EaseFn = (x) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (x < 1 / d1) return n1 * x * x
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375
  return n1 * (x -= 2.625 / d1) * x + 0.984375
}
const bounceIn: EaseFn = (x) => 1 - bounceOut(1 - x)

/**
 * CSS cubic-bezier(x1, y1, x2, y2) timing function — the same curve family
 * every CSS `transition-timing-function` speaks. Solved the standard way:
 * Newton–Raphson on the x-polynomial (the curve is parameterized by t, not x)
 * with a bisection fallback, then the y-polynomial at the solved t. The x
 * control points are clamped to [0, 1] (the CSS invariant that keeps x(t)
 * monotonic); y control points may exceed [0, 1] for overshoot curves.
 * Deterministic and stateless like every other ease here.
 */
const cubicBezier = (x1: number, y1: number, x2: number, y2: number): EaseFn => {
  const cx1 = Math.min(1, Math.max(0, x1))
  const cx2 = Math.min(1, Math.max(0, x2))
  const coefA = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1
  const coefB = (a1: number, a2: number) => 3 * a2 - 6 * a1
  const coefC = (a1: number) => 3 * a1
  const bez = (t: number, a1: number, a2: number) =>
    ((coefA(a1, a2) * t + coefB(a1, a2)) * t + coefC(a1)) * t
  const slope = (t: number, a1: number, a2: number) =>
    3 * coefA(a1, a2) * t * t + 2 * coefB(a1, a2) * t + coefC(a1)
  const solveX = (x: number): number => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const s = slope(t, cx1, cx2)
      if (Math.abs(s) < 1e-6) break
      t -= (bez(t, cx1, cx2) - x) / s
    }
    if (t >= 0 && t <= 1 && Math.abs(bez(t, cx1, cx2) - x) < 1e-6) return t
    let lo = 0
    let hi = 1
    t = x
    while (hi - lo > 1e-7) {
      if (bez(t, cx1, cx2) < x) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return t
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : bez(solveX(x), y1, y2))
}

/**
 * steps(n): n equal output jumps. GSAP divides the input domain into n+1
 * intervals (verified black-box: steps(5) jumps at 1/6, 2/6, …), so the value
 * reaches 1 on the final interval, not only at x === 1.
 */
const stepsEase = (n: number): EaseFn => {
  const count = Math.max(1, Math.round(n))
  return (x) =>
    Math.min(1, Math.max(0, Math.floor(x * (count + 1)) / count))
}

const build = (): Record<string, EaseFn> => {
  const e: Record<string, EaseFn> = {
    none: (x) => x,
    linear: (x) => x,
  }
  family('power1', (x) => x * x, e)
  family('power2', (x) => x * x * x, e)
  family('power3', (x) => x * x * x * x, e)
  family('power4', (x) => x * x * x * x * x, e)
  family('sine', (x) => (x === 1 ? 1 : 1 - Math.cos((x * Math.PI) / 2)), e)
  // GSAP blends a p^6 term into expo so the curve lands exactly on 0/1.
  family(
    'expo',
    (x) => Math.pow(2, 10 * (x - 1)) * x + x * x * x * x * x * x * (1 - x),
    e,
  )
  family('circ', (x) => -(Math.sqrt(1 - x * x) - 1), e)
  family('back', backIn(), e)
  // GSAP's unparameterized elastic uses period 0.3 for in/out but 0.45 for
  // inOut (verified black-box); explicit args always use the period as given.
  const el = elastic()
  e['elastic.in'] = el.in
  e['elastic.out'] = el.out
  e['elastic.inOut'] = elastic(1, 0.45).inOut
  e['bounce.in'] = bounceIn
  e['bounce.out'] = bounceOut
  e['bounce.inOut'] = inOut(bounceIn)
  return e
}

export const EASINGS: Readonly<Record<EaseName, EaseFn>> = Object.freeze(
  build(),
) as Readonly<Record<EaseName, EaseFn>>

type EaseTriple = { in: EaseFn; out: EaseFn; inOut: EaseFn }

/** Families that accept config args (via `parse`), built per direction. */
const CONFIGURABLE: Record<string, (...args: number[]) => EaseTriple> = {
  back: (overshoot) => {
    const f = backIn(overshoot)
    return { in: f, out: out(f), inOut: inOut(f) }
  },
  elastic: (amplitude, period) => elastic(amplitude, period),
}

/**
 * `family[.direction][(args)]` — e.g. `back.out(1.7)`, `elastic.inOut(1, 0.5)`,
 * `steps(5)`, or a bare `power2`. Matches GSAP's grammar for its built-ins.
 */
const EASE_EXPR = /^([a-zA-Z0-9]+)(?:\.(in|out|inOut))?(?:\(([^)]*)\))?$/

/**
 * `css-bezier(x1, y1, x2, y2)` — a DIALECT-ONLY name (deliberately not a GSAP
 * name, so it can never shadow one): the CSS cubic-bezier timing function.
 * Lets authoring layers use design-tool curves like the Screen-Studio-style
 * `css-bezier(0.16, 1, 0.3, 1)` in keyframe tracks.
 */
const CSS_BEZIER_EXPR =
  /^css-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/

const parsedCache = new Map<string, EaseFn>()

function parse(name: string): EaseFn | undefined {
  const cb = CSS_BEZIER_EXPR.exec(name)
  if (cb) {
    const [x1, y1, x2, y2] = cb.slice(1).map(Number)
    return [x1, y1, x2, y2].every(Number.isFinite)
      ? cubicBezier(x1, y1, x2, y2)
      : undefined
  }
  const m = EASE_EXPR.exec(name)
  if (!m) return undefined
  const [, fam, dir, argsRaw] = m
  const args = argsRaw
    ? argsRaw.split(',').map((s) => Number(s.trim()))
    : []
  if (args.some((a) => !Number.isFinite(a))) return undefined

  if (fam === 'steps') return args.length ? stepsEase(args[0]) : undefined

  // Bare family (no direction) defaults to `.out`, matching GSAP.
  const direction = (dir ?? 'out') as keyof EaseTriple

  if (args.length && fam in CONFIGURABLE) {
    return CONFIGURABLE[fam](...args)[direction]
  }
  // Unparameterized (possibly bare) name → registry lookup.
  return (EASINGS as Record<string, EaseFn>)[`${fam}.${direction}`]
}

/**
 * Resolve an ease by name, including parameterized forms (`back.out(1.7)`,
 * `elastic.out(1, 0.3)`, `steps(5)`) and GSAP's bare-family default
 * (`'power2'` → `power2.out`). Unknown names fall back to linear — evaluation
 * must never throw per-frame inside a running program; authoring layers are
 * expected to validate names at edit time instead.
 */
export function resolveEase(name: string | undefined): EaseFn {
  if (!name) return EASINGS.linear
  const exact = (EASINGS as Record<string, EaseFn>)[name]
  if (exact) return exact
  let parsed = parsedCache.get(name)
  if (!parsed) {
    parsed = parse(name.trim()) ?? EASINGS.linear
    parsedCache.set(name, parsed)
  }
  return parsed
}
