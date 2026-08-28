/**
 * A gain envelope: `[t, gain]` points in seconds, linear between points, held
 * flat outside them. An empty or absent envelope is unity.
 */
export type GainEnvelope = Array<[t: number, gain: number]>

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Points sorted by time, non-finite entries dropped. */
export function normalizeEnvelope(
  env: GainEnvelope | undefined | null,
): GainEnvelope {
  if (!env || !env.length) return []
  const pts = env
    .filter(
      (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
    .map(([t, g]) => [t, clamp01(g)] as [number, number])
  pts.sort((a, b) => a[0] - b[0])
  return pts
}

/** Evaluate a normalized envelope at `t`. */
export function sampleEnvelope(env: GainEnvelope, t: number): number {
  const n = env.length
  if (!n) return 1
  if (t <= env[0][0]) return env[0][1]
  if (t >= env[n - 1][0]) return env[n - 1][1]
  // Binary search for the segment containing t.
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (env[mid][0] <= t) lo = mid
    else hi = mid
  }
  const [t0, g0] = env[lo]
  const [t1, g1] = env[hi]
  if (t1 <= t0) return g1
  return g0 + ((g1 - g0) * (t - t0)) / (t1 - t0)
}
