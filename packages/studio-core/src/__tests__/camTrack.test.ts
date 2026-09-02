/**
 * Cam pose spans: span→track expansion, rest-pose resolution, data
 * parity, and the time-aware picking oracle. The track is the third consumer
 * of the span→track seam (zoom, tilt) and inherits their invariants: pure
 * keyframes in OUTPUT time, strictly-increasing, settled at span.in.
 */
import { describe, expect, it } from 'vitest'
import { lerpArray, sample } from '@vosjs/timeline'
import {
  CAM_CHAIN_GAP,
  CAM_PAN,
  CAM_RAMP_IN,
  CAM_RAMP_OUT,
  camBubbleRectAt,
  camRestPose,
  camTrackFromDoc,
  lowerToComposition,
} from '../lower/lowerToComposition'
import { camBubbleRect } from '../layout'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { KeyframeTrack, Segment } from '@vosjs/timeline'
import type { CamPoseSpan, ProjectDoc } from '../types'

const SEGMENTS: Segment[] = [{ in: 0, out: 10 }]

function makeDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10000,
        width: 1920,
        height: 1080,
        fps: 30,
      },
      camKey: 'blob:cam',
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

describe('camRestPose', () => {
  it('round-trips through camBubbleRect (one corner-math home)', () => {
    for (const position of [
      'bottom-left',
      'bottom-right',
      'top-left',
      'top-right',
    ] as const) {
      const cam = { ...DEFAULT_CAM_STYLE, position, size: 0.3 }
      const rect = camBubbleRect(cam, 1920, 1080)
      const [x, y, size] = camRestPose(cam, 1920, 1080)
      expect(x * 1920 - (size * 1080) / 2).toBeCloseTo(rect.x, 6)
      expect(y * 1080 - (size * 1080) / 2).toBeCloseTo(rect.y, 6)
      expect(size * 1080).toBeCloseTo(rect.size, 6)
    }
  })

  it('free placement resolves to the same fractions it stores', () => {
    const [x, y, size] = camRestPose(
      { ...DEFAULT_CAM_STYLE, x: 0.62, y: 0.31, size: 0.2 },
      1920,
      1080,
    )
    expect(x).toBeCloseTo(0.62, 6)
    expect(y).toBeCloseTo(0.31, 6)
    expect(size).toBeCloseTo(0.2, 6)
  })
})

describe('camTrackFromDoc', () => {
  const span = (over: Partial<CamPoseSpan> = {}): CamPoseSpan => ({
    id: 'm1',
    in: 3,
    out: 6,
    x: 0.5,
    y: 0.5,
    size: 0.4,
    ...over,
  })

  it('rest → settled-at-in → hold → rest, sampled', () => {
    const track = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span()],
      SEGMENTS,
      1920,
      1080,
    )
    const rest = camRestPose(DEFAULT_CAM_STYLE, 1920, 1080)
    // Before the ramp: rest.
    expect(sample(track, 1, lerpArray)).toEqual(
      rest.map((v) => Math.round(v * 1000) / 1000),
    )
    // Settled exactly at span.in and held through the span.
    expect(sample(track, 3, lerpArray)).toEqual([0.5, 0.5, 0.4])
    expect(sample(track, 5.9, lerpArray)).toEqual([0.5, 0.5, 0.4])
    // Mid-ramp-in the pose is between rest and target.
    const mid = sample(track, 3 - CAM_RAMP_IN / 2, lerpArray)
    expect(mid[2]).toBeGreaterThan(rest[2])
    expect(mid[2]).toBeLessThan(0.4)
    // Back at rest after the ramp-out.
    expect(sample(track, 6 + CAM_RAMP_OUT + 0.01, lerpArray)).toEqual(
      rest.map((v) => Math.round(v * 1000) / 1000),
    )
  })

  it('absent pose fields inherit the rest pose', () => {
    const rest = camRestPose(DEFAULT_CAM_STYLE, 1920, 1080)
    const track = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span({ x: undefined, y: undefined, size: 0.45 })],
      SEGMENTS,
      1920,
      1080,
    )
    const held = sample(track, 4, lerpArray)
    expect(held[0]).toBeCloseTo(rest[0], 3)
    expect(held[1]).toBeCloseTo(rest[1], 3)
    expect(held[2]).toBeCloseTo(0.45, 3)
  })

  it('chains pose-to-pose when the gap is short (no return to rest)', () => {
    const a = span({ id: 'a', in: 1, out: 3, x: 0.2, y: 0.2, size: 0.2 })
    const b = span({
      id: 'b',
      in: 3 + CAM_CHAIN_GAP - 0.2,
      out: 8,
      x: 0.8,
      y: 0.8,
      size: 0.4,
    })
    const track = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [a, b],
      SEGMENTS,
      1920,
      1080,
    )
    // Midway through the gap the bubble is morphing between the two poses,
    // never at rest.
    const gapMid = sample(track, 3 + CAM_PAN / 2, lerpArray)
    expect(gapMid[0]).toBeGreaterThan(0.2)
    expect(gapMid[2]).toBeGreaterThan(0.2)
    // Landed on b's pose by its start.
    expect(sample(track, b.in, lerpArray)).toEqual([0.8, 0.8, 0.4])
  })

  it("transition 'instant' collapses the ramps to a hard cut", () => {
    const rest = camRestPose(DEFAULT_CAM_STYLE, 1920, 1080)
    const track = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span({ transition: 'instant' })],
      SEGMENTS,
      1920,
      1080,
    )
    // A hair before the span: still at rest (no ramp lead-in). At the span:
    // the pose. The 1ms emitter nudge is the whole transition.
    expect(sample(track, 2.99, lerpArray)).toEqual(
      rest.map((v) => Math.round(v * 1000) / 1000),
    )
    expect(sample(track, 3.002, lerpArray)).toEqual([0.5, 0.5, 0.4])
    // And a hard cut back to rest at the end.
    expect(sample(track, 6.002, lerpArray)).toEqual(
      rest.map((v) => Math.round(v * 1000) / 1000),
    )
  })

  it("transition 'fast' halves the ramp; absent stays byte-identical", () => {
    const stock = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span()],
      SEGMENTS,
      1920,
      1080,
    )
    const smooth = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span({ transition: 'smooth' })],
      SEGMENTS,
      1920,
      1080,
    )
    expect(JSON.stringify(smooth)).toBe(JSON.stringify(stock))
    const fast = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span({ transition: 'fast' })],
      SEGMENTS,
      1920,
      1080,
    )
    // Ramp starts half as early; still settled exactly at span.in.
    expect(fast.keyframes[0].t).toBeCloseTo(3 - CAM_RAMP_IN / 2, 3)
    expect(sample(fast, 3, lerpArray)).toEqual([0.5, 0.5, 0.4])
  })

  it('is source-anchored: a fully-cut span emits nothing', () => {
    const track = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span({ in: 3, out: 6 })],
      [{ in: 7, out: 10 }],
      1920,
      1080,
    )
    expect(track.keyframes).toEqual([])
  })

  it('maps through rated segments (speed-aware output times)', () => {
    // 2× over the whole source: the span lands at half its source time.
    const track = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [span({ in: 4, out: 6 })],
      [{ in: 0, out: 10, rate: 2 } as Segment],
      1920,
      1080,
    )
    expect(sample(track, 2, lerpArray)).toEqual([0.5, 0.5, 0.4])
    expect(sample(track, 3, lerpArray)).toEqual([0.5, 0.5, 0.4])
  })
})

