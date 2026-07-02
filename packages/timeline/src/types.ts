/**
 * Value types for deterministic timeline math.
 *
 * These are meant to be EMBEDDED inside an app's own document schema — @vosjs/timeline
 * is an evaluation library, not a document format. Everything is JSON-serializable
 * (eases are registry names, never functions) so the same values travel through
 * `ctx.data` into a running vos program and evaluate identically on both sides.
 */

type EaseFamily =
  | 'power1'
  | 'power2'
  | 'power3'
  | 'power4'
  | 'sine'
  | 'expo'
  | 'circ'
  | 'back'

type EaseDirection = 'in' | 'out' | 'inOut'

/**
 * Serializable easing name. The vocabulary (and the curves) match GSAP's so one
 * ease language spans freeform function-strings and declarative keyframes.
 */
export type EaseName = 'none' | 'linear' | `${EaseFamily}.${EaseDirection}`

/** A pure easing curve: monotonic-ish map of [0,1] → ~[0,1]. */
export type EaseFn = (x: number) => number

/** Interpolate between two values; `u` is the eased mix in [0,1]. */
export type Lerp<V> = (a: V, b: V, u: number) => V

/**
 * A keyframe: the track's value IS `value` at exactly `t` (seconds).
 * `ease` governs the approach INTO this keyframe from the previous one
 * (the segment [prev.t, t] is eased by THIS keyframe's ease).
 */
export interface Keyframe<V = number> {
  t: number
  value: V
  ease?: EaseName
}

/**
 * A keyframe track. Keyframes must be sorted by `t` (use `sortKeyframes`);
 * evaluation clamps to the first/last value outside the keyframed range.
 */
export interface KeyframeTrack<V = number> {
  keyframes: Keyframe<V>[]
  /** 'linear' (default): eased interpolation. 'step': hold the previous value. */
  interpolate?: 'linear' | 'step'
}

/**
 * A kept span of SOURCE time (seconds). A timeline is the concatenation of its
 * segments: trims/splits/multi-clip sequencing are all just segment lists.
 * Segments may repeat or reorder source ranges; `mapTime` only assumes each
 * segment has `in < out`.
 */
export interface Segment {
  in: number
  out: number
}
