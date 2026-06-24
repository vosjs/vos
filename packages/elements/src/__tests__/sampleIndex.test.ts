import { describe, expect, it } from 'vitest'
import {
  buildSyncIndices,
  gopBounds,
  targetDecodeIndex,
  type SampleMeta,
} from '../video/sampleIndex'

// Simulated DECODE-order samples for a 2-GOP clip with B-frames.
// Keyframes at decode index 0 and 4. CTS (presentation) is intentionally
// reordered vs decode order to mimic B-frame reordering.
const samples: SampleMeta[] = [
  { cts: 0.0, isSync: true }, // 0  key
  { cts: 0.3, isSync: false }, // 1  (P, presented later)
  { cts: 0.1, isSync: false }, // 2  (B)
  { cts: 0.2, isSync: false }, // 3  (B)
  { cts: 0.4, isSync: true }, // 4  key
  { cts: 0.7, isSync: false }, // 5
  { cts: 0.5, isSync: false }, // 6
  { cts: 0.6, isSync: false }, // 7
]

describe('sampleIndex', () => {
  it('buildSyncIndices returns decode indices of keyframes', () => {
    expect(buildSyncIndices(samples)).toEqual([0, 4])
  })

  it('targetDecodeIndex finds the largest cts <= t (not cts-sorted)', () => {
    expect(targetDecodeIndex(samples, 0.0)).toBe(0)
    expect(targetDecodeIndex(samples, 0.1)).toBe(2) // cts 0.1 lives at decode index 2
    expect(targetDecodeIndex(samples, 0.25)).toBe(3) // cts 0.2 is the largest <= 0.25
    expect(targetDecodeIndex(samples, 0.45)).toBe(4)
    expect(targetDecodeIndex(samples, 0.65)).toBe(7) // cts 0.6
    expect(targetDecodeIndex(samples, 99)).toBe(5) // largest cts (0.7) at decode index 5
  })

  it('gopBounds selects the enclosing keyframe → next-keyframe range (decode order)', () => {
    // target in first GOP (indices 0..3) → [0, 4)
    expect(gopBounds([0, 4], 8, 2)).toEqual([0, 4])
    expect(gopBounds([0, 4], 8, 3)).toEqual([0, 4])
    // target in second GOP (indices 4..7) → [4, 8)
    expect(gopBounds([0, 4], 8, 5)).toEqual([4, 8])
    expect(gopBounds([0, 4], 8, 7)).toEqual([4, 8])
    // target on a keyframe
    expect(gopBounds([0, 4], 8, 0)).toEqual([0, 4])
    expect(gopBounds([0, 4], 8, 4)).toEqual([4, 8])
  })

  it('decode range always starts at a keyframe (the B-frame correctness guarantee)', () => {
    const sync = buildSyncIndices(samples)
    for (let t = 0; t <= 0.7; t += 0.05) {
      const di = targetDecodeIndex(samples, t)
      const [ki] = gopBounds(sync, samples.length, di)
      expect(samples[ki].isSync).toBe(true)
      expect(ki).toBeLessThanOrEqual(di)
    }
  })
})