describe('lowered data parity (TD4)', () => {
  it('emits no camTrack without spans', () => {
    expect(lowerToComposition(makeDoc()).data).not.toHaveProperty('camTrack')
    expect(
      lowerToComposition(makeDoc({ camMotion: [] })).data,
    ).not.toHaveProperty('camTrack')
  })

  it('emits no camTrack without a cam recording', () => {
    const doc = makeDoc({
      camMotion: [{ id: 'm1', in: 1, out: 3, x: 0.5, y: 0.5 }],
    })
    doc.source = { ...doc.source, camKey: undefined }
    expect(lowerToComposition(doc).data).not.toHaveProperty('camTrack')
  })

  it('a motion-less doc lowers byte-identically to pre-MO output', () => {
    const plain = JSON.stringify(lowerToComposition(makeDoc()).data)
    const withEmpty = JSON.stringify(
      lowerToComposition(makeDoc({ camMotion: [] })).data,
    )
    expect(withEmpty).toBe(plain)
  })

  it('emits camTrack when spans exist, sampled by the shared interpolator', () => {
    const { data } = lowerToComposition(
      makeDoc({
        camMotion: [{ id: 'm1', in: 3, out: 6, x: 0.8, y: 0.2, size: 0.35 }],
      }),
    )
    const track = data.camTrack as KeyframeTrack<number[]>
    expect(sample(track, 4, lerpArray)).toEqual([0.8, 0.2, 0.35])
  })
})

describe('camBubbleRectAt (the time-aware oracle)', () => {
  it('equals camBubbleRect when the doc has no motion', () => {
    const doc = makeDoc()
    expect(camBubbleRectAt(doc, 2)).toEqual(camBubbleRect(doc.cam, 1920, 1080))
  })

  it('tracks the sampled pose inside a span and rests outside', () => {
    const doc = makeDoc({
      camMotion: [{ id: 'm1', in: 3, out: 6, x: 0.8, y: 0.2, size: 0.35 }],
    })
    const held = camBubbleRectAt(doc, 4)
    expect(held.size).toBeCloseTo(0.35 * 1080, 3)
    expect(held.x).toBeCloseTo(0.8 * 1920 - (0.35 * 1080) / 2, 3)
    expect(held.y).toBeCloseTo(0.2 * 1080 - (0.35 * 1080) / 2, 3)
    // Track keyframes quantize to 3-decimal fractions (trackEmitter), so the
    // rest pose recovered through the track sits within ~1 design px of the
    // exact static rect — precision 0 (±0.5px) covers it.
    const rest = camBubbleRectAt(doc, 0.5)
    const staticRect = camBubbleRect(doc.cam, 1920, 1080)
    expect(rest.x).toBeCloseTo(staticRect.x, 0)
    expect(rest.y).toBeCloseTo(staticRect.y, 0)
    expect(rest.size).toBeCloseTo(staticRect.size, 0)
  })
})
