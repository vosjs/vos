import { describe, expect, it } from 'vitest'
import { lerpArray, sample } from '@vosjs/timeline'
import {
  TILT_CHAIN_GAP,
  TILT_EASE,
  TILT_PAN,
  TILT_RAMP_IN,
  TILT_RAMP_OUT,
  lowerToComposition,
  tiltTrackFromDoc,
} from '../lower/lowerToComposition'
import { ZOOM_STYLES } from '../zoomStyle'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { Segment } from '@vosjs/timeline'
import type { ProjectDoc, TiltSpan } from '../types'

// tiltTrackFromDoc: the span→OUTPUT-time [rx, ry] degree
// track expansion. Pure math — mirrors zoomTrackFromDoc's grammar (rest →
// ramp-in → hold → ramp-out, connected-span pans, monotonic emit) with the
// tilt-specific differences pinned here: rest is FLAT (no static pose), arrival
// SETTLED at span.in, fixed ramp constants.

const span = (
  p: Partial<TiltSpan> & Pick<TiltSpan, 'in' | 'out'>,
): TiltSpan => ({
  id: p.id ?? `t${p.in}`,
  rx: 8,
  ry: -10,
  ...p,
})

const FULL: Segment[] = [{ in: 0, out: 30 }]

const at = (track: { keyframes: unknown[] }, t: number): number[] =>
  sample(track as never, t, lerpArray) as number[]

describe('tiltTrackFromDoc', () => {
  it('shapes one span as rest → ramp-in → hold → ramp-out → rest', () => {
    const tr = tiltTrackFromDoc([span({ in: 5, out: 8 })], FULL)
    // Settled exactly at span.in, held to span.out.
    expect(at(tr, 5)).toEqual([8, -10])
    expect(at(tr, 8)).toEqual([8, -10])
    // At rest before the ramp starts and after the ramp-out ends.
    expect(at(tr, 5 - TILT_RAMP_IN - 0.01)).toEqual([0, 0])
    expect(at(tr, 8 + TILT_RAMP_OUT + 0.01)).toEqual([0, 0])
    // Mid-ramp is strictly between rest and pose (the ease is monotonic).
    const mid = at(tr, 5 - TILT_RAMP_IN / 2)
    expect(mid[0]).toBeGreaterThan(0)
    expect(mid[0]).toBeLessThan(8)
  })

  it('chains spans within TILT_CHAIN_GAP pose-to-pose without flattening', () => {
    const a = span({ id: 'a', in: 2, out: 4, rx: 10, ry: 0 })
    const b = span({
      id: 'b',
      in: 4 + TILT_CHAIN_GAP - 0.1,
      out: 8,
      rx: -10,
      ry: 5,
    })
    const tr = tiltTrackFromDoc([a, b], FULL)
    // The swing lands the next pose by (or before) the next span's start...
    expect(at(tr, 4 + TILT_CHAIN_GAP - 0.1)).toEqual([-10, 5])
    // ...and no point in the gap returns to rest [0,0].
    for (let t = 4; t <= 4 + TILT_CHAIN_GAP - 0.1; t += 0.05) {
      const v = at(tr, t)
      expect(Math.abs(v[0]) + Math.abs(v[1])).toBeGreaterThan(0.5)
    }
  })

  it('returns to rest between spans farther apart than the chain gap', () => {
    const a = span({ id: 'a', in: 2, out: 4 })
    const b = span({
      id: 'b',
      in: 4 + TILT_CHAIN_GAP + TILT_RAMP_OUT + TILT_RAMP_IN + 1,
      out: 20,
    })
    const tr = tiltTrackFromDoc([a, b], FULL)
    expect(at(tr, 4 + TILT_RAMP_OUT + 0.5)).toEqual([0, 0])
  })

  it('drops a fully-cut span and follows kept footage through trims', () => {
    const segs: Segment[] = [
      { in: 0, out: 2 },
      { in: 10, out: 14 },
    ]
    // Fully inside the cut 2..10 → no keyframes at all.
    expect(
      tiltTrackFromDoc([span({ in: 4, out: 6 })], segs).keyframes,
    ).toHaveLength(0)
    // Source 11..13 lands at output 3..5 (2s kept before the second segment).
    const tr = tiltTrackFromDoc([span({ in: 11, out: 13 })], segs)
    expect(at(tr, 3)).toEqual([8, -10])
    expect(at(tr, 5)).toEqual([8, -10])
    expect(at(tr, 3 - TILT_RAMP_IN - 0.01)).toEqual([0, 0])
  })

  it('maps span extents through speed rates (rated segments)', () => {
    const rated: Segment[] = [{ in: 0, out: 10, rate: 2 } as Segment]
    const tr = tiltTrackFromDoc([span({ in: 2, out: 4 })], rated)
    // 2× footage: source 2..4 → output 1..2.
    expect(at(tr, 1)).toEqual([8, -10])
    expect(at(tr, 2)).toEqual([8, -10])
    expect(at(tr, 2 + TILT_RAMP_OUT + 0.01)).toEqual([0, 0])
  })

  it('clamps poses to ±45° and quantizes to 1 decimal', () => {
    const tr = tiltTrackFromDoc(
      [span({ in: 5, out: 8, rx: 90, ry: -88.888 })],
      FULL,
    )
    expect(at(tr, 6)).toEqual([45, -45])
  })

  it('falls back to the house ease for unknown ease names', () => {
    const tr = tiltTrackFromDoc(
      [span({ in: 5, out: 8, ease: 'not-a-real-ease' })],
      FULL,
    )
    const arrival = tr.keyframes.find((k) => k.t === 5)
    expect(arrival?.ease).toBe(TILT_EASE)
  })

  it('keeps keyframe times strictly increasing for dense spans', () => {
    const spans = [
      span({ id: 'a', in: 1, out: 1.9, rx: 5, ry: 0 }),
      span({ id: 'b', in: 2, out: 2.9, rx: -5, ry: 3 }),
      span({ id: 'c', in: 3, out: 3.9, rx: 9, ry: -9 }),
    ]
    const tr = tiltTrackFromDoc(spans, FULL)
    for (let i = 1; i < tr.keyframes.length; i++) {
      expect(tr.keyframes[i].t).toBeGreaterThan(tr.keyframes[i - 1].t)
    }
  })

  it('a chained swing lands within TILT_PAN of the previous span ending', () => {
    const a = span({ id: 'a', in: 2, out: 4, rx: 10, ry: 0 })
    const b = span({ id: 'b', in: 4 + TILT_CHAIN_GAP, out: 8, rx: -10, ry: 5 })
    const tr = tiltTrackFromDoc([a, b], FULL)
    const landing = tr.keyframes.find(
      (k) => k.value[0] === -10 && k.value[1] === 5,
    )
    expect(landing).toBeDefined()
    expect(landing!.t).toBeLessThanOrEqual(
      Math.min(4 + TILT_PAN, 4 + TILT_CHAIN_GAP) + 1e-6,
    )
  })
})

