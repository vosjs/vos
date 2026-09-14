import { describe, expect, it } from 'vitest'
import { lerpArray, sample } from '@vosjs/timeline'
import { migrateHostedDoc, migrateZoomStyle } from '../docVersion'
import {
  RAMP_FLOOR,
  tiltTrackFromDoc,
  zoomTrackFromDoc,
} from '../lower/lowerToComposition'
import {
  DEFAULT_ZOOM_STYLE,
  RETIRED_ZOOM_STYLES,
  ZOOM_STYLES,
  ZOOM_STYLE_OPTIONS,
  liveZoomStyleName,
  pumpFreeChainGap,
  resolveZoomStyle,
} from '../zoomStyle'
import type { Keyframe, KeyframeTrack, Segment } from '@vosjs/timeline'
import type { TiltSpan, ZoomSpan } from '../types'

/**
 * The camera styles as one table under two structural rules (the CS track):
 * no style pumps (chain gap above its pump-free floor) and no ramp is ever
 * compressed into a cut (a ramp longer than its span fits the room, never
 * below RAMP_FLOOR). Plus the retired names' door: resolve at runtime,
 * rewrite on read.
 */

const FULL: Segment[] = [{ in: 0, out: 60 }]

function zspan(p: Partial<ZoomSpan> & { in: number; out: number }): ZoomSpan {
  return { id: 'z', level: 1.8, cx: 0.5, cy: 0.5, ...p }
}

/** Consecutive keyframes whose VALUES differ: the moves. */
function moves(
  track: KeyframeTrack<number[]>,
): [Keyframe<number[]>, Keyframe<number[]>][] {
  const out: [Keyframe<number[]>, Keyframe<number[]>][] = []
  const k = track.keyframes
  for (let i = 1; i < k.length; i++) {
    const a = k[i - 1]
    const b = k[i]
    if (a.value.some((v, j) => Math.abs(v - b.value[j]) > 1e-6))
      out.push([a, b])
  }
  return out
}

describe('the style table', () => {
  it('names six styles, the picker lists them all, glide is the default', () => {
    expect(Object.keys(ZOOM_STYLES)).toEqual([
      'glide',
      'focus',
      'cinema',
      'snappy',
      'cut',
      'none',
    ])
    expect(ZOOM_STYLE_OPTIONS.map((o) => o.name)).toEqual(
      Object.keys(ZOOM_STYLES),
    )
    expect(DEFAULT_ZOOM_STYLE).toBe('glide')
  })

  it('every style clears its pump-free chain gap floor', () => {
    for (const [name, p] of Object.entries(ZOOM_STYLES)) {
      expect(p.chainGap, name).toBeGreaterThanOrEqual(pumpFreeChainGap(p))
    }
  })

  it('every style keeps the level ceilings inside the reference field (≤ 2.2)', () => {
    for (const [name, p] of Object.entries(ZOOM_STYLES)) {
      expect(p.maxLevel, name).toBeLessThanOrEqual(2.2)
      expect(p.minLevel, name).toBeGreaterThanOrEqual(1.3)
      expect(p.dragLevel, name).toBeCloseTo(p.minLevel + 0.2, 6)
      expect(p.typingMinLevel, name).toBeCloseTo(p.minLevel + 0.1, 6)
      expect(p.minClusterClicks, name).toBe(1)
    }
  })

  it('a lone click moves for at most half its beat in every gliding style', () => {
    for (const [name, p] of Object.entries(ZOOM_STYLES)) {
      if (!p.autoZoom) continue
      const moving = p.rampIn + p.rampOut
      const resting = p.lead + p.hold - p.rampInOverlap
      expect(moving / (moving + resting), name).toBeLessThanOrEqual(0.5)
    }
  })

  it('none is the default camera with the planner off, never a frozen copy', () => {
    const { autoZoom: _a, ...noneCamera } = ZOOM_STYLES.none
    const { autoZoom: _b, ...glideCamera } = ZOOM_STYLES.glide
    expect(noneCamera).toEqual(glideCamera)
    expect(ZOOM_STYLES.none.autoZoom).toBe(false)
  })
})

describe('resolveZoomStyle', () => {
  it('raises a chain gap override that sits under the pump-free floor', () => {
    const p = resolveZoomStyle('focus', { chainGap: 0.5 })
    expect(p.chainGap).toBeCloseTo(pumpFreeChainGap(p), 6)
    // …and keeps one that clears it.
    expect(resolveZoomStyle('focus', { chainGap: 5 }).chainGap).toBe(5)
  })

  it('re-derives the floor from overridden ramps', () => {
    const p = resolveZoomStyle('glide', { rampIn: 2.5, rampOut: 2.5 })
    expect(p.chainGap).toBeCloseTo(2.5 + 2.5 - p.rampInOverlap + 1.0, 6)
  })

  it('resolves a retired name to its live style, an unknown one to the default', () => {
    expect(resolveZoomStyle('keynote')).toEqual(resolveZoomStyle('glide'))
    expect(resolveZoomStyle('drift')).toEqual(resolveZoomStyle('cinema'))
    expect(resolveZoomStyle('made-up')).toEqual(resolveZoomStyle('glide'))
    expect(liveZoomStyleName('keynote')).toBe('glide')
    expect(liveZoomStyleName('drift')).toBe('cinema')
    expect(liveZoomStyleName('cut')).toBe('cut')
    expect(liveZoomStyleName('made-up')).toBeNull()
    expect(liveZoomStyleName(undefined)).toBeNull()
  })
})

