import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import type { KeyframeTrack } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { pinRectOnScreen } from '../lower/pin'
import {
  clampFocus,
  computeCardLayout,
  focusBounds,
  focusForViewportCentre,
  zoomView,
  zoomViewport,
} from '../layout'
import { zoomCoversRect } from '../digest/framing'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { FrameStyle, ProjectDoc, ZoomSpan } from '../types'

/**
 * A zoom placed ON SCREEN (`screen: {x, y}`, frame fractions): under the
 * stage camera the target lands there at the apex instead of the centre, so
 * a deep zoom can hold its subject to one side with the ground open beside
 * it. ON_FRAME, zoomView, the viewport and its inverse, the pin projection
 * and the framing lint agree; a document with no placed span lowers the
 * four-component track it always had.
 */
const VIDEO = { width: 1600, height: 900 }
const W = 1920
const H = 1080
const STAGE: FrameStyle = { ...DEFAULT_FRAME_STYLE, camera: 'stage' }

const span = (over: Partial<ZoomSpan> = {}): ZoomSpan => ({
  id: 'z0',
  in: 1.5,
  out: 2.5,
  level: 2.2,
  cx: 0.6,
  cy: 0.45,
  source: 'manual',
  ...over,
})

function makeDoc(frame: FrameStyle, zoom: ZoomSpan[]): ProjectDoc {
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
    zoom,
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('a zoom placed on screen', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  const layout = computeCardLayout(DEFAULT_FRAME_STYLE, VIDEO, W, H)
  const placed = { x: 0.3, y: 0.55 }

  /** ON_FRAME's zoom block at output t, composed into p → a·p + b. */
  function onFrameMap(doc: ProjectDoc, t: number) {
    const { config, data } = lowerToComposition(doc)
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
    onFrame(
      {
        time: t,
        data,
        renderer: undefined,
        resolution: {
          width: W,
          height: H,
          drawingBufferWidth: W,
          drawingBufferHeight: H,
        },
      },
      {
        refs: {
          c2d,
          canvas: { width: W, height: H },
          texture: { needsUpdate: false, dispose: () => undefined },
          video: {
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
          },
          cam: null,
        },
      },
      1 / 30,
    )
    const first = calls.findIndex((c) => c.op === 'scale')
    const block = calls.slice(first - 1, first + 2)
    let ax = 1
    let ay = 1
    let bx = 0
    let by = 0
    for (let i = block.length - 1; i >= 0; i--) {
      const { op, args } = block[i]
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
    const track = data.zoomTrack as KeyframeTrack<number[]>
    return {
      map: { ax, ay, bx, by },
      value: sample(track, t, lerpArray),
      track,
    }
  }

  it('lands the target at its screen point, as zoomView says', () => {
    const doc = makeDoc(STAGE, [span({ screen: placed })])
    const { map, value } = onFrameMap(doc, 2)
    const [level, cx, cy, centring] = value
    expect(level).toBeCloseTo(2.2, 6)
    expect(value.slice(4)).toEqual([placed.x, placed.y])
    const v = zoomView(level, cx, cy, layout, 'stage', centring, placed)
    expect(map.ax * v.fx + map.bx).toBeCloseTo(placed.x * W, 3)
    expect(map.ay * v.fy + map.by).toBeCloseTo(placed.y * H, 3)
    // The content point at the screen point is zoomView's wc.
    expect(map.ax * v.wcx + map.bx).toBeCloseTo(v.ox, 3)
    expect(map.ay * v.wcy + map.by).toBeCloseTo(v.oy, 3)
  })

  it('keeps the four-component track, and the centre, when nothing is placed', () => {
    const { value } = onFrameMap(makeDoc(STAGE, [span()]), 2)
    expect(value).toHaveLength(4)
    // A placed span under a follow span's document: the follow span carries
    // the centre, the placed one its point.
    const both = onFrameMap(
      makeDoc(STAGE, [
        span({ id: 'a', in: 0.4, out: 1.2 }),
        span({ id: 'b', in: 2.4, out: 3.4, screen: placed }),
      ]),
      0.9,
    )
    expect(both.value.slice(4)).toEqual([0.5, 0.5])
  })

  it('a span that follows the cursor ignores its screen point', () => {
    const { value } = onFrameMap(
      makeDoc(STAGE, [span({ focusMode: 'auto', screen: placed })]),
      2,
    )
    expect(value).toHaveLength(4)
  })

  it('is the author composition: the cover band does not clamp it', () => {
    const corner = { cx: 0.97, cy: 0.5 }
    const free = clampFocus(corner.cx, corner.cy, 2.2, layout, 'stage', placed)
    expect(free.cx).toBe(0.97)
    const banded = clampFocus(corner.cx, corner.cy, 2.2, layout, 'stage')
    expect(banded.cx).toBeLessThan(0.97)
    expect(focusBounds(2.2, layout, 'stage', placed)).toEqual({
      minX: 0,
      maxX: 1,
      minY: 0,
      maxY: 1,
    })
    // The magnifier keeps its clamp: screen is the stage camera's.
    expect(focusBounds(2.2, layout, 'card', placed)).toEqual(
      focusBounds(2.2, layout, 'card'),
    )
  })

  it('the visible window and its inverse round-trip at any screen point', () => {
    for (const screen of [placed, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.2 }]) {
      for (const t of [1, 0.4]) {
        const vp = zoomViewport(2.2, 0.6, 0.45, layout, 'stage', t, screen)
        const back = focusForViewportCentre(
          vp.x + vp.w / 2,
          vp.y + vp.h / 2,
          2.2,
          layout,
          'stage',
          t,
          screen,
        )
        expect(back.cx).toBeCloseTo(0.6, 6)
        expect(back.cy).toBeCloseTo(0.45, 6)
      }
    }
    // A centred screen point is the old viewport exactly.
    expect(
      zoomViewport(2.2, 0.6, 0.45, layout, 'stage', 1, { x: 0.5, y: 0.5 }),
    ).toEqual(zoomViewport(2.2, 0.6, 0.45, layout, 'stage', 1))
  })

  it('a pin follows its referent through the placed camera', () => {
    const doc = makeDoc(STAGE, [span({ screen: placed })])
    const { track, value } = onFrameMap(doc, 2)
    const v = zoomView(
      value[0],
      value[1],
      value[2],
      layout,
      'stage',
      value[3],
      placed,
    )
    // The focus point itself, as a zero-size referent, lands at the screen point.
    const fNx = (v.fx - layout.dx) / layout.dw
    const fNy = (v.fy - layout.dy) / layout.dh
    const r = pinRectOnScreen(
      { x: fNx, y: fNy, w: 0, h: 0 },
      2,
      layout,
      'stage',
      track,
    )
    expect(r.x).toBeCloseTo(placed.x * W, 2)
    expect(r.y).toBeCloseTo(placed.y * H, 2)
  })

  it('the framing lint looks where the placed camera looks', () => {
    // A target well right of the focus: off screen when the focus is
    // centred, in view when the focus is held at the left third.
    // Centred at 2.2× the window spans ~0.34..0.86 of the video; held at the
    // left quarter it reaches ~0.98.
    const target = { x: 0.9, y: 0.42, w: 0.03, h: 0.04 }
    const s = { level: 2.2, cx: 0.6, cy: 0.45 }
    expect(zoomCoversRect(s, target, layout, 0, 'stage')).toBe(false)
    expect(
      zoomCoversRect(
        { ...s, screen: { x: 0.25, y: 0.5 } },
        target,
        layout,
        0,
        'stage',
      ),
    ).toBe(true)
  })
})
