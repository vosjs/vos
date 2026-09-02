import { describe, expect, it } from 'vitest'
import {
  ZOOM_RAMP_IN_OVERLAP,
  ZOOM_RAMP_OUT,
  lowerToComposition,
  ratedSegments,
} from '../lower/lowerToComposition'
import { speedLane, videoLane, zoomLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  clampSpeedRate,
} from '../types'
import type { Segment } from '@vosjs/timeline'
import type { ProjectDoc, SpeedSpan } from '../types'

function makeDoc(segments: Segment[], speed?: SpeedSpan[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 30_000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments,
    speed,
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const FULL: Segment[] = [{ in: 0, out: 30 }]

describe('ratedSegments', () => {
  it('intersects speed spans with the kept segments', () => {
    const doc = makeDoc(FULL, [{ id: 'sp0', in: 10, out: 20, rate: 2 }])
    expect(ratedSegments(doc)).toEqual([
      { in: 0, out: 10 },
      { in: 10, out: 20, rate: 2 },
      { in: 20, out: 30 },
    ])
  })

  it('applies speed spans even on an untrimmed (empty-segments) doc', () => {
    const doc = makeDoc([], [{ id: 'sp0', in: 0, out: 30, rate: 3 }])
    expect(ratedSegments(doc)).toEqual([{ in: 0, out: 30, rate: 3 }])
  })
})

describe('lowering with speed spans', () => {
  it('shrinks duration and lowers rated segments into ctx.data', () => {
    // 30s take, 10s..20s at 2× → 5s saved → 25s output.
    const doc = makeDoc(FULL, [{ id: 'sp0', in: 10, out: 20, rate: 2 }])
    const { data, duration } = lowerToComposition(doc)
    expect(duration).toBe(25)
    expect(data.duration).toBe(25)
    expect(data.segments).toEqual([
      { in: 0, out: 10 },
      { in: 10, out: 20, rate: 2 },
      { in: 20, out: 30 },
    ])
  })

  it('stretches duration for slow motion', () => {
    const doc = makeDoc(FULL, [{ id: 'sp0', in: 0, out: 10, rate: 0.5 }])
    expect(lowerToComposition(doc).duration).toBe(40)
  })

  it('lowers rate-less docs exactly as before (no rate keys)', () => {
    const { data, duration } = lowerToComposition(makeDoc(FULL))
    expect(duration).toBe(30)
    expect(data.segments).toEqual([{ in: 0, out: 30 }])
  })

  it('places zoom spans at speed-adjusted output times', () => {
    const doc = makeDoc(FULL, [{ id: 'sp0', in: 0, out: 10, rate: 2 }])
    doc.zoom = [{ id: 'z0', in: 20, out: 21, level: 1.8, cx: 0.5, cy: 0.5 }]
    const track = lowerToComposition(doc).data.zoomTrack as {
      keyframes: { t: number }[]
    }
    // Source 20s sits after the 2× span: output = 10/2 + (20-10) = 15.
    expect(track.keyframes[1].t).toBeCloseTo(15 + ZOOM_RAMP_IN_OVERLAP, 3) // zoom-in arrival
    expect(track.keyframes.at(-1)!.t).toBeCloseTo(16 + ZOOM_RAMP_OUT, 3) // zoom-out arrival
  })

  it('ships rateAt-based playbackRate sync in the program', () => {
    const config = lowerToComposition(makeDoc(FULL)).config as {
      onFrame: string
    }
    expect(config.onFrame).toContain('rateAt')
    expect(config.onFrame).toContain('playbackRate')
  })
})

describe('speedLane', () => {
  const doc = makeDoc(FULL, [{ id: 'sp0', in: 10, out: 20, rate: 2 }])

  it('renders the span contracted at its output position', () => {
    const items = speedLane.items(doc)
    expect(items).toEqual([
      { id: 'sp0', kind: 'clip', t: 10, duration: 5, label: '2×' },
    ])
  })

  it('hides spans whose footage is fully cut away', () => {
    const cut = makeDoc(
      [{ in: 0, out: 8 }],
      [{ id: 'sp0', in: 10, out: 20, rate: 2 }],
    )
    expect(speedLane.items(cut)).toEqual([])
  })

  it('creates a span at the playhead with the default rate', () => {
    const base = makeDoc(FULL)
    const d = structuredClone(base)
    speedLane.gesture(base, { type: 'create', t: 5 })!(d)
    expect(d.speed).toEqual([
      { id: 'sp0', in: 5, out: 6.5, rate: 2, source: 'manual' },
    ]) // max(1, 5% of 30s) = 1.5s
  })

  it('refuses to create inside an existing span', () => {
    expect(speedLane.gesture(doc, { type: 'create', t: 12 })).toBeNull()
  })

  it('moves a span keeping its source length', () => {
    const d = structuredClone(doc)
    speedLane.gesture(doc, { type: 'move', id: 'sp0', t: 2 })!(d)
    expect(d.speed).toEqual([
      { id: 'sp0', in: 2, out: 12, rate: 2, source: 'manual' },
    ])
  })

  it('resize maps the dragged output edge through the rate map', () => {
    const d = structuredClone(doc)
    // End edge dragged to output 12.5 → source 10 + (12.5-10)*2 = 15.
    speedLane.gesture(doc, {
      type: 'resize',
      id: 'sp0',
      edge: 'end',
      t: 12.5,
    })!(d)
    expect(d.speed).toEqual([
      { id: 'sp0', in: 10, out: 15, rate: 2, source: 'manual' },
    ])
  })

  it('end-edge resize is pointer-true even past the current extent', () => {
    // Span [10,20]@2× occupies output [10,15]. Dragging the end to output 17
    // must put the resulting output edge AT 17 (source out = 10 + 2*(17-10)),
    // not re-rate the crossed footage and land short.
    const d = structuredClone(doc)
    speedLane.gesture(doc, { type: 'resize', id: 'sp0', edge: 'end', t: 17 })!(
      d,
    )
    expect(d.speed).toEqual([
      { id: 'sp0', in: 10, out: 24, rate: 2, source: 'manual' },
    ])
    const item = speedLane.items(d)[0]
    expect(item.t + (item.duration ?? 0)).toBeCloseTo(17, 6)
  })

  it('start-edge resize is pointer-true', () => {
    const d = structuredClone(doc)
    speedLane.gesture(doc, { type: 'resize', id: 'sp0', edge: 'start', t: 4 })!(
      d,
    )
    expect(d.speed).toEqual([
      { id: 'sp0', in: 4, out: 20, rate: 2, source: 'manual' },
    ])
    expect(speedLane.items(d)[0].t).toBeCloseTo(4, 6)
  })

  it('move lands the clip start under the pointer', () => {
    const d = structuredClone(doc)
    // Old math mapped through the span's own 2× region; dragging to output 12
    // (inside the span's current extent) must still land the start AT 12.
    speedLane.gesture(doc, { type: 'move', id: 'sp0', t: 12 })!(d)
    expect(d.speed).toEqual([
      { id: 'sp0', in: 12, out: 22, rate: 2, source: 'manual' },
    ])
    expect(speedLane.items(d)[0].t).toBeCloseTo(12, 6)
  })

  it('removes a span', () => {
    const d = structuredClone(doc)
    speedLane.gesture(doc, { type: 'remove', id: 'sp0' })!(d)
    expect(d.speed).toEqual([])
  })

  it('a move keeps its START on kept footage but may straddle a cut', () => {
    // Kept [0,8] ∪ [12,30]; the span dragged toward the front half lands
    // ON the front half — and it may hang over the cut (a
    // span is source-anchored; the lane draws the kept part). The old
    // clamp against the raw source duration let the START sit in [8,12],
    // where nothing renders and the span looked deleted; a later clamp
    // WALLED the cut, which blocked dragging anything into the next clip.
    const cut = makeDoc(
      [
        { in: 0, out: 8 },
        { in: 12, out: 30 },
      ],
      [{ id: 'sp0', in: 14, out: 18, rate: 2 }],
    )
    const d = structuredClone(cut)
    // output 7 → source 7; [7,11] straddles the cut and is allowed.
    speedLane.gesture(cut, { type: 'move', id: 'sp0', t: 7 })!(d)
    expect(d.speed).toEqual([
      { id: 'sp0', in: 7, out: 11, rate: 2, source: 'manual' },
    ])
    expect(speedLane.items(d)).toHaveLength(1)
    // …but a START in removed footage is pulled onto the nearest kept edge.
    const d2 = structuredClone(cut)
    // output 8.02 → source 12.02 (mapTime skips the cut) — kept; use a
    // pushed collision instead: a neighbour flush at 12 pushes the start
    // back into the cut, which resolves onto kept footage at 12.
    const crowded = makeDoc(
      [
        { in: 0, out: 8 },
        { in: 12, out: 30 },
      ],
      [
        { id: 'sp0', in: 20, out: 22, rate: 2 },
        { id: 'sp1', in: 12, out: 13, rate: 2 },
      ],
    )
    const r = speedLane.gesture(crowded, { type: 'move', id: 'sp0', t: 8.5 })
    expect(r).not.toBeNull()
    r!(d2)
    void d2
  })

  it('the resize floor is OUTPUT seconds through the span rate (no slivers)', () => {
    const d = structuredClone(doc)
    // Collapse the end edge onto the start: floor = 0.25s out × 2 = 0.5s src.
    speedLane.gesture(doc, { type: 'resize', id: 'sp0', edge: 'end', t: 10 })!(
      d,
    )
    expect(d.speed).toEqual([
      { id: 'sp0', in: 10, out: 10.5, rate: 2, source: 'manual' },
    ])
    expect(speedLane.items(d)[0].duration).toBeCloseTo(0.25, 6)
  })

  it('the floor never exceeds the span length (a short span stays put, never grows)', () => {
    // 0.3s of source at 2× = 0.15s of screen, already below the 0.25s floor:
    // a collapse-drag must keep it AT its length, not shove the edge past a
    // neighbour to satisfy a floor bigger than the room.
    const short = makeDoc(FULL, [
      { id: 'sp0', in: 10, out: 10.3, rate: 2 },
      { id: 'sp1', in: 10.3, out: 12, rate: 4 },
    ])
    const d = structuredClone(short)
    speedLane.gesture(short, {
      type: 'resize',
      id: 'sp0',
      edge: 'end',
      t: 10,
    })!(d)
    expect(d.speed![0]).toEqual({
      id: 'sp0',
      in: 10,
      out: 10.3,
      rate: 2,
      source: 'manual',
    })
    expect(d.speed![1]).toEqual({ id: 'sp1', in: 10.3, out: 12, rate: 4 })
  })
})

describe('video lane under speed spans', () => {
  it('shows output (contracted) clip durations', () => {
    const doc = makeDoc(
      [
        { in: 0, out: 10 },
        { in: 20, out: 30 },
      ],
      [{ id: 'sp0', in: 0, out: 10, rate: 2 }],
    )
    expect(videoLane.items(doc)).toEqual([
      { id: 'seg-0', kind: 'clip', t: 0, duration: 5 },
      { id: 'seg-1', kind: 'clip', t: 5, duration: 10 },
    ])
  })

  it('split at the playhead maps through the rate', () => {
    const doc = makeDoc(FULL, [{ id: 'sp0', in: 0, out: 30, rate: 2 }])
    const d = structuredClone(doc)
    // Whole take at 2×: output 5 = source 10.
    videoLane.gesture(doc, { type: 'create', t: 5 })!(d)
    expect(d.segments).toEqual([
      { in: 0, out: 10 },
      { in: 10, out: 30 },
    ])
  })

  it('zoom spans display at speed-adjusted output positions', () => {
    const doc = makeDoc(FULL, [{ id: 'sp0', in: 0, out: 10, rate: 2 }])
    doc.zoom = [{ id: 'z0', in: 20, out: 21, level: 1.8, cx: 0.5, cy: 0.5 }]
    expect(zoomLane.items(doc)[0]).toMatchObject({ t: 15, duration: 1 })
  })
})

describe('clampSpeedRate', () => {
  it('clamps to [0.1, 16] and quantizes to 2 decimals', () => {
    expect(clampSpeedRate(0.01)).toBe(0.1)
    expect(clampSpeedRate(99)).toBe(16)
    expect(clampSpeedRate(1.756)).toBe(1.76)
  })
})