describe('ramps fit the room (RAMP_FLOOR)', () => {
  it('a span shorter than its ramps lowers to eased ramps, never a 1 ms pair', () => {
    // A one-second dwell at t = 0.4 under cinema (1.2 s in, 1.0 s out): the
    // ramp-in wanted to start at −0.4; it starts at 0, keeps its full 1.2 s
    // (the span has the room) and lands inside the span, never past it.
    const tr = zoomTrackFromDoc(
      [zspan({ in: 0.4, out: 1.4 })],
      FULL,
      ZOOM_STYLES.cinema,
    )
    for (const [a, b] of moves(tr)) {
      expect(b.t - a.t).toBeGreaterThanOrEqual(RAMP_FLOOR - 1e-6)
    }
    const arrival = tr.keyframes.find((k) => k.value[0] > 1)!
    expect(arrival.t).toBeCloseTo(1.2, 3)
    // No room for the full ramp: it lands at the span's end instead of
    // past it (the old 1 ms collapse of the hold and the exit).
    const tight = zoomTrackFromDoc(
      [zspan({ in: 0.36, out: 1.0 })],
      FULL,
      ZOOM_STYLES.cinema,
    )
    expect(tight.keyframes.find((k) => k.value[0] > 1)!.t).toBeCloseTo(1.0, 3)
    for (const [a, b] of moves(tight)) {
      expect(b.t - a.t).toBeGreaterThanOrEqual(RAMP_FLOOR - 1e-6)
    }
  })

  it('two short spans chained under long ramps never jump', () => {
    // ray.so's opening under cinema: d0 0.36..1.70 chained into d1 2.59..3.93.
    const tr = zoomTrackFromDoc(
      [
        zspan({ in: 0.36, out: 1.702, cx: 0.07, cy: 0.08, level: 2 }),
        zspan({
          id: 'd1',
          in: 2.587,
          out: 3.929,
          cx: 0.47,
          cy: 0.47,
          level: 2,
        }),
      ],
      FULL,
      { ...ZOOM_STYLES.cinema, rampIn: 1.8, rampOut: 1.5, chainGap: 2.2 },
    )
    for (const [a, b] of moves(tr)) {
      expect(b.t - a.t).toBeGreaterThanOrEqual(RAMP_FLOOR - 1e-6)
    }
    // Sampled, the window's centre never crosses more than a tenth of the
    // frame in one 60 fps frame.
    let prev = sample(tr, 0, lerpArray)
    for (let t = 1 / 60; t < 5; t += 1 / 60) {
      const v = sample(tr, t, lerpArray)
      expect(Math.hypot(v[1] - prev[1], v[2] - prev[2])).toBeLessThan(0.1)
      prev = v
    }
  })

  it('a span with room lowers byte-identically to the design landing', () => {
    const style = ZOOM_STYLES.cinema
    const tr = zoomTrackFromDoc([zspan({ in: 10, out: 14 })], FULL, style)
    const [rest, arrival] = tr.keyframes
    expect(rest.t).toBeCloseTo(10 - (style.rampIn - style.rampInOverlap), 3)
    expect(arrival.t).toBeCloseTo(rest.t + style.rampIn, 3)
    expect(arrival.t).toBeCloseTo(10 + style.rampInOverlap, 3)
  })

  it('the tilt track fits its ramps the same way', () => {
    const span: TiltSpan = { id: 't', in: 0.3, out: 1.5, rx: 8, ry: -8 }
    const tr = tiltTrackFromDoc([span], FULL, ZOOM_STYLES.cinema.tilt)
    for (const [a, b] of moves(tr)) {
      expect(b.t - a.t).toBeGreaterThanOrEqual(RAMP_FLOOR - 1e-6)
    }
    // From t = 0 the full 1.2 s ramp fits the span (0.3..1.5), so it keeps
    // it; it never lands before the span's start (the designed landing).
    const pose = tr.keyframes.find((k) => k.value[0] !== 0)!
    expect(pose.t).toBeCloseTo(1.2, 3)
    const tight = tiltTrackFromDoc(
      [{ ...span, out: 0.9 }],
      FULL,
      ZOOM_STYLES.cinema.tilt,
    )
    expect(tight.keyframes.find((k) => k.value[0] !== 0)!.t).toBeCloseTo(0.9, 3)
  })
})

describe('retired names on read', () => {
  it('rewrites keynote and drift onto their pair, keeping an explicit tiltStyle', () => {
    expect(migrateZoomStyle({ zoomStyle: 'keynote' })).toEqual({
      zoomStyle: 'glide',
      tiltStyle: 'medium',
    })
    expect(migrateZoomStyle({ zoomStyle: 'drift', tiltStyle: 'off' })).toEqual({
      zoomStyle: 'cinema',
      tiltStyle: 'off',
    })
    const live = { zoomStyle: 'cut', zoom: [] }
    expect(migrateZoomStyle(live)).toBe(live)
    expect(migrateZoomStyle({})).toEqual({})
    expect(Object.keys(RETIRED_ZOOM_STYLES)).toEqual(['keynote', 'drift'])
  })

  it('migrateHostedDoc runs the rewrite for a v4 document and stamps v5', () => {
    const v4 = {
      docSchemaVersion: 4,
      source: { videoKey: 'k', cursor: [], meta: {} },
      segments: [{ in: 0, out: 5 }],
      zoom: [],
      zoomStyle: 'drift',
    }
    const out = migrateHostedDoc(v4)
    expect(out.docSchemaVersion).toBe(5)
    expect(out.zoomStyle).toBe('cinema')
    expect(out.tiltStyle).toBe('subtle')
    expect(out.zoom).toEqual([]) // never re-planned
  })
})
