import { describe, expect, it } from 'vitest'
import { lerpArray, sample } from '@vosjs/timeline'
import {
  RAMP_FLOOR,
  camTrackFromDoc,
  connectedWindow,
  lowerToComposition,
  tiltTrackFromDoc,
  zoomTrackFromDoc,
} from '../lower/lowerToComposition'
import { ZOOM_STYLES } from '../zoomStyle'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  TRANSITION_SPEED_MULT,
} from '../types'
import type { KeyframeTrack, Segment } from '@vosjs/timeline'
import type { ProjectDoc, TiltSpan, ZoomSpan } from '../types'

// A connected transition (the tilt swing, the zoom pan, the cam morph) runs
// at its full length however short the gap between the two spans: it
// borrows the time from the outgoing hold. Confined to the gap, two leans
// 0.1 s apart swung the card 37° in 0.14 s, 8° in a single frame.

const FULL: Segment[] = [{ in: 0, out: 40 }]
const at = (track: KeyframeTrack<number[]>, t: number): number[] =>
  [...sample(track, t, lerpArray)]

/** The largest per-frame (60 fps) change of the first two components. */
function peakStep(track: KeyframeTrack<number[]>, t0: number, t1: number) {
  let peak = 0
  let prev = at(track, t0)
  for (let t = t0 + 1 / 60; t <= t1; t += 1 / 60) {
    const v = at(track, t)
    peak = Math.max(peak, Math.hypot(v[0] - prev[0], v[1] - prev[1]))
    prev = v
  }
  return peak
}

/** The [start, land] of the move between two poses, from the keyframes. */
function moveBetween(
  track: KeyframeTrack<number[]>,
  from: number[],
  to: number[],
) {
  const ks = track.keyframes
  const i = ks.findIndex(
    (k, j) =>
      j > 0 &&
      k.value[0] === to[0] &&
      k.value[1] === to[1] &&
      ks[j - 1].value[0] === from[0] &&
      ks[j - 1].value[1] === from[1],
  )
  expect(i).toBeGreaterThan(0)
  return [ks[i - 1].t, ks[i].t]
}

const tilt = (
  p: Partial<TiltSpan> & Pick<TiltSpan, 'in' | 'out'>,
): TiltSpan => ({
  id: `t${p.in}`,
  rx: 0,
  ry: 0,
  ...p,
})

describe('connectedWindow', () => {
  const base = { arrived: 2, tOut: 5, latest: 7, dur: 0.9, floor: RAMP_FLOOR }

  it('leaves at the span end when the gap holds the whole transition', () => {
    expect(connectedWindow({ ...base, landBy: 6 })).toEqual({
      start: 5,
      land: 5.9,
    })
  })

  it('borrows the hold when the gap is short, landing by its mark', () => {
    const w = connectedWindow({ ...base, landBy: 5.1 })
    expect(w.start).toBeCloseTo(4.2, 9)
    expect(w.land).toBeCloseTo(5.1, 9)
  })

  it('never leaves before the outgoing state landed; spills, capped', () => {
    const spill = connectedWindow({ ...base, arrived: 4.9, landBy: 5.1 })
    expect(spill.start).toBe(4.9)
    expect(spill.land).toBeCloseTo(5.8, 9)
    const capped = connectedWindow({
      ...base,
      arrived: 4.9,
      landBy: 5.1,
      latest: 5.3,
    })
    expect(capped).toEqual({ start: 4.9, land: 5.3 })
  })

  it('keeps an instant transition a jump when its floor is 0', () => {
    expect(connectedWindow({ ...base, landBy: 5.1, dur: 0, floor: 0 })).toEqual(
      {
        start: 5,
        land: 5,
      },
    )
  })
})

describe('the tilt swing between connected spans', () => {
  const a = tilt({
    id: 'a',
    in: 2,
    out: 5.5,
    rx: 9,
    ry: 20,
    transition: 'slow',
  })
  const b = tilt({
    id: 'b',
    in: 5.6,
    out: 9.4,
    rx: -12,
    ry: -10,
    transition: 'slow',
  })
  const pan = ZOOM_STYLES.glide.tilt.pan ?? 0
  const motion = ZOOM_STYLES.glide.tilt

  it('takes its full length across a 0.1 s gap and settles at the next start', () => {
    const tr = tiltTrackFromDoc([a, b], FULL, motion)
    const [start, land] = moveBetween(tr, [9, 20], [-12, -10])
    expect(land - start).toBeCloseTo(pan * TRANSITION_SPEED_MULT.slow, 3)
    expect(land).toBeCloseTo(5.6, 6)
    expect(at(tr, 5.6)).toEqual([-12, -10])
  })

  it('turns the card no faster than its own ramp would (the 8°/frame whip is gone)', () => {
    const tr = tiltTrackFromDoc([a, b], FULL, motion)
    expect(peakStep(tr, 3, 7)).toBeLessThan(2)
  })

  it('a swing at every gap from touching to the chain gap lasts its full length', () => {
    for (const gap of [0, 0.05, 0.1, 0.3, 0.55, 1]) {
      const next = tilt({ id: 'n', in: 5.5 + gap, out: 9, rx: -10, ry: 5 })
      const tr = tiltTrackFromDoc(
        [tilt({ id: 'p', in: 2, out: 5.5, rx: 10 }), next],
        FULL,
        motion,
      )
      const [start, land] = moveBetween(tr, [10, 0], [-10, 5])
      expect(land - start, `gap ${gap}`).toBeCloseTo(pan, 3)
      expect(land, `gap ${gap}`).toBeLessThanOrEqual(
        5.5 + Math.max(gap, pan) + 1e-6,
      )
    }
  })

  it('a span too short to lend the time spills into the next, never past its middle', () => {
    const short = tilt({ id: 's', in: 2, out: 2.2, rx: 10 })
    const next = tilt({ id: 'n', in: 2.25, out: 2.65, rx: -10, ry: 5 })
    const tr = tiltTrackFromDoc([short, next], FULL, { ...motion, rampIn: 0.1 })
    const [, land] = moveBetween(tr, [10, 0], [-10, 5])
    expect(land).toBeLessThanOrEqual(2.45 + 1e-6)
    for (let i = 1; i < tr.keyframes.length; i++)
      expect(tr.keyframes[i].t).toBeGreaterThan(tr.keyframes[i - 1].t)
  })
})

