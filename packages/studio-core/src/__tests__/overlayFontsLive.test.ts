import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { bothFrames, lowerMerged, studioEntryOf } from './helpers/studio'
import { OVERLAY_FONT_FACES } from '../overlayText'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc, TextOverlayClip } from '../types'

/**
 * The house text faces load in SETUP only when the document already has
 * overlays. A text overlay that arrives LIVE (a live data update never
 * re-runs SETUP) must register them from ON_FRAME the first time it paints,
 * or it draws in the stack's system fallback until the next cold load.
 * Stub-context run of the compiled interpreter with a fake FontFace.
 */

const g = globalThis as Record<string, unknown>

afterEach(() => {
  delete g.window
  delete g.__vosTimeline
  delete g.FontFace
  delete g.document
})

const title: TextOverlayClip = {
  id: 'o1',
  kind: 'text',
  text: 'Hello',
  start: 1,
  duration: 2,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
  preset: 'title',
}

function makeDoc(overlays: TextOverlayClip[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [],
      meta: {
        dpr: 1,
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
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    overlays,
  }
}

/** A fake FontFace world: what got constructed, what got added to the set. */
function fakeFonts() {
  const made: string[] = []
  const added: unknown[] = []
  g.FontFace = class {
    constructor(family: string, _src: string, desc: { weight: string }) {
      made.push(`${family}|${desc.weight}`)
    }
    load() {
      return Promise.resolve()
    }
  }
  g.document = { fonts: { add: (f: unknown) => added.push(f) } }
  return { made, added }
}

function frameRunner(overlays: TextOverlayClip[]) {
  const { config, data } = lowerMerged(makeDoc(overlays))
  const onFrame = bothFrames(config)
  g.window = {
    __vos__: {
      isPaused: true,
      videoCache: new Map(),
      pendingDecodes: new Set(),
    },
  }
  g.__vosTimeline = { mapTime, sample, lerpArray }
  const c2d = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'measureText') return () => ({ width: 42 })
        if (key === 'createLinearGradient')
          return () => ({ addColorStop: () => {} })
        return () => undefined
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
  const refs = {
    bg: layer(),
    card: layer(),
    ov: layer(),
    video: {
      videoWidth: 1600,
      videoHeight: 900,
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
  return (time: number) =>
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
      { refs },
      1 / 30,
    )
}

const BASE_KEYS = OVERLAY_FONT_FACES.map((f) => `${f.family}|${f.weight}`)

describe('house faces on a live text overlay', () => {
  it('registers the base faces once, on the first frame a text overlay paints', () => {
    const { made, added } = fakeFonts()
    const frame = frameRunner([title])
    frame(1.5)
    expect(made).toEqual(BASE_KEYS)
    expect(added).toHaveLength(BASE_KEYS.length)
    frame(1.6)
    frame(2.0)
    expect(made).toEqual(BASE_KEYS) // never twice
    const set = (g.window as { __voilaFontSet: Record<string, 1> })
      .__voilaFontSet
    expect(Object.keys(set).sort()).toEqual([...BASE_KEYS].sort())
  })

  it('registers nothing while no text overlay is on screen', () => {
    const { made } = fakeFonts()
    const frame = frameRunner([title])
    frame(0.2)
    expect(made).toEqual([])
  })

  it('skips what SETUP already registered (the cold-load path marks its faces)', () => {
    const { made } = fakeFonts()
    const frame = frameRunner([title])
    ;(g.window as Record<string, unknown>).__voilaFontSet = {
      'Lexend|600': 1,
    }
    frame(1.5)
    expect(made).toEqual(BASE_KEYS.filter((k) => k !== 'Lexend|600'))
  })

  it('loads an override face beside the base set', () => {
    const { made } = fakeFonts()
    const frame = frameRunner([{ ...title, family: 'Inter', weight: 700 }])
    frame(1.5)
    expect(made).toContain('Inter|700')
    for (const k of BASE_KEYS) expect(made).toContain(k)
  })

  it('does nothing without FontFace (a server render harness, an export page before fonts)', () => {
    const frame = frameRunner([title])
    expect(() => frame(1.5)).not.toThrow()
    expect((g.window as Record<string, unknown>).__voilaFontSet).toBe(undefined)
  })

  it('SETUP marks the faces it loads under the same key', () => {
    const { config } = lowerMerged(makeDoc([title]))
    const setup = studioEntryOf(config).setup
    expect(setup).toContain('__voilaFontSet')
    expect(setup).toContain("f.family + '|' + f.weight")
  })
})
