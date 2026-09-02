import { describe, expect, it } from 'vitest'
import {
  REJECT_OVERLAP,
  isRejected,
  overlapFraction,
  rejectSpan,
  withoutRejected,
} from '../rejected'
import type { RejectedSpan } from '../types'

const rejected: RejectedSpan[] = [
  { id: 'r0', lane: 'zoom', in: 4.5, out: 7.35 },
  { id: 'r1', lane: 'speed', in: 12, out: 13.5 },
]

describe('overlapFraction', () => {
  it('is the shared length over the shorter span', () => {
    expect(overlapFraction({ in: 0, out: 2 }, { in: 1, out: 5 })).toBe(0.5)
    expect(overlapFraction({ in: 1, out: 5 }, { in: 0, out: 2 })).toBe(0.5)
    expect(overlapFraction({ in: 0, out: 2 }, { in: 2, out: 4 })).toBe(0)
    expect(overlapFraction({ in: 0, out: 2 }, { in: 0.5, out: 1.5 })).toBe(1)
  })

  it('is 0 for a degenerate span', () => {
    expect(overlapFraction({ in: 1, out: 1 }, { in: 0, out: 2 })).toBe(0)
  })
})

describe('isRejected', () => {
  it('rejects a proposal on the same lane that lands on the extent', () => {
    // a re-record moved the beat by 60 ms: still the same beat
    expect(isRejected('zoom', { in: 4.56, out: 7.41 }, rejected)).toBe(true)
    // a proposal half a second long inside the rejected window
    expect(isRejected('zoom', { in: 5, out: 5.5 }, rejected)).toBe(true)
  })

  it('keeps a proposal on another lane, or one that merely touches', () => {
    expect(isRejected('tilt', { in: 4.5, out: 7.35 }, rejected)).toBe(false)
    expect(isRejected('zoom', { in: 7, out: 9 }, rejected)).toBe(false)
    expect(isRejected('zoom', { in: 7.35, out: 9 }, rejected)).toBe(false)
  })

  it(`needs ${REJECT_OVERLAP} of the shorter span`, () => {
    // 1 s shared of a 3 s proposal is a third: a different beat
    expect(isRejected('zoom', { in: 6.35, out: 9.35 }, rejected)).toBe(false)
    // 1.5 s shared of a 3 s proposal is half: the same beat
    expect(isRejected('zoom', { in: 5.85, out: 8.85 }, rejected)).toBe(true)
  })

  it('is false with no list', () => {
    expect(isRejected('zoom', { in: 4.5, out: 7.35 }, undefined)).toBe(false)
    expect(isRejected('zoom', { in: 4.5, out: 7.35 }, [])).toBe(false)
  })
})

describe('withoutRejected', () => {
  it('drops only the rejected proposals and keeps the order', () => {
    const proposals = [
      { id: 'd0', in: 0.2, out: 1.2 },
      { id: 'd1', in: 4.6, out: 7.3 },
      { id: 'd2', in: 12.1, out: 13.2 },
    ]
    expect(
      withoutRejected('zoom', proposals, rejected).map((p) => p.id),
    ).toEqual(['d0', 'd2'])
    expect(
      withoutRejected('speed', proposals, rejected).map((p) => p.id),
    ).toEqual(['d0', 'd1'])
    expect(withoutRejected('zoom', proposals, undefined)).toBe(proposals)
  })
})

describe('rejectSpan', () => {
  it('names the entry past the ids in use and keeps the anchor', () => {
    const entry = rejectSpan(
      rejected,
      'zoom',
      { in: 0.32, out: 1.3204, anchor: { step: 's1', offset: 0.1 } },
      'the parked cursor, not a dwell',
    )
    expect(entry).toEqual({
      id: 'r2',
      lane: 'zoom',
      in: 0.32,
      out: 1.32,
      anchor: { step: 's1', offset: 0.1 },
      note: 'the parked cursor, not a dwell',
    })
    expect(rejectSpan(undefined, 'tilt', { in: 1, out: 2 })).toEqual({
      id: 'r0',
      lane: 'tilt',
      in: 1,
      out: 2,
    })
  })
})
