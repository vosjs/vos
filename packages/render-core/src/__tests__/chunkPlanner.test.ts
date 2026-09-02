import { describe, expect, it } from 'vitest'
import { planChunks } from '../chunkPlanner'

describe('planChunks', () => {
  it('covers the timeline exactly once with contiguous ranges', () => {
    const chunks = planChunks(719, 30, { maxParallel: 6 })
    expect(chunks[0].startFrame).toBe(0)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].startFrame).toBe(chunks[i - 1].endFrame)
    }
    expect(chunks[chunks.length - 1].endFrame).toBe(719)
    expect(chunks.reduce((n, c) => n + c.frameCount, 0)).toBe(719)
  })

  it('balances sizes within one frame', () => {
    const chunks = planChunks(100, 30, { maxParallel: 3 })
    const sizes = chunks.map((c) => c.frameCount)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
    expect(sizes).toEqual([34, 33, 33])
  })

  it('derives startTime/duration exactly from frames and fps', () => {
    const chunks = planChunks(90, 30, { maxParallel: 3 })
    expect(chunks[1].startTime).toBeCloseTo(1, 12)
    expect(chunks[1].duration).toBeCloseTo(1, 12)
    // Sum of durations = total duration, no rounding drift.
    const total = chunks.reduce((s, c) => s + c.duration, 0)
    expect(total).toBeCloseTo(3, 12)
  })

  it('refuses to split below the per-chunk floor', () => {
    // 60 frames with a floor of 24 → at most 2 chunks even at parallel 8.
    expect(planChunks(60, 30, { maxParallel: 8 })).toHaveLength(2)
    // Tiny renders stay single-flight.
    expect(planChunks(20, 30, { maxParallel: 8 })).toHaveLength(1)
  })

  it('honors an explicit floor', () => {
    expect(
      planChunks(60, 30, { maxParallel: 8, minFramesPerChunk: 10 }),
    ).toHaveLength(6)
  })

  it('single chunk when parallelism is 1', () => {
    const chunks = planChunks(300, 30, { maxParallel: 1 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      startFrame: 0,
      endFrame: 300,
      startTime: 0,
      duration: 10,
    })
  })

  it('rejects invalid input', () => {
    expect(() => planChunks(0, 30, { maxParallel: 2 })).toThrow()
    expect(() => planChunks(10.5, 30, { maxParallel: 2 })).toThrow()
    expect(() => planChunks(10, 0, { maxParallel: 2 })).toThrow()
  })
})
