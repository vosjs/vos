import { describe, expect, it } from 'vitest'
import {
  CLICK_SYNTH_RELEASE,
  extractClicks,
  hexToRgbTriplet,
} from '../lower/extractClicks'
import { smoothCursor } from '../planner/smoothing'
import type { CursorEvent } from '../types'

const SPACE = { w: 1600, h: 900 }
const OPTS = { space: SPACE }

function down(tMs: number, extra: Partial<CursorEvent> = {}): CursorEvent {
  return { t: tMs, x: 100, y: 100, type: 'down', button: 0, ...extra }
}
function up(tMs: number, extra: Partial<CursorEvent> = {}): CursorEvent {
  return { t: tMs, x: 100, y: 100, type: 'up', button: 0, ...extra }
}

describe('extractClicks', () => {
  it('pairs a down with its up and maps to output time', () => {
    const clicks = extractClicks(
      [down(1000), up(1300)],
      [{ in: 0, out: 10 }],
      OPTS,
    )
    expect(clicks).toHaveLength(1)
    expect(clicks[0].ot).toBe(1)
    expect(clicks[0].up).toBe(1.3)
    expect(clicks[0].st).toBe(1)
    expect(clicks[0].b).toBe(0)
  })

  it('synthesizes a release for an unmatched down', () => {
    const clicks = extractClicks([down(1000)], [{ in: 0, out: 10 }], OPTS)
    expect(clicks[0].up).toBeCloseTo(1 + CLICK_SYNTH_RELEASE, 3)
  })

  it('does not chain two presses across a lost up', () => {
    // down(1s) lost its up; the next down(3s) has a real up(3.2s). The first
    // press must NOT pair with the second's up (that would dip for 2.2s).
    const clicks = extractClicks(
      [down(1000), down(3000), up(3200)],
      [{ in: 0, out: 10 }],
      OPTS,
    )
    expect(clicks).toHaveLength(2)
    expect(clicks[0].up).toBeCloseTo(1 + CLICK_SYNTH_RELEASE, 3)
    expect(clicks[1].up).toBeCloseTo(3.2, 3)
  })

  it('pairs per button (interleaved right click)', () => {
    const clicks = extractClicks(
      [
        down(1000, { button: 0 }),
        down(1100, { button: 2 }),
        up(1400, { button: 2 }),
        up(1600, { button: 0 }),
      ],
      [{ in: 0, out: 10 }],
      OPTS,
    )
    expect(clicks).toHaveLength(2)
    expect(clicks[0].b).toBe(0)
    expect(clicks[0].up).toBeCloseTo(1.6, 3)
    expect(clicks[1].b).toBe(2)
    expect(clicks[1].up).toBeCloseTo(1.4, 3)
  })

  it('drops clicks in trimmed-away footage', () => {
    const clicks = extractClicks(
      [down(500), up(600), down(5000), up(5100)],
      [{ in: 4, out: 10 }],
      OPTS,
    )
    expect(clicks).toHaveLength(1)
    expect(clicks[0].st).toBe(5)
    expect(clicks[0].ot).toBe(1) // 5s source − 4s trim
  })

  it('clamps a release that fell in trimmed footage to the kept output end', () => {
    // press 1s→3s, but footage is cut at 2s: release clamps to output 2s
    const clicks = extractClicks(
      [down(1000), up(3000)],
      [
        { in: 0, out: 2 },
        { in: 5, out: 8 },
      ],
      OPTS,
    )
    expect(clicks[0].ot).toBe(1)
    expect(clicks[0].up).toBe(2)
  })

  it('is rate-aware: output instants compress under a speed span', () => {
    // 2× from 0..4: a click at source 2s lands at output 1s; press ends at
    // source 3s → output 1.5s
    const clicks = extractClicks(
      [down(2000), up(3000)],
      [{ in: 0, out: 4, rate: 2 } as never],
      OPTS,
    )
    expect(clicks[0].ot).toBe(1)
    expect(clicks[0].up).toBe(1.5)
  })

  it('attaches gated element rects only when asked', () => {
    const rect = { x: 60, y: 60, w: 200, h: 80 }
    const events = [down(1000, { rect }), up(1100)]
    const seg = [{ in: 0, out: 10 }]
    expect(extractClicks(events, seg, OPTS)[0].r).toBeUndefined()
    expect(extractClicks(events, seg, { ...OPTS, rects: true })[0].r).toEqual([
      60, 60, 200, 80,
    ])
  })

  it('rejects huge rects and rects that do not contain the click', () => {
    const huge = { x: 0, y: 0, w: 1600, h: 900 }
    const far = { x: 1000, y: 500, w: 100, h: 40 }
    const seg = [{ in: 0, out: 10 }]
    expect(
      extractClicks([down(1000, { rect: huge })], seg, {
        ...OPTS,
        rects: true,
      })[0].r,
    ).toBeUndefined()
    expect(
      extractClicks([down(1000, { rect: far })], seg, {
        ...OPTS,
        rects: true,
      })[0].r,
    ).toBeUndefined()
  })

  it('ignores non-down events entirely', () => {
    const clicks = extractClicks(
      [
        { t: 100, x: 1, y: 1, type: 'move' },
        { t: 200, x: 1, y: 1, type: 'scroll' },
        { t: 300, x: 1, y: 1, type: 'focus' },
        up(400),
      ],
      [{ in: 0, out: 10 }],
      OPTS,
    )
    expect(clicks).toHaveLength(0)
  })
})

describe('click-synced smoothing', () => {
  // a fast flick onto the click point: the plain exponential lerp trails a
  // constant-velocity target by ~v·step·(1−f)/f (~170 px here) at the click
  // instant; the snap pull must land it on the point in time
  const track: CursorEvent[] = [
    { t: 0, x: 0, y: 0, type: 'move' },
    { t: 600, x: 0, y: 0, type: 'move' },
    { t: 1000, x: 500, y: 500, type: 'move' },
    down(1000, { x: 500, y: 500 }),
    up(1100, { x: 500, y: 500 }),
    { t: 2000, x: 500, y: 500, type: 'move' },
  ]

  function at(points: { t: number; x: number; y: number }[], t: number) {
    let p = points[0]
    for (const q of points) if (q.t <= t) p = q
    return p
  }

  it('pulls the smoothed path onto the click point by the click instant', () => {
    const plain = at(smoothCursor(track, { factor: 0.15 }), 1)
    const snapped = at(
      smoothCursor(track, { factor: 0.15, clickSnap: true }),
      1,
    )
    expect(Math.hypot(plain.x - 500, plain.y - 500)).toBeGreaterThan(100)
    expect(Math.hypot(snapped.x - 500, snapped.y - 500)).toBeLessThan(40)
  })

  it('is a no-op without clicks or with clickSnap off', () => {
    const moves = track.filter((e) => e.type === 'move')
    expect(smoothCursor(moves, { factor: 0.15, clickSnap: true })).toEqual(
      smoothCursor(moves, { factor: 0.15 }),
    )
  })
})

describe('hexToRgbTriplet', () => {
  it('parses 6- and 3-digit hex, with or without #', () => {
    expect(hexToRgbTriplet('#ff5148')).toEqual([255, 81, 72])
    expect(hexToRgbTriplet('2563EB')).toEqual([37, 99, 235])
    expect(hexToRgbTriplet('#fff')).toEqual([255, 255, 255])
  })

  it('rejects junk', () => {
    expect(hexToRgbTriplet('')).toBeNull()
    expect(hexToRgbTriplet('#ff514')).toBeNull()
    expect(hexToRgbTriplet('red')).toBeNull()
  })
})
