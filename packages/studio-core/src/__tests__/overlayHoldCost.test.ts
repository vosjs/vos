import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { bothFrames, lowerMerged } from './helpers/studio'
import type { OverlayClip, ProjectDoc, TextOverlayClip } from '../types'

/**
 * What a text layer costs per frame, counted on the overlay canvas: texture
 * uploads, `measureText` calls and `fillText` calls.
 *
 * These are the numbers AS THEY ARE, pinned so a change to them is a
 * decision: while any overlay is visible the layer repaints and uploads
 * every frame, held or not, and wrap and per-unit placement measure again
 * inside each of those frames. A layout cache and real dirty tracking
 * should take a hold to no upload and no measure; when they land, these
 * expectations change with them.
 */

function clip(over: Partial<TextOverlayClip> = {}): TextOverlayClip {
  return {
    id: 'o1',
    kind: 'text',
    start: 0.5,
    duration: 3,
    text: 'Hello',
    preset: 'caption',
    transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
    ...over,
  }
}

function makeDoc(overlays: OverlayClip[]): ProjectDoc {
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
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    overlays,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

interface FrameCost {
  uploaded: boolean
  measures: number
  fills: number
}

describe('what a text layer costs per frame', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  /** One set of refs driven across frames, so dirty state carries. */
  function makeRunner(overlays: OverlayClip[]) {
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
    const count = { measures: 0, fills: 0 }
    const mk = (tag: string) =>
      new Proxy(
        {},
        {
          get: (_t, key: string) => {
            if (key === 'measureText')
              return (text: string) => {
                if (tag === 'ov') count.measures++
                return { width: text.length * 10 }
              }
            if (key === 'createLinearGradient')
              return () => ({ addColorStop: () => {} })
            if (key === 'fillText')
              return () => {
                if (tag === 'ov') count.fills++
              }
            return () => undefined
          },
          set: () => true,
        },
      )
    const layer = (tag: string) => ({
      c2d: mk(tag),
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    const refs = {
      bg: layer('bg'),
      card: layer('card'),
      ov: layer('ov'),
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
    return (time: number): FrameCost => {
      refs.ov.texture.needsUpdate = false
      count.measures = 0
      count.fills = 0
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
      return {
        uploaded: refs.ov.texture.needsUpdate,
        measures: count.measures,
        fills: count.fills,
      }
    }
  }

  // The clip runs 0.5..3.5 s; its entrance and exit windows are 0.35 s, so
  // 1.5..2.5 s is a hold: nothing on the layer changes between these frames.
  const HOLD = [1.5, 1.6, 1.7, 1.8]

  it('a held caption', () => {
    const frame = makeRunner([clip({ text: 'Ship it faster' })])
    const costs = HOLD.map(frame)
    for (const c of costs)
      expect(c).toEqual({ uploaded: true, measures: 0, fills: 1 })
  })

  it('a held wrapped caption with emphasis', () => {
    const frame = makeRunner([
      clip({
        text: 'Set up *different purposes* for every page of the product you ship',
        emphasis: {},
        maxWidth: 0.2,
      }),
    ])
    const costs = HOLD.map(frame)
    for (const c of costs) {
      expect(c.uploaded).toBe(true)
      // Wrap re-measures a growing string per token, run by run.
      expect(c.measures).toBe(46)
    }
  })

  it('a per-word entrance, mid-animation', () => {
    const frame = makeRunner([
      clip({
        text: 'Set up different purposes for every page',
        anim: { enter: { kind: 'rise', unit: 'word' } },
      }),
    ])
    const costs = [0.55, 0.6, 0.65, 0.7].map(frame)
    for (const c of costs) expect(c.measures).toBe(8)
    // Settled, the entrance is over and the words still place by measuring.
    for (const c of HOLD.map(frame))
      expect(c).toEqual({ uploaded: true, measures: 8, fills: 7 })
  })
})
