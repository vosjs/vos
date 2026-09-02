import { describe, expect, it } from 'vitest'
import {
  capReached,
  cappedLine,
  clampWait,
  defaultMaxDurationSeconds,
} from '../recordingCap'

describe('recording cap', () => {
  it('defaults --max-duration to the free plan cap', () => {
    expect(defaultMaxDurationSeconds()).toBe(1800)
  })

  it('stops exactly at the cap', () => {
    expect(capReached(9_999, 10)).toBe(false)
    expect(capReached(10_000, 10)).toBe(true)
  })

  it('never sleeps a wait step past the cap', () => {
    expect(clampWait(5_000, 0, 10)).toBe(5_000)
    expect(clampWait(5_000, 8_000, 10)).toBe(2_000)
    expect(clampWait(5_000, 12_000, 10)).toBe(0)
  })

  it('prints the cap in words with the flag that set it', () => {
    expect(cappedLine(1800)).toBe(
      'stopped at 30 min (--max-duration 1800); the remaining steps did not run',
    )
  })
})
