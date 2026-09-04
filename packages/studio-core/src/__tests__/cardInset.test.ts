import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { computeCardLayout } from '../layout'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { FrameStyle, ProjectDoc } from '../types'

/**
 * frame.inset: per-side card placement as fractions of the frame, a
 * negative side bleeding the card past the edge. Two contracts pinned:
 * the host mirror (computeCardLayout) and ON_FRAME agree rect for rect,
 * and a frame with NO inset lays out exactly as before the field existed.
 * The contact shadow is a second fill under the card, absent by default.
 */

const VIDEO = { width: 1600, height: 900 }

function makeDoc(frame: FrameStyle): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 3000,
        width: VIDEO.width,
        height: VIDEO.height,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const g = globalThis as Record<string, unknown>

function runFrame(
  frame: FrameStyle,
  W: number,
  H: number,
): { clips: number[][]; draws: number[][]; shadowFills: number } {
  const { config, data } = lowerToComposition(makeDoc(frame))
  const onFrame = new Function(`return (${config.onFrame as string})`)() as (
    ctx: unknown,
    content: unknown,
    dt: number,
  ) => void
  g.window = { __vos__: { isPaused: true } }
  g.__vosTimeline = { mapTime, sample, lerpArray }
  const clips: number[][] = []
  const draws: number[][] = []
  let shadowFills = 0
  let lastRounded: number[] | null = null
  let shadowSet = false
  const c2d = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'measureText') return () => ({ width: 42 })
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop: () => {} })
        return (...args: unknown[]) => {
          if (key === 'roundRect' || key === 'rect')
            lastRounded = args.slice(0, 4) as number[]
          if (key === 'clip' && lastRounded) clips.push(lastRounded)
          if (key === 'fill' && shadowSet) shadowFills++
          if (key === 'restore') shadowSet = false
          if (key === 'drawImage' && args.length >= 5)
            draws.push(args.slice(-4) as number[])
        }
      },
      set: (_t, key: string, value: unknown) => {
        if (key === 'shadowColor' && typeof value === 'string') shadowSet = true
        return true
      },
    },
  )
  const video = {
    videoWidth: VIDEO.width,
    videoHeight: VIDEO.height,
    readyState: 2,
    paused: true,
    currentTime: 0.5,
    duration: 3,
    play: () => undefined,
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const ctx = {
    time: 0.5,
    data,
    renderer: undefined,
    resolution: { width: W, height: H, drawingBufferWidth: W, drawingBufferHeight: H },
  }
  const content = {
    refs: {
      c2d,
      canvas: { width: W, height: H },
      texture: { needsUpdate: false, dispose: () => undefined },
      video,
      cam: null,
    },
  }
  onFrame(ctx, content, 1 / 30)
  return { clips, draws, shadowFills }
}

afterEach(() => {
  delete g.window
  delete g.__vosTimeline
})

const near = (a: number[], b: number[]) => {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3))
}

describe('frame.inset', () => {
  it('no inset lays out exactly as the symmetric padding did', () => {
    const frame = { ...DEFAULT_FRAME_STYLE, padding: 48, browserBar: DEFAULT_BROWSER_BAR }
    const l = computeCardLayout(frame, VIDEO, 1920, 1080)
    expect(l.dx).toBeCloseTo((1920 - l.dw) / 2, 6)
    expect(l.dy).toBeCloseTo((1080 - l.dh) / 2, 6)
    // 16:9 in 16:9 with a bar-less card: the height binds (984 of 900).
    expect(l.cardH).toBeCloseTo(1080 - 96, 6)
    expect(l.cardW).toBe(l.dw)
  })

  it('contain: the card centres inside the inset area and bleeds off a negative side', () => {
    const frame: FrameStyle = {
      ...DEFAULT_FRAME_STYLE,
      padding: 48,
      browserBar: DEFAULT_BROWSER_BAR,
      inset: { left: 0.08, right: 0.08, top: 0.16, bottom: -0.34 },
    }
    const W = 1400
    const H = 560
    const l = computeCardLayout(frame, VIDEO, W, H)
    // Contain fits the card inside the inset area: within a pixel of the
    // 84% column (the height binds by a hair at this aspect).
    expect(Math.abs(l.cardX - 0.08 * W)).toBeLessThan(1)
    expect(Math.abs(l.cardW - 0.84 * W)).toBeLessThan(2)
    expect(l.cardY).toBeCloseTo(0.16 * H, 6)
    // 16:9 at 84% of 1400 = 661.5 tall: runs past the 560 frame.
    expect(l.cardY + l.cardH).toBeGreaterThan(H)
    const r = runFrame(frame, W, H)
    expect(r.clips.length).toBeGreaterThan(0)
    near(r.clips[0], [l.cardX, l.cardY, l.cardW, l.cardH])
    near(r.draws[0], [l.dx, l.dy, l.dw, l.dh])
  })

  it('cover: the inset area is the card', () => {
    const frame: FrameStyle = {
      ...DEFAULT_FRAME_STYLE,
      fit: 'cover',
      padding: 0,
      browserBar: DEFAULT_BROWSER_BAR,
      inset: { left: 0.1, right: 0.1, top: 0.2, bottom: 0 },
    }
    const l = computeCardLayout(frame, VIDEO, 1000, 500)
    near([l.cardX, l.cardY, l.cardW, l.cardH], [100, 100, 800, 400])
    const r = runFrame(frame, 1000, 500)
    near(r.clips[0], [100, 100, 800, 400])
    near(r.draws[0], [l.dx, l.dy, l.dw, l.dh])
  })

  it('a partial inset keeps padding on the sides it does not name', () => {
    const frame: FrameStyle = {
      ...DEFAULT_FRAME_STYLE,
      padding: 108, // 108 design px at H=1080 = 108 comp px
      browserBar: DEFAULT_BROWSER_BAR,
      inset: { top: 0.3 },
    }
    const l = computeCardLayout(frame, VIDEO, 1920, 1080)
    expect(l.cardX).toBeGreaterThanOrEqual(108 - 0.001)
    expect(l.cardY).toBeGreaterThanOrEqual(0.3 * 1080 - 0.001)
    const r = runFrame(frame, 1920, 1080)
    near(r.clips[0], [l.cardX, l.cardY, l.cardW, l.cardH])
  })
})

describe('the contact shadow', () => {
  it('is a second shadowed fill, drawn only when the field says so', () => {
    const base = { ...DEFAULT_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR }
    expect(runFrame(base, 1920, 1080).shadowFills).toBe(1)
    expect(runFrame({ ...base, shadowContact: 0.2 }, 1920, 1080).shadowFills).toBe(2)
    expect(runFrame({ ...base, shadow: 0, shadowContact: 0.2 }, 1920, 1080).shadowFills).toBe(1)
  })
})
