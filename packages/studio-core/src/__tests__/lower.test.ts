import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '@vosjs/core'
import { lerpArray, resolveEase, sample } from '@vosjs/timeline'
import {
  ZOOM_EASE,
  ZOOM_RAMP_IN,
  ZOOM_RAMP_IN_OVERLAP,
  ZOOM_RAMP_OUT,
  lowerToComposition,
  spanOutputExtent,
  zoomTrackFromDoc,
} from '../lower/lowerToComposition'
import { planAutoZoom } from '../planner/autoZoom'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { CursorTrack, ProjectDoc, ZoomSpan } from '../types'

const cursor: CursorTrack = [
  { t: 0, x: 100, y: 100, type: 'move' },
  {
    t: 1000,
    x: 960,
    y: 540,
    type: 'down',
    rect: { x: 900, y: 500, w: 120, h: 80 },
  },
  { t: 2000, x: 200, y: 200, type: 'move' },
]

const doc: ProjectDoc = {
  source: {
    videoKey: 'opfs:recording-1',
    cursor,
    meta: {
      dpr: 2,
      zoom: 1,
      t0: 0,
      durationMs: 3000,
      width: 1920,
      height: 1080,
      fps: 30,
    },
  },
  segments: [{ in: 0, out: 3 }],
  zoom: planAutoZoom(cursor, { width: 1920, height: 1080 }),
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

describe('lowerToComposition', () => {
  it('produces a config that compiles via @vosjs/core (the WYSIWYG seam)', () => {
    const { config } = lowerToComposition(doc)
    expect(() => compileVosConfig(config as any)).not.toThrow()
  })

  it('threads cursor + zoom track + segments + frame through ctx.data', () => {
    const { data } = lowerToComposition(doc)
    expect((data.cursor as unknown[]).length).toBeGreaterThan(0)
    expect((data.zoomTrack as any).keyframes.length).toBeGreaterThan(0)
    expect(data.segments).toEqual([{ in: 0, out: 3 }])
    expect(data.frame).toEqual(DEFAULT_FRAME_STYLE)
  })

  it('clamps span focus so the zoomed card always covers the canvas', () => {
    const { data } = lowerToComposition({
      ...doc,
      zoom: [{ id: 'z0', in: 1, out: 2, level: 5, cx: 0, cy: 1 }],
    })
    const arrival = (data.zoomTrack as { keyframes: { value: number[] }[] })
      .keyframes[1]
    expect(arrival.value[0]).toBe(5)
    expect(arrival.value[1]).toBeGreaterThan(0) // cx pulled off the raw edge
    expect(arrival.value[2]).toBeLessThan(1) // cy likewise
  })

  it('emits a Canvas2D compositor (setup loads video, onFrame paints from ctx.data)', () => {
    const { config } = lowerToComposition(doc)
    // Compositor v2: a perspective camera so the card plane can tilt.
    expect(config.camera).toEqual({
      preset: 'perspective',
      fov: 30,
      near: 0.1,
      far: 100,
    })
    expect(String(config.setup)).toContain('ctx.data.videoSrc')
    expect(String(config.createContent)).toContain('ctx.scene')
    expect(String(config.onFrame)).toContain('frame.background')
    expect(String(config.onFrame)).toContain('drawImage')
  })

  it('is a constant interpreter: duration lives in data, program never varies', () => {
    const { config, data, duration } = lowerToComposition(doc)
    expect(duration).toBeCloseTo(3, 3)
    expect(data.duration).toBeCloseTo(3, 3)
    // the config bakes a PLACEHOLDER duration — trims must not change the program
    expect(config.duration).toBe(1)

    const trimmed = lowerToComposition({
      ...doc,
      segments: [{ in: 0.5, out: 2 }],
    })
    expect(trimmed.duration).toBeCloseTo(1.5, 3)
    const programOf = (c: Record<string, unknown>) => {
      const { data: _d, ...rest } = c
      return JSON.stringify(rest)
    }
    expect(programOf(trimmed.config)).toBe(
      programOf(lowerToComposition(doc).config),
    )
  })

  it('declares the carrier (vosCarrier) and reads duration from ctx.data', () => {
    const { config } = lowerToComposition(doc)
    expect(String(config.createTimeline)).toContain('vosCarrier: true')
    expect(String(config.createTimeline)).toContain('ctx.data.duration')
  })

  it('inlines the @vosjs/timeline runtime and drives time from ctx.time', () => {
    const { config } = lowerToComposition(doc)
    expect(String(config.setup)).toContain('__vosTimeline')
    expect(String(config.onFrame)).toContain('globalThis.__vosTimeline')
    expect(String(config.onFrame)).toContain('ctx.time')
    expect(String(config.onFrame)).toContain('mapTime(d.segments')
  })

  it('computes duration from segments when trimmed', () => {
    const trimmed: ProjectDoc = {
      ...doc,
      segments: [
        { in: 0, out: 1 },
        { in: 2, out: 2.5 },
      ],
    }
    const { duration, data } = lowerToComposition(trimmed)
    expect(duration).toBeCloseTo(1.5, 3)
    expect(data.duration).toBeCloseTo(1.5, 3)
  })

  it('falls back to full source duration when segments is empty (untrimmed)', () => {
    const { duration } = lowerToComposition({ ...doc, segments: [] })
    expect(duration).toBeCloseTo(3, 3)
  })

  it('gates the webcam bubble by the source-time cam window', () => {
    const { config, data } = lowerToComposition({
      ...doc,
      cam: { ...doc.cam, window: { in: 1, out: 2 } },
    })
    expect(String(config.onFrame)).toContain('camS.window')
    expect(String(config.onFrame)).toContain('srcT >= camS.window.in')
    expect((data.cam as { window: unknown }).window).toEqual({ in: 1, out: 2 })
  })
})

describe('spanOutputExtent', () => {
  it('maps a span through trims (rate-aware) and snaps partial cuts', () => {
    // keep 0.8..5: span [1, 2.5] sits at output [0.2, 1.7]
    const trimmed = spanOutputExtent([{ in: 0.8, out: 5 }], 1, 2.5)!
    expect(trimmed.start).toBeCloseTo(0.2, 9)
    expect(trimmed.end).toBeCloseTo(1.7, 9)
    // keep 2..5: only [2, 2.5] survives → output [0, 0.5]
    expect(spanOutputExtent([{ in: 2, out: 5 }], 1, 2.5)).toEqual({
      start: 0,
      end: 0.5,
    })
    // fully cut away → null (the span follows its footage)
    expect(spanOutputExtent([{ in: 3, out: 5 }], 1, 2.5)).toBeNull()
    // a 2× rated piece halves output positions past it
    expect(
      spanOutputExtent(
        [{ in: 0, out: 2, rate: 2 } as never, { in: 2, out: 5 }],
        3,
        4,
      ),
    ).toEqual({ start: 2, end: 3 })
  })
})

describe('zoomTrackFromDoc', () => {
  const span: ZoomSpan = {
    id: 'a',
    in: 1,
    out: 2.5,
    level: 2,
    cx: 0.6,
    cy: 0.4,
  }
  const full = [{ in: 0, out: 10 }]
  const rampStart = 1 - (ZOOM_RAMP_IN - ZOOM_RAMP_IN_OVERLAP)

  it('ramps in before the span, holds to its end, ramps out after', () => {
    const track = zoomTrackFromDoc([span], full)
    // at rest before the ramp starts
    expect(sample(track, rampStart - 0.1, lerpArray)).toEqual([1, 0.6, 0.4])
    // arrival lands ZOOM_RAMP_IN_OVERLAP into the span
    expect(sample(track, rampStart + ZOOM_RAMP_IN, lerpArray)).toEqual([
      2, 0.6, 0.4,
    ])
    expect(rampStart + ZOOM_RAMP_IN).toBeCloseTo(1 + ZOOM_RAMP_IN_OVERLAP, 6)
    // hold through the span
    expect(sample(track, 2.0, lerpArray)).toEqual([2, 0.6, 0.4])
    expect(sample(track, 2.5, lerpArray)).toEqual([2, 0.6, 0.4])
    // ramp midpoint eases with the default zoom ease
    const u = resolveEase(ZOOM_EASE)(0.5)
    expect(
      sample(track, rampStart + ZOOM_RAMP_IN / 2, lerpArray)[0],
    ).toBeCloseTo(1 + u, 9)
    // zoom-out lands back at 1×
    expect(sample(track, 2.5 + ZOOM_RAMP_OUT, lerpArray)[0]).toBe(1)
  })

  it('honors a valid span ease and falls back on an unknown one', () => {
    const eased = zoomTrackFromDoc([{ ...span, ease: 'sine.inOut' }], full)
    expect(eased.keyframes[1].ease).toBe('sine.inOut')
    const bogus = zoomTrackFromDoc([{ ...span, ease: 'bogus' }], full)
    expect(bogus.keyframes[1].ease).toBe(ZOOM_EASE)
  })

  it('follows footage through trims (extent remaps, ramp clamps at 0)', () => {
    // keep 2..10: only [2, 2.5] survives → clip at output [0, 0.5]; the ramp
    // start clamps to 0 and the arrival stays one full ramp later.
    const track = zoomTrackFromDoc([span], [{ in: 2, out: 10 }])
    expect(track.keyframes[0].t).toBe(0)
    expect(sample(track, ZOOM_RAMP_IN, lerpArray)[0]).toBe(2)
    // fully cut away → no keyframes at all
    expect(zoomTrackFromDoc([span], [{ in: 3, out: 10 }]).keyframes).toEqual([])
  })

  it('pans straight between connected spans (gap ≤ ZOOM_CHAIN_GAP)', () => {
    const b: ZoomSpan = {
      id: 'b',
      in: 3.5,
      out: 4.5,
      level: 3,
      cx: 0.8,
      cy: 0.7,
    }
    const track = zoomTrackFromDoc([span, b], full) // gap 3.5 − 2.5 = 1 ≤ ZOOM_CHAIN_GAP
    // never returns to rest between the spans…
    for (const t of [2.6, 2.9, 3.2, 3.5]) {
      expect(sample(track, t, lerpArray)[0]).toBeGreaterThan(1.9)
    }
    // …and the next state is fully held from the pan arrival (which lands
    // rampInOverlap into span b) through span b's end
    expect(sample(track, 3.5 + ZOOM_RAMP_IN_OVERLAP, lerpArray)).toEqual([
      3, 0.8, 0.7,
    ])
    expect(sample(track, 4.5, lerpArray)).toEqual([3, 0.8, 0.7])
    // mid-pan interpolates between the two states
    const mid = sample(track, 2.9, lerpArray)
    expect(mid[0]).toBeGreaterThan(2)
    expect(mid[0]).toBeLessThan(3)
    // final zoom-out still happens after the last span
    expect(sample(track, 4.5 + ZOOM_RAMP_OUT, lerpArray)[0]).toBe(1)
  })

  it('zooms out between distant spans (gap > ZOOM_CHAIN_GAP)', () => {
    const b: ZoomSpan = { id: 'b', in: 6, out: 7, level: 3, cx: 0.8, cy: 0.7 }
    const track = zoomTrackFromDoc([span, b], full) // gap 3.5 > 1.5
    expect(sample(track, 4.5, lerpArray)[0]).toBe(1) // back at rest mid-gap
    expect(sample(track, 6 + ZOOM_RAMP_IN_OVERLAP, lerpArray)[0]).toBe(3)
  })

  it('emits strictly increasing keyframe times even for adjacent spans', () => {
    const dense: ZoomSpan[] = [
      { id: 'a', in: 1, out: 1.5, level: 2, cx: 0.5, cy: 0.5 },
      { id: 'b', in: 1.5, out: 2.0, level: 1.5, cx: 0.4, cy: 0.4 },
      { id: 'c', in: 2.0, out: 2.4, level: 3, cx: 0.6, cy: 0.6 },
    ]
    const track = zoomTrackFromDoc(dense, full)
    const ts = track.keyframes.map((k) => k.t)
    expect([...ts].sort((x, y) => x - y)).toEqual(ts) // sorted (sample precondition)
    expect(new Set(ts).size).toBe(ts.length) // no coincident collisions
  })

  it('is empty for an empty zoom list', () => {
    expect(zoomTrackFromDoc([], full).keyframes).toEqual([])
  })
})
