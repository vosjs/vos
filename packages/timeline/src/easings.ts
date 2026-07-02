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
  family('back', (x) => x * x * ((BACK_OVERSHOOT + 1) * x - BACK_OVERSHOOT), e)
  return e
}

export const EASINGS: Readonly<Record<EaseName, EaseFn>> = Object.freeze(
  build(),
) as Readonly<Record<EaseName, EaseFn>>

/**
 * Resolve an ease by name. Unknown names fall back to linear — evaluation must
 * never throw per-frame inside a running program; authoring layers are expected
 * to validate names against `EASINGS` at edit time instead.
 */
export function resolveEase(name: string | undefined): EaseFn {
  return (name && (EASINGS as Record<string, EaseFn>)[name]) || EASINGS.linear
}
