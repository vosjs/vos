import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import type { KeyframeTrack } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { clampFocus, computeCardLayout, zoomView } from '../layout'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { FrameStyle, ProjectDoc } from '../types'

/**
 * ON_FRAME parity for the zoom camera: the interpreter's translate / scale
 * calls at a zoomed instant must compose to layout.ts's zoomView under
 * BOTH camera models. The magnifier keeps its old three calls (scale about
 * the focus, byte-identical for every existing document); the stage camera
 * translates to the frame centre, scales, and translates the centred content
 * point away. Change zoomView and the ON_FRAME block together.
 */
const VIDEO = { width: 1600, height: 900 }
const W = 1920
const H = 1080

describe('ON_FRAME camera parity', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function makeDoc(frame: FrameStyle): ProjectDoc {
    return {
      source: {
        videoKey: 'blob:video',
        cursor: [
          { t: 0, x: 100, y: 100, type: 'move' },
          { t: 500, x: 300, y: 300, type: 'down' },
        ],
        meta: {
          dpr: 2,
          zoom: 1,
          t0: 0,
          durationMs: 4000,
          width: VIDEO.width,
          height: VIDEO.height,
          fps: 30,
        },
      },
      segments: [{ in: 0, out: 4 }],
      // A held zoom on a corner target: the level is 1.8 and the focus sits
      // at the card's top-left, where the magnifier's clamp and the stage
      // camera's centring differ the most.
      zoom: [
        {
          id: 'z0',
          in: 1.5,
          out: 2.5,
          level: 1.8,
          cx: 0.05,
          cy: 0.1,
          source: 'manual',
        },
      ],
      audio: [],
      cursor: DEFAULT_CURSOR_STYLE,
      cam: DEFAULT_CAM_STYLE,
      frame,
      export: { resolution: '1080p', fps: 30, format: 'mp4' },
    }
  }

  /** The translate/scale calls up to the first card clip, at output time t. */
  function zoomCalls(
    frame: FrameStyle,
    t: number,
  ): {
    calls: { op: string; args: number[] }[]
    trackValue: readonly number[]
  } {
    const { config, data } = lowerToComposition(makeDoc(frame))
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const calls: { op: string; args: number[] }[] = []
    let clipped = false
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return (...args: unknown[]) => {
            if (clipped) return
            if (key === 'translate' || key === 'scale')
              calls.push({ op: key, args: args as number[] })
            if (key === 'clip') clipped = true
          }
        },
        set: () => true,
      },
    )
    const video = {
      videoWidth: VIDEO.width,
      videoHeight: VIDEO.height,
      readyState: 2,
      paused: true,
      currentTime: t,
      duration: 4,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const ctx = {
      time: t,
      data,
      renderer: undefined,
      resolution: {
        width: W,
        height: H,
        drawingBufferWidth: W,
        drawingBufferHeight: H,
      },
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
    const track = data.zoomTrack as KeyframeTrack<number[]>
    const trackValue = sample(track, t, lerpArray)
    return { calls, trackValue }
  }

  /** Compose translate/scale calls into the affine map p → a·p + b. */
  function compose(calls: { op: string; args: number[] }[]) {
    // Canvas transforms post-multiply: the composed map is applied in call
    // order to a user point, so fold from the last call to the first.
    let ax = 1
    let ay = 1
    let bx = 0
    let by = 0
    for (let i = calls.length - 1; i >= 0; i--) {
      const { op, args } = calls[i]
      if (op === 'scale') {
        ax *= args[0]
        ay *= args[1]
        bx *= args[0]
        by *= args[1]
      } else {
        bx += args[0]
        by += args[1]
      }
    }
    return { ax, ay, bx, by }
  }

  it('the stage camera lands the focus at the frame centre; the magnifier keeps it in place', () => {
    const layout = computeCardLayout(DEFAULT_FRAME_STYLE, VIDEO, W, H)
    for (const camera of ['card', 'stage'] as const) {
      const frame: FrameStyle = { ...DEFAULT_FRAME_STYLE, camera }
      const { calls, trackValue } = zoomCalls(frame, 2)
      const [level, cx, cy] = trackValue
      expect(level).toBeCloseTo(1.8, 6)
      // The zoom block is the first three calls: translate, scale, translate.
      const zoomOps = calls.filter((c) => c.op === 'scale')
      expect(zoomOps.length).toBeGreaterThan(0)
      const first = calls.findIndex((c) => c.op === 'scale')
      const block = calls.slice(first - 1, first + 2)
      expect(block.map((c) => c.op)).toEqual([
        'translate',
        'scale',
        'translate',
      ])
      const m = compose(block)
      const v = zoomView(level, cx, cy, layout, camera)
      // Where the focus lands on screen under the composed map.
      const sx = m.ax * v.fx + m.bx
      const sy = m.ay * v.fy + m.by
      if (camera === 'stage') {
        expect(sx).toBeCloseTo(W / 2, 3)
        expect(sy).toBeCloseTo(H / 2, 3)
        // The corner focus is pulled in exactly as far as the cover band
        // asks (the lowering's clampFocus under the stage model).
        // (the lowering rounds a focus to 3 dp)
        const want = clampFocus(0.05, 0.1, level, layout, 'stage')
        expect(cx).toBeCloseTo(want.cx, 3)
        expect(cy).toBeCloseTo(want.cy, 3)
        expect(cx).toBeGreaterThan(0.05)
      } else {
        expect(sx).toBeCloseTo(v.fx, 3)
        expect(sy).toBeCloseTo(v.fy, 3)
        expect(cx).toBeGreaterThan(0.05)
      }
      // Both: the content point at the centre is zoomView's wc.
      const cxScreen = m.ax * v.wcx + m.bx
      const cyScreen = m.ay * v.wcy + m.by
      expect(cxScreen).toBeCloseTo(W / 2, 3)
      expect(cyScreen).toBeCloseTo(H / 2, 3)
    }
  })

  it('the centring rides the track with the level: one ease for the slide and the scale', () => {
    const { data } = lowerToComposition(
      makeDoc({ ...DEFAULT_FRAME_STYLE, camera: 'stage' }),
    )
    const track = data.zoomTrack as KeyframeTrack<number[]>
    const apexIdx = track.keyframes.findIndex((k) => k.value[0] > 1 + 1e-9)
    const apex = track.keyframes[apexIdx]
    const rest = track.keyframes[apexIdx - 1]
    expect(rest.value[3]).toBe(0)
    expect(apex.value[3]).toBe(1)
    // Anywhere on the ramp the centring equals the level's own progress.
    for (const u of [0.15, 0.4, 0.7, 0.95]) {
      const t = rest.t + (apex.t - rest.t) * u
      const v = sample(track, t, lerpArray)
      const progress = (v[0] - 1) / (apex.value[0] - 1)
      expect(v[3]).toBeCloseTo(progress, 9)
    }
    // And the zoom-out returns both to rest together.
    const last = track.keyframes[track.keyframes.length - 1]
    expect(last.value[0]).toBe(1)
    expect(last.value[3]).toBe(0)
  })

  it('at rest (level 1, before the ramp-in starts) neither model emits a zoom transform', () => {
    for (const camera of ['card', 'stage'] as const) {
      const { calls } = zoomCalls({ ...DEFAULT_FRAME_STYLE, camera }, 0.1)
      expect(calls.filter((c) => c.op === 'scale').length).toBe(0)
    }
  })
})
