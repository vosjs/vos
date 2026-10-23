import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { studioEntryOf } from './helpers/studio'
import type { ProjectDoc, TextOverlayClip } from '../types'

/**
 * A text layer's box arrives with its words. A per-unit entrance paints
 * its words one by one while the clip itself stands at full strength, so a
 * box drawn at the clip's alpha stood on screen EMPTY until the first word
 * resolved. The box follows the earliest unit instead: same delay, same
 * seconds, same ease.
 */

const START = 0.5

function clip(over: Partial<TextOverlayClip> = {}): TextOverlayClip {
  return {
    id: 'c1',
    kind: 'text',
    start: START,
    duration: 3,
    text: 'Arrows stay attached',
    preset: 'caption',
    transform: { x: 0.5, y: 0.9, scale: 1, rotation: 0 },
    box: { color: '#111111' },
    ...over,
  }
}

function makeDoc(c: TextOverlayClip): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    overlays: [c],
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('a text layer’s box arrives with its words', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  /** The box's alpha at an output time: the canvas alpha its fill is made at. */
  function boxAlphaAt(c: TextOverlayClip, time: number): number {
    const lowered = lowerToComposition(makeDoc(c))
    const onFrame = new Function(
      `"use strict"; return (${studioEntryOf(lowered.config).onFrame})`,
    )() as (ctx: unknown, content: unknown, dt: number) => void
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map(),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    let alpha = 1
    const fills: number[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText')
            return (text: string) => ({ width: text.length * 10 })
          if (key === 'fill') return () => fills.push(alpha)
          return () => undefined
        },
        set: (_t, key: string, value: unknown) => {
          if (key === 'globalAlpha') alpha = value as number
          return true
        },
      },
    )
    onFrame(
      {
        time,
        data: lowered.stack[STUDIO_ENTRY_ID],
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
          ov: {
            c2d,
            canvas: { width: 1920, height: 1080 },
            texture: { needsUpdate: false, dispose: () => undefined },
            mesh: null,
          },
          objects: null,
        },
      },
      1 / 30,
    )
    // The pill is the layer's one path fill (words are fillText, marks fillRect).
    expect(fills.length).toBeLessThanOrEqual(1)
    return fills.length ? fills[0] : 0
  }

  const cubicOut = (u: number) => 1 - Math.pow(1 - u, 3)

  it('a word-by-word entrance brings the box in with its first word', () => {
    const c = clip({
      anim: {
        enter: { kind: 'blur', unit: 'word', stagger: 0.07, seconds: 0.55 },
      },
    })
    // The first frame of the clip: no word is visible, so neither is the box.
    expect(boxAlphaAt(c, START + 0.01)).toBeCloseTo(cubicOut(0.01 / 0.55), 6)
    expect(boxAlphaAt(c, START + 0.01)).toBeLessThan(0.1)
    // Partway: the box stands exactly where the first word stands.
    expect(boxAlphaAt(c, START + 0.2)).toBeCloseTo(cubicOut(0.2 / 0.55), 6)
    // Once the first word has landed the box is whole, while later words are
    // still arriving.
    expect(boxAlphaAt(c, START + 0.6)).toBeCloseTo(1, 6)
  })

  it('a pop follows the pop’s own alpha', () => {
    const c = clip({ anim: { enter: { kind: 'pop', unit: 'word' } } })
    const at = boxAlphaAt(c, START + 0.05)
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(1)
  })

  it('a centred entrance over an even count follows its two first words', () => {
    // Four words from the centre: the middle two start half a stagger in.
    const c = clip({
      text: 'Arrows stay attached too',
      anim: {
        enter: {
          kind: 'rise',
          unit: 'word',
          direction: 'center',
          stagger: 0.2,
          seconds: 0.5,
        },
      },
    })
    expect(boxAlphaAt(c, START + 0.05)).toBe(0)
    expect(boxAlphaAt(c, START + 0.3)).toBeCloseTo(cubicOut(0.2 / 0.5), 6)
  })

  it('a typewriter’s field is there before its first letter', () => {
    const c = clip({ anim: { enter: { kind: 'typewriter', unit: 'char' } } })
    expect(boxAlphaAt(c, START + 0.01)).toBe(1)
  })

  it('a block entrance keeps fading the box with the block', () => {
    // No per-unit step: the box rides the clip's own transition, as before.
    const c = clip({ anim: { enter: 'rise' } })
    expect(boxAlphaAt(c, START + 0.05)).toBeCloseTo(cubicOut(0.05 / 0.35), 6)
    expect(boxAlphaAt(c, START + 1.5)).toBe(1)
  })
})
