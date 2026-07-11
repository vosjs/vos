import { describe, expect, it } from 'vitest'
import { splitSegments, trimSegment } from '../edits'
import {
  mapTime,
  rateAt,
  sourceToTimeline,
  splitBySpeed,
  totalDuration,
} from '../mapTime'
import type { Segment } from '../types'

// Keep 2s..5s and 8s..10s of the source; play 3s..5s at 2× → 4s timeline.
const rated: Segment[] = [
  { in: 2, out: 3 },
  { in: 3, out: 5, rate: 2 },
  { in: 8, out: 10 },
]

describe('rated segments', () => {
  it('totalDuration divides source length by rate', () => {
    expect(totalDuration(rated)).toBe(1 + 1 + 2)
    expect(totalDuration([{ in: 0, out: 4, rate: 0.5 }])).toBe(8)
  })

  it('treats missing or invalid rates as 1', () => {
    expect(totalDuration([{ in: 0, out: 3, rate: 0 }])).toBe(3)
    expect(totalDuration([{ in: 0, out: 3, rate: -2 }])).toBe(3)
    expect(mapTime([{ in: 0, out: 3, rate: 0 }], 1)).toBe(1)
  })

  it('mapTime advances rate× through rated spans', () => {
    expect(mapTime(rated, 0.5)).toBe(2.5) // 1× span
    expect(mapTime(rated, 1)).toBe(3) // boundary into the 2× span
    expect(mapTime(rated, 1.5)).toBe(4) // 0.5s output → 1s source
    expect(mapTime(rated, 2)).toBe(8) // boundary into segment 3
    expect(mapTime(rated, 3)).toBe(9)
    expect(mapTime(rated, 99)).toBe(10) // clamp
  })

  it('sourceToTimeline inverts mapTime on kept ranges', () => {
    for (const t of [0, 0.5, 1.25, 1.999, 2.5, 3.75]) {
      const src = mapTime(rated, t)
      expect(sourceToTimeline(rated, src)).toBeCloseTo(t, 9)
    }
  })

  it('rateAt reports the rate under the playhead', () => {
    expect(rateAt(rated, 0.5)).toBe(1)
    expect(rateAt(rated, 1.5)).toBe(2)
    expect(rateAt(rated, 3.5)).toBe(1)
    expect(rateAt(rated, 99)).toBe(1)
    expect(rateAt([], 1)).toBe(1)
  })
})

describe('splitBySpeed', () => {
  const segs: Segment[] = [
    { in: 2, out: 5 },
    { in: 8, out: 10 },
  ]

  it('returns copies when there are no speed spans', () => {
    const out = splitBySpeed(segs, [])
    expect(out).toEqual(segs)
    expect(out[0]).not.toBe(segs[0])
  })

  it('splits a segment around an interior span', () => {
    const out = splitBySpeed(segs, [{ in: 3, out: 4, rate: 5 }])
    expect(out).toEqual([
      { in: 2, out: 3 },
      { in: 3, out: 4, rate: 5 },
      { in: 4, out: 5 },
      { in: 8, out: 10 },
    ])
    expect(totalDuration(out)).toBeCloseTo(1 + 0.2 + 1 + 2, 9)
  })

  it('clips spans to segment bounds and spans cuts', () => {
    // Span 4s..9s straddles the cut 5s..8s: only the kept parts get the rate.
    const out = splitBySpeed(segs, [{ in: 4, out: 9, rate: 2 }])
    expect(out).toEqual([
      { in: 2, out: 4 },
      { in: 4, out: 5, rate: 2 },
      { in: 8, out: 9, rate: 2 },
      { in: 9, out: 10 },
    ])
  })

  it('applies multiple spans in source order, earlier span wins overlaps', () => {
    const out = splitBySpeed([{ in: 0, out: 10 }], [
      { in: 2, out: 5, rate: 2 },
      { in: 4, out: 7, rate: 0.5 },
    ])
    expect(out).toEqual([
      { in: 0, out: 2 },
      { in: 2, out: 5, rate: 2 },
      { in: 5, out: 7, rate: 0.5 },
      { in: 7, out: 10 },
    ])
  })

  it('ignores degenerate and non-positive-rate spans', () => {
    expect(splitBySpeed(segs, [{ in: 3, out: 3, rate: 2 }])).toEqual(segs)
    expect(splitBySpeed(segs, [{ in: 3, out: 4, rate: 0 }])).toEqual(segs)
  })

  it('covers a whole segment without emitting slivers', () => {
    const out = splitBySpeed(segs, [{ in: 2, out: 5, rate: 3 }])
    expect(out).toEqual([
      { in: 2, out: 5, rate: 3 },
      { in: 8, out: 10 },
    ])
  })
})

describe('edits preserve rates', () => {
  it('splitSegments scans in output time and keeps rates on both halves', () => {
    // 2× segment occupies 1s of output; split at output 1.5 → source 4.
    const out = splitSegments(rated, 1.5)
    expect(out).toEqual([
      { in: 2, out: 3 },
      { in: 3, out: 4, rate: 2 },
      { in: 4, out: 5, rate: 2 },
      { in: 8, out: 10 },
    ])
    expect(totalDuration(out)).toBeCloseTo(totalDuration(rated), 9)
  })

  it('trimSegment keeps the rate', () => {
    expect(trimSegment(rated, 1, 'out', 4.5)[1]).toEqual({ in: 3, out: 4.5, rate: 2 })
  })
})
