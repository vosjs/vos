import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { bothFrames, lowerMerged as lowerToComposition } from './helpers/studio'
import type { FootageMatte, ProjectDoc, RecordingMeta } from '../types'

// A floating take has nothing behind its windows. Its file holds the picture
// with a matte in a strip under it (`meta.matte`), and the card draws the
// picture THROUGH the matte: no card behind it, no edge to clip to, and a
// shadow cast by the windows' own shape. Whatever draws the file without
// knowing a matte still draws only the picture, because the picture rides
// the crop every draw of footage already takes.

const PICTURE = { w: 3456, h: 2168 }
const MATTE: FootageMatte = {
  y: PICTURE.h,
  w: 1152,
  h: 723,
  bands: 3,
  bandHeight: 241,
  height: 2410,
}

function makeDoc(meta: Partial<RecordingMeta> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: PICTURE.w / 2,
        height: PICTURE.h / 2,
        fps: 60,
        captureWidth: PICTURE.w,
        captureHeight: PICTURE.h,
        captureSurface: 'desktop',
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
      shadow: 0.4,
      browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'none' },
    },
    export: { resolution: '1080p', fps: 60, format: 'mp4' },
  }
}

describe('the lowered data', () => {
  it('carries the matte, and the picture as the crop', () => {
    const { data } = lowerToComposition(makeDoc({ matte: MATTE }))
    expect(data.matte).toEqual(MATTE)
    expect(data.crop).toEqual({ x: 0, y: 0, w: PICTURE.w, h: PICTURE.h })
  })

  it('has no such key for a take without one: the data it always was', () => {
    const { data } = lowerToComposition(makeDoc())
    expect('matte' in data).toBe(false)
    expect(data.crop).toBeNull()
  })

  it('a crop of the document’s own wins: the picture is where it says', () => {
    const doc = makeDoc({ matte: MATTE })
    doc.source.crop = { x: 0, y: 40, w: PICTURE.w, h: PICTURE.h - 40 }
    const { data } = lowerToComposition(doc)
    expect('matte' in data).toBe(false)
    expect(data.crop).toEqual(doc.source.crop)
  })

  it('a matte that says nothing usable is no matte', () => {
    const { data } = lowerToComposition(makeDoc({ matte: { ...MATTE, y: 0 } }))
    expect('matte' in data).toBe(false)
    expect(data.crop).toBeNull()
  })
})

