import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { computeCardLayout } from '../layout'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { bothFrames, lowerMerged as lowerToComposition } from './helpers/studio'
import type { OverlayClip, ProjectDoc } from '../types'

// The aspect-ratio scaling contract (the "9:16 giant browser bar / vanished
// title" bugs): card-owned chrome scales with the CARD via
// cf = min(1, frameAspect / videoAspect) — exactly 1 at native (nothing
// changes), proportional when the frame is narrower than the footage — and
// overlay positions are FRACTIONS of the frame, so they stay at the same
// relative spot at any aspect. Pins ON_FRAME and the computeCardLayout mirror
// to each other.

function makeDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
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
    frame: {
      ...DEFAULT_FRAME_STYLE,
      browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'mac-light', url: '' },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

describe('card-chrome scale cf (computeCardLayout mirror)', () => {
  const video = { width: 1600, height: 900 } // 16:9 footage
  const frame = {
    ...DEFAULT_FRAME_STYLE,
    browserBar: { ...DEFAULT_BROWSER_BAR, kind: 'mac-light' as const },
  }

  it('native aspect: cf = 1, bar height unchanged (44·s)', () => {
    const l = computeCardLayout(frame, video, 1920, 1080)
    // barH = dy - cardY
    expect(l.dy - l.cardY).toBeCloseTo(44, 6)
  })

  it('9:16 frame on 16:9 footage: bar shrinks by frameAspect/videoAspect', () => {
    const l = computeCardLayout(frame, video, 608, 1080)
    const cf = 608 / 1080 / (1600 / 900)
    expect(l.dy - l.cardY).toBeCloseTo(44 * cf, 6)
    // Chrome proportion vs the card stays ≈ native: bar/videoHeight within 10%.
    const native = computeCardLayout(frame, video, 1920, 1080)
    const ratioNative = (native.dy - native.cardY) / native.dh
    const ratioTall = (l.dy - l.cardY) / l.dh
    expect(Math.abs(ratioTall - ratioNative) / ratioNative).toBeLessThan(0.1)
  })

  it('frame WIDER than footage: cf stays 1 (card is height-limited, bar right already)', () => {
    const l = computeCardLayout(frame, { width: 900, height: 1600 }, 1920, 1080)
    expect(l.dy - l.cardY).toBeCloseTo(44, 6)
  })
})

describe('ON_FRAME chrome + overlays at a narrow aspect (stub)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function runFrame(
    canvasW: number,
    canvasH: number,
    overlays?: OverlayClip[],
  ) {
    const { config, data } = lowerToComposition(
      makeDoc(overlays ? { overlays } : {}),
    )
    const onFrame = bothFrames(config)
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map(),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const fills: { tag: string; args: number[] }[] = []
    const translates: { tag: string; x: number; y: number }[] = []
    const mkC2d = (tag: string) =>
      new Proxy(
        {},
        {
          get: (_t, key: string) => {
            if (key === 'measureText') return () => ({ width: 42 })
            if (key === 'createLinearGradient')
              return () => ({ addColorStop: () => {} })
            if (key === 'fillRect')
              return (...args: number[]) => {
                fills.push({ tag, args })
              }
            if (key === 'translate')
              return (x: number, y: number) => {
                translates.push({ tag, x, y })
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
    const ctx = {
      time: 1.5,
      data,
      renderer: undefined,
      resolution: {
        width: canvasW,
        height: canvasH,
        drawingBufferWidth: canvasW,
        drawingBufferHeight: canvasH,
      },
    }
    onFrame(ctx, { refs }, 1 / 30)
    return { fills, translates }
  }

  /** The bar strip is the first card-layer fillRect (bar bg) — height = barH. */
  const barFill = (fills: { tag: string; args: number[] }[]) =>
    fills.find(
      (f) => f.tag === 'card' && f.args.length === 4 && f.args[3] < 200,
    )

  it('native canvas draws the bar at 44·s; 9:16 canvas shrinks it by cf', () => {
    const native = barFill(runFrame(1920, 1080).fills)
    expect(native).toBeDefined()
    expect(native!.args[3]).toBeCloseTo(44, 4)

    const tall = barFill(runFrame(608, 1080).fills)
    const cf = 608 / 1080 / (1600 / 900)
    expect(tall).toBeDefined()
    expect(tall!.args[3]).toBeCloseTo(44 * cf, 4)
  })

  it('overlay anchors follow the frame fraction at any aspect', () => {
    const mk = (): OverlayClip[] => [
      {
        id: 't0',
        kind: 'text',
        start: 0,
        duration: 4,
        text: 'X',
        preset: 'title',
        transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
      },
    ]
    const wide = runFrame(1920, 1080, mk()).translates.filter(
      (t) => t.tag === 'ov',
    )
    const tall = runFrame(608, 1080, mk()).translates.filter(
      (t) => t.tag === 'ov',
    )
    expect(wide.at(-1)!.x).toBeCloseTo(0.5 * 1920, 4)
    expect(tall.at(-1)!.x).toBeCloseTo(0.5 * 608, 4) // same fraction, new width
    expect(tall.at(-1)!.y).toBeCloseTo(0.82 * 1080, 4)
  })
})