describe('the zoom pan between connected spans', () => {
  const style = { ...ZOOM_STYLES.glide, holdDrift: 0.015 }
  const z = (
    p: Partial<ZoomSpan> & Pick<ZoomSpan, 'in' | 'out'>,
  ): ZoomSpan => ({
    id: `z${p.in}`,
    level: 2,
    cx: 0.5,
    cy: 0.5,
    ...p,
  })

  it('pans for its full length across a short gap, and the drift stops where it starts', () => {
    const tr = zoomTrackFromDoc(
      [z({ in: 2, out: 5.4, level: 2.3 }), z({ in: 5.6, out: 9, level: 1.2 })],
      FULL,
      style,
    )
    const land = tr.keyframes.find((k) => k.value[0] === 1.2)!
    const i = tr.keyframes.indexOf(land)
    const start = tr.keyframes[i - 1]
    expect(land.t - start.t).toBeCloseTo(style.pan, 3)
    expect(land.t).toBeCloseTo(5.6 + style.rampInOverlap, 6)
    // The drift's eased climb ends on the pan's first frame.
    expect(start.ease).toBe('sine.inOut')
    expect(start.value[0]).toBeGreaterThan(2.3)
  })
})

describe('the cam morph between connected spans', () => {
  it('morphs for its full length across a short gap; instant stays a jump', () => {
    const spans = [
      { id: 'a', in: 2, out: 5, x: 0.2, y: 0.2 },
      { id: 'b', in: 5.1, out: 8, x: 0.8, y: 0.8 },
    ]
    const tr = camTrackFromDoc(DEFAULT_CAM_STYLE, spans, FULL, 1920)
    const [start, land] = moveBetween(tr, [0.2, 0.2], [0.8, 0.8])
    expect(land - start).toBeCloseTo(0.7, 3)
    expect(land).toBeCloseTo(5.1, 6)

    const cut = camTrackFromDoc(
      DEFAULT_CAM_STYLE,
      [spans[0], { ...spans[1], transition: 'instant' as const }],
      FULL,
      1920,
    )
    const [s2, l2] = moveBetween(cut, [0.2, 0.2], [0.8, 0.8])
    expect(l2 - s2).toBeLessThan(0.01)
  })
})

describe('a span under way when the card finishes entering', () => {
  const doc = (): ProjectDoc => ({
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 12000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 12 }],
    zoom: [
      {
        id: 'm1',
        in: 0.5,
        out: 6,
        level: 2.3,
        cx: 0.5,
        cy: 0.4,
        source: 'manual',
      },
    ],
    tilt: [{ id: 'u1', in: 0.4, out: 6, rx: 9, ry: 20, source: 'manual' }],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      ...DEFAULT_FRAME_STYLE,
      browserBar: DEFAULT_BROWSER_BAR,
      anim: { enter: { kind: 'tilt-in', seconds: 2, at: 2 } },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  })

  it('ramps the lean in from the entrance end and holds it, never a straight creep', () => {
    const { data } = lowerToComposition(doc())
    const tr = data.tiltTrack as KeyframeTrack<number[]>
    const end = 4
    const ramp = ZOOM_STYLES.glide.tilt.rampIn ?? 0
    expect(at(tr, end)).toEqual([0, 0])
    // Settled one ramp after the entrance, then still.
    expect(at(tr, end + ramp + 0.01)).toEqual([9, 20])
    expect(at(tr, 5.5)).toEqual([9, 20])
  })

  it('ramps the zoom in from the entrance end at the ramp, not across the hold', () => {
    const { data } = lowerToComposition(doc())
    const tr = data.zoomTrack as KeyframeTrack<number[]>
    const ramp = ZOOM_STYLES.glide.rampIn
    expect(at(tr, 4)[0]).toBeCloseTo(1, 6)
    expect(at(tr, 4 + ramp + 0.01)[0]).toBeCloseTo(2.3, 6)
  })
})
