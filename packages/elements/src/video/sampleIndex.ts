/**
 * Pure sample-indexing helpers for frame-accurate video seeking.
 *
 * Separated from the WebCodecs glue so the tricky part — selecting the right
 * decode range for a presentation time, given B-frames — is unit-testable
 * without a browser. (Feeding samples in CTS/presentation order instead of
 * decode order is what produced `EncodingError` in the S2 spike; these helpers
 * encode the correct decode-order GOP selection.)
 */

export interface SampleMeta {
  /** Composition (presentation) timestamp in seconds. */
  cts: number
  /** Whether this is a sync sample (keyframe / IDR). */
  isSync: boolean
}

/** Decode-order indices of all keyframes, ascending. */
export function buildSyncIndices(samples: SampleMeta[]): number[] {
  const out: number[] = []
  for (let i = 0; i < samples.length; i++) if (samples[i].isSync) out.push(i)
  return out
}

/**
 * Decode-order index of the sample whose CTS is the largest ≤ t.
 * Samples are in DECODE order (not sorted by CTS), so this is a linear scan.
 */
export function targetDecodeIndex(samples: SampleMeta[], tSec: number): number {
  let di = 0
  let best = -Infinity
  for (let i = 0; i < samples.length; i++) {
    const c = samples[i].cts
    if (c <= tSec && c > best) {
      best = c
      di = i
    }
  }
  return di
}

/**
 * GOP bounds [ki, ni) in decode order that contain `targetDI`:
 * ki = keyframe at/before targetDI, ni = next keyframe after it (or end).
 * Decode samples[ki..ni-1] in order, then select the output by PTS.
 */
export function gopBounds(
  syncIndices: number[],
  totalSamples: number,
  targetDI: number,
): [number, number] {
  let ki = 0
  for (const si of syncIndices) {
    if (si <= targetDI) ki = si
    else break
  }
  let ni = totalSamples
  for (const si of syncIndices) {
    if (si > targetDI) {
      ni = si
      break
    }
  }
  return [ki, ni]
}