describe('ON_FRAME draws a floating take through its matte (stub)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.document
    delete g.__vosTimeline
  })

  /** Runs one frame; what the card layer drew, and what was uploaded to the unpack pass. */
  function frame(doc: ProjectDoc, opts: { gl?: boolean } = {}) {
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

    const uploads: unknown[] = []
    const uniforms: Record<string, number[]> = {}
    const made: { width: number; height: number }[] = []
    if (opts.gl) {
      const gl = new Proxy(
        {},
        {
          get: (_t, key: string) => {
            if (key === 'texImage2D')
              return (...a: unknown[]) => uploads.push(a.at(-1))
            if (key === 'getUniformLocation')
              return (_p: unknown, name: string) => name
            if (key === 'uniform2f')
              return (name: string, x: number, y: number) => {
                uniforms[name] = [x, y]
              }
            // shader and program checks pass; a constant is anything at all
            return () => true
          },
        },
      )
      g.document = {
        createElement: () => {
          const cv = {
            width: 0,
            height: 0,
            getContext: (kind: string) => (kind === 'webgl2' ? gl : null),
          }
          made.push(cv)
          return cv
        },
      }
    }

    const draws: unknown[][] = []
    const rounded: number[][] = []
    const shadows: number[] = []
    let blur = 0
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
                if (tag === 'card') rounded.push(args)
              }
            if (key === 'drawImage')
              return (...args: unknown[]) => {
                if (tag !== 'card') return
                draws.push(args)
                shadows.push(blur)
              }
            return () => {}
          },
          set: (_t, key: string, value: number) => {
            if (tag === 'card' && key === 'shadowBlur') blur = value
            return true
          },
        },
      )
    const layer = (tag: string) => ({
      c2d: mkC2d(tag),
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    const video = {
      videoWidth: PICTURE.w,
      videoHeight: MATTE.height,
      readyState: 2,
      paused: true,
      currentTime: 0,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    onFrame(
      {
        time: 1.5,
        data,
        renderer: undefined,
        resolution: {
          width: 1920,
          height: 1080,
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
        },
      },
      {
        refs: {
          bg: layer('bg'),
          card: layer('card'),
          ov: layer('ov'),
          video,
          cam: null,
        },
      },
      1 / 30,
    )
    return { draws, rounded, shadows, uploads, uniforms, made, video }
  }

  it('the file is uploaded whole and read as the take says it is laid out', () => {
    const r = frame(makeDoc({ matte: MATTE }), { gl: true })
    expect(r.uploads).toEqual([r.video])
    expect(r.uniforms.pic).toEqual([PICTURE.w, PICTURE.h])
    expect(r.uniforms.file).toEqual([PICTURE.w, MATTE.height])
    expect(r.uniforms.mat).toEqual([MATTE.w, MATTE.h])
    expect(r.uniforms.band).toEqual([MATTE.bandHeight, MATTE.bands])
    // what it is unpacked into is the picture's size
    expect(r.made[0]).toMatchObject({ width: PICTURE.w, height: PICTURE.h })
  })

  it('what the card draws is the unpacked picture, never the file', () => {
    const r = frame(makeDoc({ matte: MATTE }), { gl: true })
    expect(r.draws.length).toBeGreaterThan(0)
    for (const d of r.draws) expect(d[0]).toBe(r.made[0])
    // the last draw is the picture itself, in place and with no shadow of its own to cast
    const last = r.draws.at(-1) as number[]
    expect(last[3] / last[4]).toBeCloseTo(PICTURE.w / PICTURE.h, 2)
  })

  it('there is no card: nothing rounded is filled, clipped or stroked', () => {
    const r = frame(makeDoc({ matte: MATTE }), { gl: true })
    expect(r.rounded).toEqual([])
    // and a take with no matte still has its card
    expect(frame(makeDoc()).rounded.length).toBeGreaterThan(0)
  })

  it('the shadows are cast by the picture: one draw for each layer, off the canvas', () => {
    const r = frame(makeDoc({ matte: MATTE }), { gl: true })
    // four layers and the picture; the contact shadow is off by default
    const cast = r.draws.slice(0, -1) as number[][]
    expect(cast.length).toBe(4)
    const place = r.draws.at(-1) as number[]
    for (const d of cast) {
      // the same size as the picture, far enough left that none of it is on the canvas
      expect(d[3]).toBeCloseTo(place[3], 6)
      expect(d[1] + d[3]).toBeLessThan(0)
    }
    // each wider than the last
    const blurs = r.shadows.slice(0, 4)
    expect([...blurs].sort((a, b) => a - b)).toEqual(blurs)
    expect(blurs[0]).toBeGreaterThan(0)
  })

  it('no shadow asked, none cast', () => {
    const doc = makeDoc({ matte: MATTE })
    doc.frame = { ...doc.frame, shadow: 0 }
    expect(frame(doc, { gl: true }).draws.length).toBe(1)
  })

  it('where the picture cannot be unpacked it is drawn as it is: the picture only, on its black', () => {
    const r = frame(makeDoc({ matte: MATTE }))
    expect(r.draws.length).toBe(1)
    const d = r.draws[0] as unknown[]
    expect(d[0]).toBe(r.video)
    // the crop: the strip under the picture is never drawn
    expect(d.slice(1, 5)).toEqual([0, 0, PICTURE.w, PICTURE.h])
    expect(r.rounded).toEqual([])
  })
})
