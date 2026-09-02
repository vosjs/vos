import { describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

/**
 * The CSS fill behind everything (`frame.background`).
 *
 * Canvas cannot take a gradient STRING: assigning one to `fillStyle` is a
 * silent no-op, so an unhandled notation leaves whatever colour the previous
 * draw left behind — the screen shows a flat colour the document never named
 * and nothing explains. That is exactly what a radial backdrop did once the
 * picker could make one, so both gradient kinds are built here as real canvas
 * gradients, and anything unreadable lands on a known ground.
 */

function makeDoc(background: string): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: 1280,
        height: 720,
        fps: 30,
        hasAudio: false,
      },
    },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      ...DEFAULT_FRAME_STYLE,
      browserBar: DEFAULT_BROWSER_BAR,
      background,
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  } as unknown as ProjectDoc
}

/** Run ON_FRAME once and report what the background layer was filled with. */
function fillFor(background: string): {
  kinds: string[]
  strings: string[]
} {
  const { config, data } = lowerToComposition(makeDoc(background))
  const onFrame = new Function(`return (${config.onFrame as string})`)() as (
    ctx: unknown,
    content: unknown,
    dt: number,
  ) => void

  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    __vos__: {
      isPaused: true,
      videoCache: new Map(),
      pendingDecodes: new Set(),
    },
  }
  g.__vosTimeline = { mapTime, sample, lerpArray }

  const kinds: string[] = []
  const strings: string[] = []
  const c2d = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'measureText') return () => ({ width: 42 })
        if (key === 'createLinearGradient')
          return () => ({ __kind: 'linear', addColorStop: () => {} })
        if (key === 'createRadialGradient')
          return () => ({ __kind: 'radial', addColorStop: () => {} })
        return () => undefined
      },
      set: (_t, key: string, v: unknown) => {
        if (key !== 'fillStyle') return true
        if (typeof v === 'string') {
          kinds.push('string')
          strings.push(v)
        } else kinds.push((v as { __kind?: string }).__kind ?? 'object')
        return true
      },
    },
  )
  const ctx = {
    time: 0.5,
    data,
    resolution: {
      width: 1920,
      height: 1080,
      drawingBufferWidth: 1920,
      drawingBufferHeight: 1080,
    },
  }
  const content = {
    refs: {
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      video: {
        videoWidth: 1280,
        videoHeight: 720,
        readyState: 2,
        paused: true,
        currentTime: 0.5,
        duration: 4,
        play: () => undefined,
        pause: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      cam: null,
    },
  }
  onFrame(ctx, content, 1 / 30)
  return { kinds, strings }
}

describe('background fill', () => {
  it('paints a solid as the colour itself', () => {
    const { strings } = fillFor('#123456')
    expect(strings).toContain('#123456')
  })

  it('builds a linear gradient rather than handing canvas the string', () => {
    const { kinds, strings } = fillFor(
      'linear-gradient(135deg, #ff5148, #ffb03a)',
    )
    expect(kinds).toContain('linear')
    expect(strings).not.toContain('linear-gradient(135deg, #ff5148, #ffb03a)')
  })

  it('builds a RADIAL gradient too — the regression that made the canvas keep a stale colour', () => {
    const { kinds, strings } = fillFor(
      'radial-gradient(circle at 50% 50%, #312e81, #1f96cc)',
    )
    expect(kinds).toContain('radial')
    expect(strings).not.toContain(
      'radial-gradient(circle at 50% 50%, #312e81, #1f96cc)',
    )
  })

  it('reads a radial gradient that names no position', () => {
    const { kinds } = fillFor('radial-gradient(#fff, #000)')
    expect(kinds).toContain('radial')
  })

  it('sets a known ground first, so an unpaintable value cannot inherit the last frame', () => {
    // A notation canvas will reject: the assignment is a no-op, and without a
    // ground beneath it the layer keeps whatever was there before.
    const { strings } = fillFor('conic-gradient(#fff, #000)')
    expect(strings[0]).toBe('#0b0b0c')
  })
})
