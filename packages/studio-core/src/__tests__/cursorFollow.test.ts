import { describe, expect, it } from 'vitest'
import { lerpArray, sample } from '@vosjs/timeline'
import { computeCardLayout, docCardLayout } from '../layout'
import { FOLLOW_RECENTER, followFocusEvents } from '../lower/cursorFollow'
import { ZOOM_RAMP_OUT, lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { KeyframeTrack } from '@vosjs/timeline'
import type { CursorTrack, ProjectDoc, ZoomSpan } from '../types'

const SPACE = { w: 1600, h: 900 }
const layout = computeCardLayout(
  DEFAULT_FRAME_STYLE,
  { width: SPACE.w, height: SPACE.h },
  1920,
  1080,
)
const span: ZoomSpan = {
  id: 'z0',
  in: 2,
  out: 8,
  level: 2,
  cx: 0.5,
  cy: 0.5,
  focusMode: 'auto',
}

/** ms-based cursor moves at normalized positions. */
const moves = (pts: [number, number, number][]): CursorTrack =>
  pts.map(([t, nx, ny]) => ({
    t,
    x: nx * SPACE.w,
    y: ny * SPACE.h,
    type: 'move' as const,
  }))

describe('followFocusEvents', () => {
  it('enters at the cursor position at span.in', () => {
    const track = moves([
      [0, 0.2, 0.3],
      [1500, 0.3, 0.4], // last sample before span.in = 2s
      [5000, 0.31, 0.41],
    ])
    const { entry } = followFocusEvents(span, track, SPACE, layout)
    expect(entry).not.toBeNull()
    expect(entry!.cx).toBeCloseTo(0.3, 2)
    expect(entry!.cy).toBeCloseTo(0.4, 2)
  })

  it('recenters only when the cursor exits the safe zone', () => {
    const track = moves([
      [1000, 0.5, 0.5],
      [3000, 0.52, 0.5], // small drift: inside the dead zone → no event
      [5000, 0.9, 0.5], // far exit → recenter
    ])
    const { events } = followFocusEvents(span, track, SPACE, layout)
    expect(events).toHaveLength(1)
    expect(events[0].t).toBeCloseTo(5, 3)
    expect(events[0].cx).toBeGreaterThan(0.6) // toward the cursor (clamped)
  })

  it('spaces recenters at least FOLLOW_RECENTER apart', () => {
    const track = moves([
      [1000, 0.5, 0.5],
      [3000, 0.9, 0.5],
      [3100, 0.1, 0.5], // exits again immediately — must wait for the glide
      [3200, 0.12, 0.5],
      [4000, 0.1, 0.5], // after the glide → second recenter allowed
    ])
    const { events } = followFocusEvents(span, track, SPACE, layout)
    expect(events.length).toBe(2)
    expect(events[1].t - events[0].t).toBeGreaterThanOrEqual(
      FOLLOW_RECENTER - 1e-6,
    )
  })

  it('is empty without usable samples or meaningful zoom', () => {
    expect(followFocusEvents(span, [], SPACE, layout).entry).toBeNull()
    expect(
      followFocusEvents(
        { ...span, level: 1 },
        moves([[1000, 0.5, 0.5]]),
        SPACE,
        layout,
      ).entry,
    ).toBeNull()
  })

  it('is deterministic', () => {
    const track = moves([
      [1000, 0.5, 0.5],
      [4000, 0.9, 0.8],
      [6000, 0.1, 0.2],
    ])
    expect(followFocusEvents(span, track, SPACE, layout)).toEqual(
      followFocusEvents(span, track, SPACE, layout),
    )
  })
})

describe('follow spans through the lowering', () => {
  const doc: ProjectDoc = {
    source: {
      videoKey: 'blob:v',
      cursor: moves([
        [0, 0.3, 0.3],
        [4000, 0.8, 0.7], // exits the safe zone mid-span → recenter
      ]),
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10_000,
        width: SPACE.w,
        height: SPACE.h,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [span],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }

  it('bakes entry + recenter into the zoom track and freezes focus on zoom-out', () => {
    const track = lowerToComposition(doc).data.zoomTrack as KeyframeTrack<
      number[]
    >
    // entry focus = cursor at span.in (0.3, 0.3-ish, clamped)
    const atHoldStart = sample(track, 2.5, lerpArray)
    expect(atHoldStart[0]).toBe(2)
    expect(atHoldStart[1]).toBeLessThan(0.5) // entered at the cursor, not span.cx
    // after the recenter glide the focus moved toward the cursor
    const late = sample(track, 5.5, lerpArray)
    expect(late[1]).toBeGreaterThan(atHoldStart[1])
    // zoom-out freezes the LAST focus (no parting pan)
    const outStart = sample(track, 8, lerpArray)
    const outEnd = sample(track, 8 + ZOOM_RAMP_OUT, lerpArray)
    expect(outEnd[0]).toBe(1)
    expect(outEnd[1]).toBeCloseTo(outStart[1], 6)
  })

  it('manual spans are unaffected by the cursor track', () => {
    const manual = lowerToComposition({
      ...doc,
      zoom: [{ ...span, focusMode: undefined }],
    }).data.zoomTrack as KeyframeTrack<number[]>
    const held = sample(manual, 5, lerpArray)
    expect(held[1]).toBeCloseTo(0.5, 3)
  })

  it('follow events survive zoomTrackFromDoc time-mapping through trims', () => {
    // Trim the head: source 1..10 → the recenter at source 4s lands at output 3s.
    const lowered = lowerToComposition({
      ...doc,
      segments: [{ in: 1, out: 10 }],
    })
    const track = lowered.data.zoomTrack as KeyframeTrack<number[]>
    const before = sample(track, 2.4, lerpArray) // output 2.4 < recenter
    const after = sample(track, 3.9, lerpArray) // after the glide
    expect(after[1]).toBeGreaterThan(before[1])
  })
})

describe('docCardLayout sanity for follow thresholds', () => {
  it('half-crop threshold shrinks as the level grows', () => {
    const l = docCardLayout({
      frame: DEFAULT_FRAME_STYLE,
      source: {
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 1,
          width: 1600,
          height: 900,
          fps: 30,
        },
      },
    } as never)
    const spanAt = (level: number) => l.W / (2 * level * l.dw)
    expect(spanAt(3)).toBeLessThan(spanAt(1.5))
  })
})
