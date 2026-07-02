import { resolveEase } from './easings'
import type { Keyframe, KeyframeTrack, Lerp } from './types'

const lerpNumber: Lerp<number> = (a, b, u) => a + (b - a) * u

/** Component-wise lerp for fixed-length numeric vectors (e.g. [level, cx, cy]). */
export const lerpArray: Lerp<readonly number[]> = (a, b, u) =>
  a.map((av, i) => av + (b[i] - av) * u)

/**
 * Evaluate a keyframe track at time `t` (seconds). Pure and total:
 *   - before the first keyframe → first value; after the last → last value
 *   - between k[i] and k[i+1] → lerp eased by k[i+1].ease (ease-into convention)
 *   - `interpolate: 'step'` holds k[i].value until k[i+1].t
 *
 * Keyframes must be sorted by `t` (binary search relies on it — see
 * `sortKeyframes`). Throws only on an empty track: that is an authoring bug,
 * not a runtime condition.
 */
export function sample(track: KeyframeTrack<number>, t: number): number
export function sample<V>(track: KeyframeTrack<V>, t: number, lerp: Lerp<V>): V
export function sample<V>(
  track: KeyframeTrack<V>,
  t: number,
  lerp?: Lerp<V>,
): V {
  const kfs = track.keyframes
  if (!kfs.length) throw new Error('sample: empty keyframe track')
  if (t <= kfs[0].t) return kfs[0].value
  const last = kfs[kfs.length - 1]
  if (t >= last.t) return last.value

  // Binary search: greatest i with kfs[i].t <= t (0 <= i < length-1 here).
  let lo = 0
  let hi = kfs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (kfs[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = kfs[lo]
  const b = kfs[hi]

  if (track.interpolate === 'step') return a.value
  const dt = b.t - a.t
  if (dt <= 0) return b.value
  const u = resolveEase(b.ease)((t - a.t) / dt)
  return (lerp ?? (lerpNumber as unknown as Lerp<V>))(a.value, b.value, u)
}

/** Return keyframes stably sorted by `t` (the invariant `sample` requires). */
export function sortKeyframes<V>(keyframes: readonly Keyframe<V>[]): Keyframe<V>[] {
  return keyframes
    .map((k, i) => [k, i] as const)
    .sort((x, y) => x[0].t - y[0].t || x[1] - y[1])
    .map(([k]) => k)
}
