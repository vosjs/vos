/**
 * Overlay pose keyframes: the clip-local motion track — base hold,
 * interpolate-over-gap, inherited fields, data parity, and the host-side
 * pose mirror the canvas picking layer uses.
 */
import { describe, expect, it } from 'vitest'
import { lerpArray, sample } from '@vosjs/timeline'
import { motionTrack, overlayMotionPoseAt } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { lowerMerged as lowerToComposition } from './helpers/studio'
import type { KeyframeTrack } from '@vosjs/timeline'
import type { ProjectDoc, TextOverlayClip } from '../types'

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

const textClip = (over: Partial<TextOverlayClip> = {}): TextOverlayClip => ({
  id: 'o1',
  kind: 'text',
  start: 2,
  duration: 4,
  text: 'Hello',
  preset: 'title',
  transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
  ...over,
})

describe('motionTrack', () => {
  const BASE = [0.5, 0.82, 1, 0, 1]

  it('holds the base until the first pose, then interpolates the gap', () => {
    const track = motionTrack(
      BASE,
      [{ at: 2, value: [0.2, 0.3, 1.5, 10, 1] }],
      4,
    )
    // A leading keyframe pins the base at 0 — the value interpolates across
    // [0, 2] (the CapCut convention), never jumps.
    expect(sample(track, 0, lerpArray)).toEqual(BASE)
    const mid = sample(track, 1, lerpArray)
    expect(mid[0]).toBeLessThan(0.5)
    expect(mid[0]).toBeGreaterThan(0.2)
    expect(sample(track, 2, lerpArray)).toEqual([0.2, 0.3, 1.5, 10, 1])
    // Last pose holds to the clip's end (sample clamps).
    expect(sample(track, 4, lerpArray)).toEqual([0.2, 0.3, 1.5, 10, 1])
  })

  it('a first pose at 0 starts the clip on the pose', () => {
    const track = motionTrack(BASE, [{ at: 0, value: [0.1, 0.1, 1, 0, 1] }], 4)
    expect(sample(track, 0, lerpArray)).toEqual([0.1, 0.1, 1, 0, 1])
  })

  it('empty keys produce an empty track', () => {
    expect(motionTrack(BASE, [], 4).keyframes).toEqual([])
  })

  it('clamps pose times into the clip', () => {
    const track = motionTrack(BASE, [{ at: 99, value: [0, 0, 1, 0, 1] }], 4)
    const last = track.keyframes.at(-1)
    expect(last?.t).toBe(4)
  })
})

describe('overlayMotionPoseAt (host mirror)', () => {
  it('resolves inherited fields against the base transform', () => {
    const clip = textClip({ motion: [{ at: 1, scale: 2 }] })
    const held = overlayMotionPoseAt(clip, 1)!
    expect(held[0]).toBeCloseTo(0.5, 3)
    expect(held[1]).toBeCloseTo(0.82, 3)
    expect(held[2]).toBeCloseTo(2, 3)
    expect(overlayMotionPoseAt(textClip(), 1)).toBeNull()
  })
})

describe('lowered object motion data', () => {
  const objClip = (motion?: { at: number; [k: string]: unknown }[]) => ({
    id: 'p1',
    asset: { kind: 'primitive' as const, shape: 'knot' as const },
    span: { start: 1, duration: 3 },
    transform3d: { x: 0.8, y: 0.3, z: 0.5, rx: 0, ry: 0, rz: 0, scale: 0.2 },
    ...(motion ? { motion: motion as never } : {}),
  })

  it('no motion ⇒ no track key; poses bake a clip-local 7-vector track', () => {
    const plain = lowerToComposition(makeDoc({ objects: [objClip()] })).data
    const ob = (plain.objects as Record<string, unknown>[])[0]
    expect(ob).not.toHaveProperty('track')

    const { data } = lowerToComposition(
      makeDoc({
        objects: [
          objClip([
            { at: 0, x: 1.1, scale: 0.05 },
            { at: 1, x: 0.8, scale: 0.2, ry: 20 },
          ]),
        ],
      }),
    )
    const track = (data.objects as Record<string, unknown>[])[0]
      .track as KeyframeTrack<number[]>
    // Fly-in: starts off-frame small, lands on the base pose with a lean.
    expect(sample(track, 0, lerpArray)).toEqual([1.1, 0.3, 0.5, 0, 0, 0, 0.05])
    expect(sample(track, 1, lerpArray)).toEqual([0.8, 0.3, 0.5, 0, 20, 0, 0.2])
  })
})

describe('lowered overlay motion data', () => {
  it('no motion ⇒ no track key (byte parity)', () => {
    const { data } = lowerToComposition(makeDoc({ overlays: [textClip()] }))
    const ol = (data.overlays as Record<string, unknown>[])[0]
    expect(ol).not.toHaveProperty('track')
    const plain = JSON.stringify(
      lowerToComposition(makeDoc({ overlays: [textClip()] })).data,
    )
    const withEmpty = JSON.stringify(
      lowerToComposition(makeDoc({ overlays: [textClip({ motion: [] })] }))
        .data,
    )
    expect(withEmpty).toBe(plain)
  })

  it('poses bake a clip-local track sampled by the shared interpolator', () => {
    const { data } = lowerToComposition(
      makeDoc({
        overlays: [
          textClip({
            motion: [
              { at: 0, x: 0.2, y: 0.2 },
              { at: 2, x: 0.8, y: 0.5, scale: 1.4, opacity: 0.5 },
            ],
          }),
        ],
      }),
    )
    const ol = (data.overlays as Record<string, unknown>[])[0]
    const track = ol.track as KeyframeTrack<number[]>
    expect(sample(track, 0, lerpArray)).toEqual([0.2, 0.2, 1, 0, 1])
    expect(sample(track, 2, lerpArray)).toEqual([0.8, 0.5, 1.4, 0, 0.5])
    // Clip-local: the track knows nothing of the clip's start — OUTPUT
    // anchoring and speed independence come from ON_FRAME's t − start.
    expect(track.keyframes[0].t).toBe(0)
  })
})
