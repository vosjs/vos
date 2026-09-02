import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { FrameStyle, ProjectDoc } from '../types'

// Background depth: parallax and blur behind the card — pure f(t) from
// data, absent = byte/pixel parity with the earlier stack. (The card's own depth effects —
// entrance, exit, float, glow — and the vignette went with the Card panel,
// decided 2026-08-03: the card's only pose is its timeline tilt.)

function makeDoc(
  over: { frame?: Partial<FrameStyle>; zoom?: ProjectDoc['zoom'] } = {},
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
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 4 }],
    zoom: over.zoom ?? [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      ...DEFAULT_FRAME_STYLE,
      browserBar: DEFAULT_BROWSER_BAR,
      ...(over.frame ?? {}),
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const g = globalThis as Record<string, unknown>
afterEach(() => {
  delete g.window
  delete g.__vosTimeline
})

describe('background depth (V2)', () => {
  it('background blur wraps the media draw in a canvas filter', () => {
    const img = { complete: true, naturalWidth: 800, naturalHeight: 800 }
    const doc = makeDoc({
      frame: {
        backgroundMedia: { kind: 'image', key: 'bg.jpg', dim: 0, blur: 8 },
      },
    })
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map([['bg.jpg', img]]),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const filterSets: unknown[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'filter') return 'none' // report support
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return () => {}
        },
        set: (_t, key: string, v: unknown) => {
          if (key === 'filter') filterSets.push(v)
          return true
        },
      },
    )
    const layer = () => ({
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    const video = {
      videoWidth: 1600,
      videoHeight: 900,
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
        time: 1,
        data,
        renderer: undefined,
        resolution: {
          width: 1920,
          height: 1080,
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
        },
      },
      { refs: { bg: layer(), card: layer(), ov: layer(), video, cam: null } },
      1 / 30,
    )
    // blur(...) applied, then reset to none.
    expect(filterSets.some((v) => String(v).startsWith('blur('))).toBe(true)
    expect(filterSets.at(-1)).toBe('none')
  })

  it('parallax pans the background draw with the zoom (clamped into slack)', () => {
    const img = { complete: true, naturalWidth: 1920, naturalHeight: 1080 }
    const zoomed = makeDoc({
      frame: {
        parallax: 1,
        backgroundMedia: { kind: 'image', key: 'bg.jpg', dim: 0 },
      },
      zoom: [{ id: 'z1', in: 0.5, out: 3.5, level: 2, cx: 0.9, cy: 0.5 }],
    })
    const { config, data } = lowerToComposition(zoomed)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map([['bg.jpg', img]]),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const draws: unknown[][] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'drawImage')
            return (...args: unknown[]) => {
              draws.push(args)
            }
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return () => {}
        },
        set: () => true,
      },
    )
    const layer = () => ({
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    const video = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      currentTime: 0,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const frameAt = (time: number) => {
      draws.length = 0
      onFrame(
        {
          time,
          data,
          renderer: undefined,
          resolution: {
            width: 1920,
            height: 1080,
            drawingBufferWidth: 1920,
            drawingBufferHeight: 1080,
          },
        },
        { refs: { bg: layer(), card: layer(), ov: layer(), video, cam: null } },
        1 / 30,
      )
      return draws.find((dr) => dr[0] === img) as number[] & { 0: unknown }
    }
    const rest = frameAt(0) // before the zoom ramps
    const mid = frameAt(2) // mid-span, level 2, cx 0.9 → pans LEFT (negative x shift)
    expect(mid[1]).toBeLessThan(rest[1] as unknown as number)
    // over-scan keeps the pan inside the frame (never reveals an edge)
    expect(mid[1] as unknown as number).toBeLessThanOrEqual(0)
  })
})
