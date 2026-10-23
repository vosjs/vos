/**
 * A clip's loudness as a target. `normalize` says how loud the clip should
 * play (integrated LUFS); `loudness` is what its file measured, a fact the
 * tooling stores next to it. The gain the clip plays at is derived here, at
 * lowering, so the document stays declarative: swap the file and measure
 * again, and the same target holds.
 *
 *   gain = 10^((normalize - lufs) / 20) × (clip.gain ?? 1)
 *
 * The gain may exceed 1 (a quiet file is lifted), and is CAPPED, never
 * limited: no gain may put the file's sample peak above -1 dBFS, and none is
 * above +24 dB. A cap lowers the whole clip; nothing reshapes its waveform.
 *
 * `normalize` applies only while `loudness` was measured for the clip's own
 * key (`loudness.src === key`). Without that the clip plays at `gain` alone,
 * exactly as a clip with no target, so a document lowers byte-identically
 * until it is measured.
 */
import type { AudioClip } from '../types'

/** The targets a clip may ask for, LUFS. */
export const NORMALIZE_MIN_LUFS = -30
export const NORMALIZE_MAX_LUFS = -6
/** The ceiling a normalized clip's sample peak is held under, dBFS. */
export const NORMALIZE_PEAK_CEILING_DB = -1
/** The most a target may lift a clip, dB. */
export const NORMALIZE_MAX_LIFT_DB = 24

export type ClipGainBasis =
  /** No target: `gain`, clamped to 0..1, as always. */
  | 'gain'
  /** The target applied. */
  | 'normalize'
  /** A target with no measurement for this key: ignored. */
  | 'unmeasured'
  /** A target measured for another key: ignored. */
  | 'stale'

export interface ClipGain {
  /** The linear gain the clip plays at. */
  gain: number
  basis: ClipGainBasis
  /** The gain the target asked for, before the caps (when it applied). */
  asked?: number
  /** Which cap held it, when one did. */
  capped?: 'peak' | 'lift'
}

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Is the clip's measurement one its target may be computed from? */
export function loudnessMatches(
  clip: Partial<Pick<AudioClip, 'key' | 'loudness'>>,
): boolean {
  const l = clip.loudness
  return (
    !!l &&
    typeof l === 'object' &&
    finite(l.lufs) &&
    typeof l.src === 'string' &&
    l.src === clip.key
  )
}

/** The gain a clip plays at, and why. */
export function clipGain(
  clip: Pick<AudioClip, 'gain'> &
    Partial<Pick<AudioClip, 'key' | 'normalize' | 'loudness'>>,
): ClipGain {
  const trim = finite(clip.gain) ? Math.max(0, clip.gain) : 1
  if (!finite(clip.normalize)) return { gain: clamp01(trim), basis: 'gain' }
  if (!clip.loudness || typeof clip.loudness !== 'object')
    return { gain: clamp01(trim), basis: 'unmeasured' }
  if (!loudnessMatches(clip)) return { gain: clamp01(trim), basis: 'stale' }
  const l = clip.loudness
  const target = Math.max(
    NORMALIZE_MIN_LUFS,
    Math.min(NORMALIZE_MAX_LUFS, clip.normalize),
  )
  const asked = Math.pow(10, (target - l.lufs) / 20) * trim
  let gain = asked
  let capped: ClipGain['capped']
  const lift = Math.pow(10, NORMALIZE_MAX_LIFT_DB / 20)
  if (gain > lift) {
    gain = lift
    capped = 'lift'
  }
  if (finite(l.peakDb)) {
    const peak = Math.pow(10, (NORMALIZE_PEAK_CEILING_DB - l.peakDb) / 20)
    if (gain > peak) {
      gain = peak
      capped = 'peak'
    }
  }
  return {
    gain: Math.max(0, gain),
    basis: 'normalize',
    asked,
    ...(capped ? { capped } : {}),
  }
}
