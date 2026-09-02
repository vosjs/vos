import { describe, expect, it } from 'vitest'
import {
  TILT_AUTO_DEAD_ZONE,
  TILT_AUTO_MIN,
  planAutoTilt,
} from '../planner/autoTilt'
import { TILT_INTENSITY_MAX } from '../types'
import type { Segment } from '@vosjs/timeline'
import type { ZoomSpan } from '../types'

// planAutoTilt (Dynamic-tilt wand): tilt spans derived FROM zoom spans —
// aligned extents, focus-aimed pose, deterministic ids, source:'auto'.

const FULL: Segment[] = [{ in: 0, out: 30 }]

const zoom = (
  p: Partial<ZoomSpan> & Pick<ZoomSpan, 'in' | 'out'>,
): ZoomSpan => ({
  id: p.id ?? `z${p.in}`,
  level: 1.8,
  cx: 0.5,
  cy: 0.5,
  ...p,
})

describe('planAutoTilt', () => {
  it('emits one auto span per qualifying zoom span, same extents, keyed id', () => {
    const spans = planAutoTilt(
      [zoom({ id: 'z0', in: 2, out: 5, cx: 0.9, cy: 0.5 })],
      FULL,
      { intensity: 'medium' },
    )
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      id: 't-z0',
      in: 2,
      out: 5,
      source: 'auto',
    })
  })

  it('leans toward the focus: right-side focus swings ry negative, top rx positive', () => {
    const [right] = planAutoTilt(
      [zoom({ in: 2, out: 5, cx: 1, cy: 0.5 })],
      FULL,
      { intensity: 'medium' },
    )
    expect(right.ry).toBe(-TILT_INTENSITY_MAX.medium)
    expect(right.rx).toBe(0) // centered vertically → dead zone
    const [top] = planAutoTilt(
      [zoom({ in: 2, out: 5, cx: 0.5, cy: 0 })],
      FULL,
      { intensity: 'medium' },
    )
    expect(top.rx).toBe(TILT_INTENSITY_MAX.medium)
    expect(top.ry).toBe(0)
  })

  it('scales the lean linearly with the offset and clamps at the intensity max', () => {
    const [half] = planAutoTilt(
      [zoom({ in: 2, out: 5, cx: 0.75, cy: 0.5 })],
      FULL,
      { intensity: 'strong' },
    )
    // offset 0.25 of 0.5 → half the max
    expect(half.ry).toBe(-TILT_INTENSITY_MAX.strong / 2)
  })

  it('skips centered focus entirely (both axes in the dead zone)', () => {
    const spans = planAutoTilt(
      [
        zoom({
          in: 2,
          out: 5,
          cx: 0.5 + TILT_AUTO_DEAD_ZONE * 0.9,
          cy: 0.5 - TILT_AUTO_DEAD_ZONE * 0.9,
        }),
      ],
      FULL,
      { intensity: 'medium' },
    )
    expect(spans).toHaveLength(0)
  })

  it('skips zoom spans whose OUTPUT run is too short to settle', () => {
    const short = planAutoTilt(
      [zoom({ in: 2, out: 2 + TILT_AUTO_MIN - 0.1, cx: 1, cy: 0.5 })],
      FULL,
      { intensity: 'medium' },
    )
    expect(short).toHaveLength(0)
    // A long-enough SOURCE span compressed under 2× speed falls under the gate.
    const rated: Segment[] = [{ in: 0, out: 30, rate: 2 } as Segment]
    const compressed = planAutoTilt(
      [zoom({ in: 2, out: 2 + TILT_AUTO_MIN * 1.5, cx: 1, cy: 0.5 })],
      rated,
      { intensity: 'medium' },
    )
    expect(compressed).toHaveLength(0)
  })

  it('skips zoom spans whose footage is fully cut away', () => {
    const segs: Segment[] = [
      { in: 0, out: 2 },
      { in: 10, out: 14 },
    ]
    const spans = planAutoTilt(
      [zoom({ in: 4, out: 8, cx: 1, cy: 0.5 })],
      segs,
      { intensity: 'medium' },
    )
    expect(spans).toHaveLength(0)
  })

  it('is deterministic and sorted by span start', () => {
    const zs = [
      zoom({ id: 'b', in: 10, out: 14, cx: 0.9, cy: 0.5 }),
      zoom({ id: 'a', in: 2, out: 5, cx: 0, cy: 0.5 }),
    ]
    const one = planAutoTilt(zs, FULL, { intensity: 'subtle' })
    const two = planAutoTilt(zs, FULL, { intensity: 'subtle' })
    expect(one).toEqual(two)
    expect(one.map((s) => s.id)).toEqual(['t-a', 't-b'])
    expect(one[0].ry).toBe(TILT_INTENSITY_MAX.subtle) // left focus → +ry
  })
})
