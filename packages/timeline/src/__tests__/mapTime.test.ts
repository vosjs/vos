import { describe, expect, it } from 'vitest'
import { removeSegment, splitSegments, trimSegment } from '../edits'
import { mapTime, sourceToTimeline, totalDuration } from '../mapTime'
import type { Segment } from '../types'

// Keep 2s..5s and 8s..10s of the source → a 5s timeline.
const segs: Segment[] = [
  { in: 2, out: 5 },
  { in: 8, out: 10 },
]

describe('mapTime', () => {
  it('is the identity for an empty segment list', () => {
    expect(mapTime([], 3.7)).toBe(3.7)
    expect(sourceToTimeline([], 3.7)).toBe(3.7)
    expect(totalDuration([])).toBe(0)
  })

  it('concatenates segments into one output timeline', () => {
    expect(totalDuration(segs)).toBe(5)
    expect(mapTime(segs, 0)).toBe(2)
    expect(mapTime(segs, 1.5)).toBe(3.5)
    expect(mapTime(segs, 3)).toBe(8) // boundary: first sample of segment 2
    expect(mapTime(segs, 4.5)).toBe(9.5)
  })

  it('clamps outside the timeline', () => {
    expect(mapTime(segs, -1)).toBe(2)
    expect(mapTime(segs, 5)).toBe(10)
    expect(mapTime(segs, 500)).toBe(10)
  })

  it('sourceToTimeline inverts mapTime on kept ranges', () => {
    for (const t of [0, 0.25, 1.5, 2.999, 3, 4.2]) {
      const src = mapTime(segs, t)
      expect(sourceToTimeline(segs, src)).toBeCloseTo(t, 9)
    }
  })

  it('sourceToTimeline returns null inside cut regions', () => {
    expect(sourceToTimeline(segs, 1)).toBeNull()
    expect(sourceToTimeline(segs, 6.5)).toBeNull()
    expect(sourceToTimeline(segs, 11)).toBeNull()
  })
})

describe('segment edits', () => {
  it('splitSegments splits under the playhead at the mapped source time', () => {
    const out = splitSegments(segs, 1) // source 3, inside segment 0
    expect(out).toEqual([
      { in: 2, out: 3 },
      { in: 3, out: 5 },
      { in: 8, out: 10 },
    ])
    expect(totalDuration(out)).toBe(totalDuration(segs)) // splitting never retimes
  })

  it('splitSegments is a no-op at boundaries and outside', () => {
    expect(splitSegments(segs, 0)).toEqual(segs)
    expect(splitSegments(segs, 3)).toEqual(segs)
    expect(splitSegments(segs, 99)).toEqual(segs)
  })

  it('trimSegment clamps to minimum length and source bounds', () => {
    expect(trimSegment(segs, 0, 'in', 3)[0]).toEqual({ in: 3, out: 5 })
    expect(trimSegment(segs, 0, 'in', 4.99)[0].in).toBeLessThan(5)
    expect(trimSegment(segs, 1, 'out', 99, 10)[1]).toEqual({ in: 8, out: 10 })
    expect(trimSegment(segs, 0, 'in', -5)[0]).toEqual({ in: 0, out: 5 })
    expect(trimSegment(segs, 7, 'in', 1)).toEqual(segs) // invalid index → no-op
  })

  it('removeSegment refuses to remove the last remaining segment', () => {
    expect(removeSegment(segs, 1)).toEqual([{ in: 2, out: 5 }])
    expect(removeSegment([{ in: 0, out: 4 }], 0)).toEqual([{ in: 0, out: 4 }])
  })
})