// --- lowering emit: byte parity + rest pose plumbed from the doc ---

function makeDoc(tilt?: TiltSpan[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 3000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...DEFAULT_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    ...(tilt !== undefined ? { tilt } : {}),
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('camera-style tilt personalities', () => {
  it('every camera style declares a tilt personality', () => {
    for (const params of Object.values(ZOOM_STYLES)) {
      expect(params.tilt).toBeDefined()
      expect(['off', 'subtle', 'medium', 'strong']).toContain(
        params.tilt.intensity,
      )
    }
  })

  it('keynote leans medium with tilt ramps MATCHED to its zoom ramps', () => {
    const s = ZOOM_STYLES.keynote
    expect(s.tilt.intensity).toBe('medium')
    expect(s.tilt.rampIn).toBe(s.rampIn)
    expect(s.tilt.rampOut).toBe(s.rampOut)
    expect(s.tilt.chainGap).toBe(s.chainGap)
  })

  it('drift leans subtle, slower than the house constants, longer chains', () => {
    const s = ZOOM_STYLES.drift
    expect(s.tilt.intensity).toBe('subtle')
    expect(s.tilt.rampIn!).toBeGreaterThan(TILT_RAMP_IN)
    expect(s.tilt.rampOut!).toBeGreaterThan(TILT_RAMP_OUT)
    expect(s.tilt.chainGap!).toBeGreaterThan(TILT_CHAIN_GAP)
  })

  it('pre-existing styles stay flat — no silent motion change (tilt off)', () => {
    for (const name of [
      'glide',
      'focus',
      'cinema',
      'snappy',
      'cut',
      'none',
    ] as const) {
      expect(ZOOM_STYLES[name].tilt.intensity).toBe('off')
    }
  })

  it('motion overrides stretch the track ramps', () => {
    const tr = tiltTrackFromDoc([span({ in: 5, out: 8 })], FULL, {
      rampIn: 1.6,
      rampOut: 1.4,
    })
    expect(at(tr, 5 - 1.6 - 0.01)).toEqual([0, 0])
    // Inside the stretched ramp-in window the default ramp would still rest.
    expect(at(tr, 5 - TILT_RAMP_IN - 0.01)[0]).toBeGreaterThan(0)
    expect(at(tr, 8 + 1.4 + 0.01)).toEqual([0, 0])
    // Still easing out where the default ramp would already have rested.
    expect(at(tr, 8 + TILT_RAMP_OUT + 0.01)[0]).toBeGreaterThan(0)
  })

  it("lowering feeds the doc's camera-style tilt motion into the track", () => {
    // makeDoc's footage is 3s — span at 1.8..2.9 keeps the drift ramp in range.
    const { data } = lowerToComposition({
      ...makeDoc([span({ in: 1.8, out: 2.9 })]),
      zoomStyle: 'drift',
    })
    const tr = data.tiltTrack as { keyframes: { t: number; value: number[] }[] }
    // drift's 1.6s tilt ramp: at rest 1.65s before the span, already moving
    // 0.95s before (where the default 0.9s ramp would not have started).
    expect(at(tr, 1.8 - 1.65)).toEqual([0, 0])
    expect(at(tr, 1.8 - 0.95)[0]).toBeGreaterThan(0)
  })
})

describe('tilt lowering emit', () => {
  it('emits no tiltTrack when the doc has no tilt spans (byte parity)', () => {
    expect('tiltTrack' in lowerToComposition(makeDoc()).data).toBe(false)
    expect('tiltTrack' in lowerToComposition(makeDoc([])).data).toBe(false)
  })

  it('emits a tiltTrack that rests FLAT and holds the span pose', () => {
    const { data } = lowerToComposition(makeDoc([span({ in: 1.5, out: 2.5 })]))
    const tr = data.tiltTrack as { keyframes: { t: number; value: number[] }[] }
    expect(tr.keyframes.length).toBeGreaterThan(0)
    expect(at(tr, 0)).toEqual([0, 0])
    expect(at(tr, 2)).toEqual([8, -10])
  })
})
