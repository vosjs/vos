import { describe, expect, it } from 'vitest'
import {
  removeSourceRange,
  removeSpeedInRange,
  setSpeedInRange,
  zoomSpanForRange,
} from '../timeline/rangeActions'
import type { SpeedSpan } from '../types'

const span = (id: string, i: number, o: number, rate = 2): SpeedSpan => ({
  id,
  in: i,
  out: o,
  rate,
})

describe('setSpeedInRange', () => {
  it('inserts a manual span into empty space', () => {
    expect(setSpeedInRange([], 2, 5, 3)).toEqual([
      { id: 'sp0', in: 2, out: 5, rate: 3, source: 'manual' },
    ])
  })

  it('re-rates the overlapped part of an existing span, splitting it', () => {
    const next = setSpeedInRange([span('sp0', 0, 10)], 4, 6, 4)
    expect(next).toEqual([
      { id: 'sp0', in: 0, out: 4, rate: 2, source: 'manual' },
      { id: 'sp2', in: 4, out: 6, rate: 4, source: 'manual' },
      { id: 'sp1', in: 6, out: 10, rate: 2, source: 'manual' },
    ])
  })

  it('rate null clears the range (the 1× chip)', () => {
    const next = setSpeedInRange([span('sp0', 0, 10)], 4, 6, null)
    expect(next.map((s) => [s.in, s.out])).toEqual([
      [0, 4],
      [6, 10],
    ])
  })

  it('drops crumbs below the remainder floor', () => {
    const next = setSpeedInRange([span('sp0', 3.9, 6)], 4, 6, 3)
    expect(next).toEqual([
      { id: 'sp1', in: 4, out: 6, rate: 3, source: 'manual' },
    ])
  })

  it('leaves disjoint spans alone', () => {
    const next = setSpeedInRange([span('sp0', 0, 2)], 4, 6, 3)
    expect(next[0]).toEqual(span('sp0', 0, 2))
    expect(next).toHaveLength(2)
  })
})

describe('removeSpeedInRange', () => {
  it('drops whole spans the range touches, keeps the rest', () => {
    const next = removeSpeedInRange(
      [span('a', 0, 2), span('b', 3, 5), span('c', 8, 9)],
      4,
      6,
    )
    expect(next.map((s) => s.id)).toEqual(['a', 'c'])
  })
})

describe('removeSourceRange', () => {
  it('splits a segment around the cut', () => {
    expect(removeSourceRange([{ in: 0, out: 10 }], 4, 6)).toEqual([
      { in: 0, out: 4 },
      { in: 6, out: 10 },
    ])
  })

  it('trims edges and drops swallowed segments', () => {
    expect(
      removeSourceRange(
        [
          { in: 0, out: 3 },
          { in: 5, out: 6 },
          { in: 8, out: 12 },
        ],
        2,
        9,
      ),
    ).toEqual([
      { in: 0, out: 2 },
      { in: 9, out: 12 },
    ])
  })

  it('never empties the take', () => {
    const segs = [{ in: 2, out: 5 }]
    expect(removeSourceRange(segs, 0, 10)).toEqual(segs)
  })
})

describe('zoomSpanForRange', () => {
  it('covers the free range with a manual span', () => {
    expect(zoomSpanForRange([], 2, 5)).toMatchObject({
      id: 'u0',
      in: 2,
      out: 5,
      source: 'manual',
    })
  })

  it('clips against existing spans and mints a fresh id', () => {
    const z = zoomSpanForRange(
      [
        { id: 'u0', in: 0, out: 3, level: 2, cx: 0.5, cy: 0.5 },
        { id: 'z1', in: 6, out: 8, level: 2, cx: 0.5, cy: 0.5 },
      ],
      2,
      7,
    )
    expect(z).toMatchObject({ id: 'u1', in: 3, out: 6 })
  })

  it('returns null when the free room is below the floor', () => {
    expect(
      zoomSpanForRange(
        [{ id: 'u0', in: 0, out: 4.9, level: 2, cx: 0.5, cy: 0.5 }],
        2,
        5,
      ),
    ).toBeNull()
  })
})
