import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { bothFrames, lowerMerged as lowerToComposition } from './helpers/studio'
import type { ProjectDoc, RecordingMeta } from '../types'

// Footage of a window is round at its own corners and opaque outside them: a
// window recorded alone is black there. The card around it is at least as
// round, or those corners show as black notches past the card's own curve.
// The radius is a fact of the footage (`meta.cornerRadius`, in the footage's
// cursor space); a take without it lowers and draws exactly as it did.

const VIDEO = { w: 656, h: 422 }

function makeDoc(
  meta: Partial<RecordingMeta> = {},
  over: Partial<ProjectDoc> = {},
): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: VIDEO.w,
        height: VIDEO.h,
        fps: 60,
        captureWidth: VIDEO.w * 2,
        captureHeight: VIDEO.h * 2,
        captureSurface: 'app',
        producer: 'desktop',
        ...meta,
      },
    },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      ...BASE_FRAME_STYLE,
      browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'none' },
    },
    export: { resolution: '1080p', fps: 60, format: 'mp4' },
    ...over,
  }
}

describe('the lowered data', () => {
  it('carries the footage radius as a fraction of its width', () => {
    const { data } = lowerToComposition(makeDoc({ cornerRadius: 13.5 }))
    expect(data.footageRadius).toBeCloseTo(13.5 / VIDEO.w, 5)
  })

  it('has no such key for footage that says nothing: the data it always was', () => {
    expect('footageRadius' in lowerToComposition(makeDoc()).data).toBe(false)
    expect(
      'footageRadius' in lowerToComposition(makeDoc({ cornerRadius: 0 })).data,
    ).toBe(false)
  })

  it('drops it when a crop has taken the corners away', () => {
    const doc = makeDoc({ cornerRadius: 13.5 })
    doc.source.crop = { x: 0, y: 40, w: VIDEO.w * 2, h: VIDEO.h * 2 - 40 }
    expect('footageRadius' in lowerToComposition(doc).data).toBe(false)
  })
})

describe('ON_FRAME rounds the card at least as much as the footage (stub)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  /** Runs one frame and returns every rounded rect the card layer drew: [x, y, w, h, radius]. */
  function cardRects(doc: ProjectDoc, canvasW = 1920, canvasH = 1080) {
    const { config, data } = lowerToComposition(doc)
    const onFrame = bothFrames(config)
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map(),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const rects: number[][] = []
    const mkC2d = (tag: string) =>
      new Proxy(
        {},
        {
          get: (_t, key: string) => {
            if (key === 'measureText') return () => ({ width: 42 })
            if (key === 'createLinearGradient')
              return () => ({ addColorStop: () => {} })
            if (key === 'roundRect')
              return (...args: number[]) => {
                if (tag === 'card') rects.push(args)
              }
            return () => {}
          },
          set: () => true,
        },
      )
    const layer = (tag: string) => ({
      c2d: mkC2d(tag),
      canvas: { width: canvasW, height: canvasH },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    const refs = {
      bg: layer('bg'),
      card: layer('card'),
      ov: layer('ov'),
      video: {
        videoWidth: VIDEO.w * 2,
        videoHeight: VIDEO.h * 2,
        readyState: 2,
        paused: true,
        currentTime: 0,
        play: () => undefined,
        pause: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      cam: null,
    }
    onFrame(
      {
        time: 1.5,
        data,
        renderer: undefined,
        resolution: {
          width: canvasW,
          height: canvasH,
          drawingBufferWidth: canvasW,
          drawingBufferHeight: canvasH,
        },
      },
      { refs },
      1 / 30,
    )
    return rects
  }

  /** The card's clip: the widest rounded rect drawn on the card layer. */
  const clip = (rects: number[][]) =>
    rects.reduce((best, r) => (r[2] > best[2] ? r : best), rects[0])

  it('a take that says nothing keeps the card radius it was given', () => {
    const rects = cardRects(makeDoc())
    expect(rects.length).toBeGreaterThan(0)
    // 1920 x 1080 canvas: s = 1, and the footage is as wide as it is tall
    // enough for cf = 1, so the radius is the frame's own.
    expect(clip(rects)[4]).toBeCloseTo(BASE_FRAME_STYLE.radius, 6)
  })

  it('a window rounder than the card raises the card to the window', () => {
    const cornerRadius = 20
    const c = clip(cardRects(makeDoc({ cornerRadius })))
    // the footage is drawn c[2] wide: its own corner is that fraction of it
    const footage = (cornerRadius / VIDEO.w) * c[2]
    expect(footage).toBeGreaterThan(BASE_FRAME_STYLE.radius)
    // the fraction is stored to five places, so the radius agrees to the hundredth
    expect(c[4]).toBeCloseTo(footage, 1)
  })

  it('a card already rounder than the window stays as it is', () => {
    const doc = makeDoc({ cornerRadius: 4 })
    doc.frame = { ...doc.frame, radius: 60 }
    expect(clip(cardRects(doc))[4]).toBeCloseTo(60, 6)
  })

  it('the floor scales with the canvas, as the footage does', () => {
    const cornerRadius = 20
    const big = clip(cardRects(makeDoc({ cornerRadius }), 1920, 1080))
    const small = clip(cardRects(makeDoc({ cornerRadius }), 960, 540))
    expect(small[4]).toBeCloseTo(big[4] / 2, 3)
    expect(small[4] / small[2]).toBeCloseTo(cornerRadius / VIDEO.w, 4)
  })

  it('every rounded rect of the card moves together: shadow, clip and border agree', () => {
    const doc = makeDoc({ cornerRadius: 20 })
    doc.frame = { ...doc.frame, shadow: 0.5 }
    const rects = cardRects(doc)
    const c = clip(rects)
    // anything drawn at the card's own size is drawn at the card's radius
    for (const r of rects.filter((x) => Math.abs(x[2] - c[2]) < 0.5)) {
      expect(r[4]).toBeCloseTo(c[4], 3)
    }
  })

  it('under cover the card crops the footage, and keeps its own radius', () => {
    const doc = makeDoc({ cornerRadius: 20 })
    doc.frame = { ...doc.frame, fit: 'cover' }
    expect(clip(cardRects(doc))[4]).toBeCloseTo(BASE_FRAME_STYLE.radius, 6)
  })
})
