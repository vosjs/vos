import { describe, expect, it } from 'vitest'
import { computePeaks } from '../waveform'

describe('computePeaks', () => {
  it('takes the max |sample| per bucket across channels', () => {
    const l = new Float32Array([0.1, -0.5, 0.2, 0.9, 0, 0, 0.3, -0.4])
    const r = new Float32Array([0.7, 0.1, 0.1, 0.1, 0, -0.2, 0.1, 0.1])
    const peaks = computePeaks([l, r], 4)
    const expected = [0.7, 0.9, 0.2, 0.4]
    expect(peaks.length).toBe(4)
    // Float32Array storage rounds (0.7 → 0.69999…) — compare per element.
    expected.forEach((v, i) => expect(peaks[i]).toBeCloseTo(v, 5))
  })

  it('clamps to 1 and handles empty input', () => {
    expect(Array.from(computePeaks([new Float32Array([2, -3])], 1))).toEqual([
      1,
    ])
    expect(Array.from(computePeaks([], 3))).toEqual([0, 0, 0])
    expect(Array.from(computePeaks([new Float32Array(0)], 2))).toEqual([0, 0])
  })

  it('handles more buckets than samples without gaps', () => {
    const peaks = computePeaks([new Float32Array([0.5, 0.25])], 4)
    expect(peaks.length).toBe(4)
    expect(Math.max(...peaks)).toBe(0.5)
  })
})
