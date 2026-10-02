import { describe, expect, it } from 'vitest'
import { zoomTrackFromDoc } from '../lower/lowerToComposition'
import type { LoweredZoomSpan } from '../lower/lowerToComposition'
import { HOLD_DRIFT_MAX, ZOOM_STYLES } from '../zoomStyle'

/**
 * A held zoom can keep moving: `holdDrift` pushes the level in through the
 * hold (eased in and out from the landing to the span's end), so a long beat under a
 * caption is a camera still travelling rather than a still. Absent or 0 the
 * camera parks exactly as before.
 */

const segments = [{ in: 0, out: 30 }]
const span = (
  id: string,
  a: number,
  b: number,
  over: Partial<LoweredZoomSpan> = {},
): LoweredZoomSpan => ({
  id,
  in: a,
  out: b,
  level: 2,
  cx: 0.4,
  cy: 0.4,
  ...over,
})
const glide = ZOOM_STYLES.glide

/** The keyframe that pins a span's end (the hold's last frame). */
const at = (track: ReturnType<typeof zoomTrackFromDoc>, t: number) =>
  track.keyframes.find((k) => Math.abs(k.t - t) < 1e-6)

describe('a camera that drifts through a hold', () => {
  it('parks exactly as before when the style carries no drift', () => {
    const z = [span('a', 2, 8)]
    const parked = zoomTrackFromDoc(z, segments, glide)
    expect(zoomTrackFromDoc(z, segments, { ...glide, holdDrift: 0 })).toEqual(
      parked,
    )
    expect(at(parked, 8)?.value[0]).toBe(2)
  })

  it('pushes the level in, eased, from the landing to the span end', () => {
    const track = zoomTrackFromDoc([span('a', 2, 8)], segments, {
      ...glide,
      holdDrift: 0.01,
    })
    const end = at(track, 8)!
    const landingIdx = track.keyframes.indexOf(end) - 1
    const landing = track.keyframes[landingIdx]
    expect(landing.value[0]).toBe(2)
    expect(end.ease).toBe('sine.inOut')
    // clampZoomLevel keeps levels to hundredths.
    const expected = 2 * (1 + 0.01 * (8 - landing.t))
    expect(end.value[0]).toBeCloseTo(expected, 2)
    expect(end.value.slice(1)).toEqual(landing.value.slice(1))
  })

  it('never grows past its cap, however long the hold', () => {
    const track = zoomTrackFromDoc([span('a', 1, 29)], segments, {
      ...glide,
      holdDrift: 0.05,
    })
    expect(at(track, 29)!.value[0]).toBeCloseTo(2 * (1 + HOLD_DRIFT_MAX), 3)
  })

  it('leaves a span that follows the cursor alone: it already moves', () => {
    const followed = span('a', 2, 8, {
      followEvents: [{ t: 5, cx: 0.6, cy: 0.5 }],
    })
    const plain = zoomTrackFromDoc([followed], segments, glide)
    const drifting = zoomTrackFromDoc([followed], segments, {
      ...glide,
      holdDrift: 0.02,
    })
    expect(drifting).toEqual(plain)
  })

  // Measured on a real take: a follow span whose pointer never left the
  // safe zone bakes no recenter, and drifted while the camera was a follow.
  it('a follow span that baked no recenter still never drifts', () => {
    const quiet = span('a', 2, 8, { focusMode: 'auto' })
    expect(
      zoomTrackFromDoc([quiet], segments, { ...glide, holdDrift: 0.02 }),
    ).toEqual(zoomTrackFromDoc([quiet], segments, glide))
  })

  it('a chained pan leaves from where the drift arrived', () => {
    const track = zoomTrackFromDoc(
      [span('a', 2, 6), span('b', 6.4, 10, { cx: 0.7 })],
      segments,
      { ...glide, holdDrift: 0.02 },
    )
    const end = at(track, 6)!
    expect(end.value[0]).toBeGreaterThan(2)
    const next = track.keyframes[track.keyframes.indexOf(end) + 1]
    expect(next.value[1]).toBe(0.7)
  })
})
