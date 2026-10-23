import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import type { KeyframeTrack } from '@vosjs/timeline'
import { docZoomTrack, lowerToComposition } from '../lower/lowerToComposition'
import { pinRectOnScreen } from '../lower/pin'
import { zoomWindow } from '../digest/framing'
import { cameraModel, clampFocus, docCardLayout } from '../layout'
import {
  CARD_EDGE_OVERDRAW,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type {
  CursorEvent,
  FrameStyle,
  Media,
  MediaFrame,
  ProjectDoc,
  ZoomSpan,
} from '../types'

/**
 * The camera is the TAKE's, on every media. A media wears its own card
 * (placement, corner, fit), but the camera model is a frame-wide field, so
 * a zoom on the second media of a stage-camera take must render exactly
 * where the host mirrors say: zoomView through pinRectOnScreen (pinned
 * layers, the caption-over-the-click check), the visible window
 * (zoomWindow / zoomCoversRect) and the focus clamp, each read against
 * that media's own card. ON_FRAME is run here in a stub context and the
 * footage's draw, transform included, is read back: a footage point's
 * pixel on screen is what the render does, the mirror's is what the
 * hosts believe.
 */

const W = 1920
const H = 1080

interface Dims {
  width: number
  height: number
}

const meta = (dims: Dims, durationMs: number) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: dims.width,
  height: dims.height,
  fps: 30,
})

/** Primary 0..3 s, then the media m2 0..4 s: output 3..7 plays m2. */
function makeDoc(opts: {
  frame: FrameStyle
  primary: Dims
  m2: Dims
  zoom: ZoomSpan[]
  m2Frame?: MediaFrame
  primaryCursor?: CursorEvent[]
  m2Cursor?: CursorEvent[]
}): ProjectDoc {
  const m2: Media = {
    id: 'm2',
    videoKey: 'blob:m2',
    cursor: opts.m2Cursor ?? [],
    meta: meta(opts.m2, 4000),
    ...(opts.m2Frame ? { frame: opts.m2Frame } : {}),
  }
  return {
    source: {
      videoKey: 'blob:primary',
      cursor: opts.primaryCursor ?? [],
      meta: meta(opts.primary, 3000),
    },
    segments: [
      { in: 0, out: 3 },
      { in: 0, out: 4, media: 'm2' },
    ],
    media: [m2],
    zoom: opts.zoom,
    audio: [],
    cursor: { ...DEFAULT_CURSOR_STYLE, visible: false },
    cam: DEFAULT_CAM_STYLE,
    frame: opts.frame,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const videoStub = (dims: Dims, t: number) => ({
  videoWidth: dims.width,
  videoHeight: dims.height,
  readyState: 2,
  paused: true,
  seeking: false,
  currentTime: t,
  duration: 4,
  play: () => Promise.resolve(),
  pause: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})

type Mat = [number, number, number, number, number, number]
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

interface FootageDraw {
  /** The footage's destination rect in canvas user space (overdraw removed). */
  rect: { x: number; y: number; w: number; h: number }
  /** The transform it was drawn under. */
  m: Mat
}

const g = globalThis as Record<string, unknown>

/** Run ON_FRAME at output t and read back how the footage was drawn. */
function footageDraw(doc: ProjectDoc, t: number, dims: Dims): FootageDraw {
  const { config, data } = lowerToComposition(doc)
  const onFrame = new Function(
    `"use strict"; return (${config.onFrame as string})`,
  )() as (ctx: unknown, content: unknown, dt: number) => void
  g.window = { __vos__: { isPaused: true } }
  g.__vosTimeline = { mapTime, sample, lerpArray }
  const primary = videoStub(doc.source.meta, t)
  const m2 = videoStub(dims, t)
  let m: Mat = [1, 0, 0, 1, 0, 0]
  const stack: Mat[] = []
  let draw: FootageDraw | null = null
  const c2d = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key === 'measureText') return () => ({ width: 42 })
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop: () => {} })
        return (...a: unknown[]) => {
          const n = a as number[]
          if (key === 'save') stack.push(m)
          else if (key === 'restore') m = stack.pop() ?? [1, 0, 0, 1, 0, 0]
          else if (key === 'setTransform')
            m = [n[0], n[1], n[2], n[3], n[4], n[5]]
          else if (key === 'translate') m = mul(m, [1, 0, 0, 1, n[0], n[1]])
          else if (key === 'scale') m = mul(m, [n[0], 0, 0, n[1], 0, 0])
          else if (
            key === 'drawImage' &&
            !draw &&
            (a[0] === primary || a[0] === m2)
          ) {
            const r = a.length >= 9 ? n.slice(5, 9) : n.slice(1, 5)
            const ov = CARD_EDGE_OVERDRAW / m[0]
            draw = {
              rect: {
                x: r[0] + ov,
                y: r[1] + ov,
                w: r[2] - 2 * ov,
                h: r[3] - 2 * ov,
              },
              m,
            }
          }
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
        video: primary,
        media: { m2 },
        cam: null,
      },
    },
    1 / 30,
  )
  if (!draw) throw new Error('the footage was not drawn')
  return draw
}

/** Where ON_FRAME puts footage point (nx, ny) on screen, canvas px. */
function rendered(d: FootageDraw, nx: number, ny: number) {
  const px = d.rect.x + nx * d.rect.w
  const py = d.rect.y + ny * d.rect.h
  return {
    x: d.m[0] * px + d.m[2] * py + d.m[4],
    y: d.m[1] * px + d.m[3] * py + d.m[5],
  }
}

/** Where the hosts believe it lands: the zoom track through zoomView. */
function mirrored(
  doc: ProjectDoc,
  media: string,
  t: number,
  nx: number,
  ny: number,
) {
  const r = pinRectOnScreen(
    { x: nx, y: ny, w: 0, h: 0 },
    t,
    docCardLayout(doc, media),
    cameraModel(doc.frame),
    docZoomTrack(doc),
  )
  return { x: r.x, y: r.y }
}

const STAGE: FrameStyle = { ...DEFAULT_FRAME_STYLE, camera: 'stage' }
const INSETS = {
  none: undefined,
  symmetric: { top: 0.1, left: 0.1, right: 0.1, bottom: 0.1 },
  asymmetric: { top: 0.05, left: 0.1, right: 0.1, bottom: 0.15 },
}
const FOCI = [
  { cx: 0.437, cy: 0.899 }, // a control near the footage's bottom edge
  { cx: 0.5, cy: 0.5 },
  { cx: 0.85, cy: 0.2 },
]
const LEVELS = [1.5, 1.8, 2.5]
const SCREENS = [undefined, { x: 0.3, y: 0.6 }]
const POINTS = [
  [0.437, 0.899],
  [0.2, 0.8],
  [0.9, 0.95],
  [0.5, 0.1],
]

/** A span on m2 (source 0.8..3.6 = output 3.8..6.6), its apex at 5.2. */
const m2Span = (over: Partial<ZoomSpan>): ZoomSpan => ({
  id: 'z-m2',
  in: 0.8,
  out: 3.6,
  level: 1.8,
  cx: 0.5,
  cy: 0.5,
  source: 'manual',
  media: 'm2',
  ...over,
})
/** A span on the primary (output 0.4..2.6), its apex at 1.5. */
const primarySpan = (over: Partial<ZoomSpan>): ZoomSpan => ({
  id: 'z-p',
  in: 0.4,
  out: 2.6,
  level: 1.8,
  cx: 0.5,
  cy: 0.5,
  source: 'manual',
  ...over,
})

describe('the camera on every media is the take’s', () => {
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  const cases: {
    name: string
    inset: keyof typeof INSETS
    level: number
    focus: { cx: number; cy: number }
    screen?: { x: number; y: number }
  }[] = []
  for (const inset of Object.keys(INSETS) as (keyof typeof INSETS)[])
    for (const level of LEVELS)
      for (const focus of FOCI)
        for (const screen of SCREENS)
          cases.push({
            name: `${inset} inset, ${level}x at (${focus.cx}, ${focus.cy})${screen ? `, placed at (${screen.x}, ${screen.y})` : ''}`,
            inset,
            level,
            focus,
            screen,
          })

  for (const [mediaName, m2Dims] of [
    ['the same footage size', { width: 1920, height: 1080 }],
    ['a taller footage', { width: 1600, height: 1000 }],
  ] as const) {
    describe(`a second media of ${mediaName}`, () => {
      it.each(cases)('renders where the mirror says: $name', (c) => {
        const frame: FrameStyle = {
          ...STAGE,
          ...(INSETS[c.inset] ? { inset: INSETS[c.inset] } : {}),
        }
        const span = {
          level: c.level,
          ...c.focus,
          ...(c.screen ? { screen: c.screen } : {}),
        }
        const doc = makeDoc({
          frame,
          primary: { width: 1920, height: 1080 },
          m2: m2Dims,
          zoom: [primarySpan(span), m2Span(span)],
        })
        for (const [media, t, dims] of [
          ['', 1.5, doc.source.meta],
          ['m2', 5.2, m2Dims],
        ] as const) {
          const track = docZoomTrack(doc) as KeyframeTrack<number[]>
          const z = sample(track, t, lerpArray)
          expect(z[0]).toBeCloseTo(c.level, 6)
          const d = footageDraw(doc, t, dims)
          for (const [nx, ny] of POINTS) {
            const want = mirrored(doc, media, t, nx, ny)
            const got = rendered(d, nx, ny)
            expect(
              got.x,
              `${media || 'primary'} x of (${nx}, ${ny})`,
            ).toBeCloseTo(want.x, 3)
            expect(
              got.y,
              `${media || 'primary'} y of (${nx}, ${ny})`,
            ).toBeCloseTo(want.y, 3)
          }
          // The visible window the framing lint tests a click against: the
          // frame's corners mapped back into footage fractions. Read at the
          // track's focus: the track stores it to the thousandth.
          const win = zoomWindow(
            { ...span, cx: z[1], cy: z[2] },
            docCardLayout(doc, media),
            'stage',
          )
          const inv = (sx: number, sy: number) => ({
            nx: ((sx - d.m[4]) / d.m[0] - d.rect.x) / d.rect.w,
            ny: ((sy - d.m[5]) / d.m[3] - d.rect.y) / d.rect.h,
          })
          const tl = inv(0, 0)
          const br = inv(W, H)
          expect(tl.nx).toBeCloseTo(win.x0, 3)
          expect(tl.ny).toBeCloseTo(win.y0, 3)
          expect(br.nx).toBeCloseTo(win.x1, 3)
          expect(br.ny).toBeCloseTo(win.y1, 3)
        }
      })
    })
  }

  it('the magnifier stays the magnifier on every media', () => {
    const doc = makeDoc({
      frame: { ...DEFAULT_FRAME_STYLE, inset: INSETS.asymmetric },
      primary: { width: 1920, height: 1080 },
      m2: { width: 1920, height: 1080 },
      zoom: [m2Span({ level: 2, cx: 0.4, cy: 0.7 })],
    })
    const d = footageDraw(doc, 5.2, { width: 1920, height: 1080 })
    for (const [nx, ny] of POINTS) {
      const want = mirrored(doc, 'm2', 5.2, nx, ny)
      const got = rendered(d, nx, ny)
      expect(got.x).toBeCloseTo(want.x, 3)
      expect(got.y).toBeCloseTo(want.y, 3)
    }
  })

  it('clamps a span on a media against that media’s own card', () => {
    // m2 sits in a card of its own (a deep bottom inset); a focus at its
    // bottom edge is clamped for that card, which is the card it renders in.
    const m2Frame: MediaFrame = {
      inset: { top: 0.02, left: 0.2, right: 0.2, bottom: 0.3 },
    }
    const frame: FrameStyle = { ...STAGE, inset: INSETS.symmetric }
    const span = { level: 1.8, cx: 0.45, cy: 0.97 }
    const doc = makeDoc({
      frame,
      primary: { width: 1920, height: 1080 },
      m2: { width: 1920, height: 1080 },
      zoom: [m2Span(span)],
      m2Frame,
    })
    const track = docZoomTrack(doc) as KeyframeTrack<number[]>
    const z = sample(track, 5.2, lerpArray)
    const want = clampFocus(
      span.cx,
      span.cy,
      span.level,
      docCardLayout(doc, 'm2'),
      'stage',
    )
    // The track stores a focus to the thousandth.
    expect(z[1]).toBeCloseTo(want.cx, 3)
    expect(z[2]).toBeCloseTo(want.cy, 3)
    // …and that clamp is the media's card, not the take's frame.
    const primaryCard = clampFocus(
      span.cx,
      span.cy,
      span.level,
      docCardLayout(doc),
      'stage',
    )
    expect(Math.abs(primaryCard.cy - want.cy)).toBeGreaterThan(0.02)
    const d = footageDraw(doc, 5.2, { width: 1920, height: 1080 })
    for (const [nx, ny] of POINTS) {
      const got = rendered(d, nx, ny)
      const m = mirrored(doc, 'm2', 5.2, nx, ny)
      expect(got.x).toBeCloseTo(m.x, 3)
      expect(got.y).toBeCloseTo(m.y, 3)
    }
  })

  it('a span on a media follows that media’s cursor', () => {
    // The primary's pointer rests top left the whole time; m2's rests
    // bottom right. A follow span on m2 frames m2's pointer.
    // Each pointer travels from the centre to its corner over the span.
    const rest = (x: number, y: number): CursorEvent[] =>
      Array.from({ length: 80 }, (_, i) => {
        const u = Math.min(1, i / 40)
        return {
          t: i * 50,
          x: Math.round(960 + (x - 960) * u),
          y: Math.round(540 + (y - 540) * u),
          type: 'move' as const,
        }
      })
    const doc = makeDoc({
      frame: STAGE,
      primary: { width: 1920, height: 1080 },
      m2: { width: 1920, height: 1080 },
      zoom: [m2Span({ level: 1.8, cx: 0.5, cy: 0.5, focusMode: 'auto' })],
      primaryCursor: rest(200, 150),
      m2Cursor: rest(1500, 800),
    })
    const z = sample(
      docZoomTrack(doc) as KeyframeTrack<number[]>,
      5.2,
      lerpArray,
    )
    expect(z[1]).toBeGreaterThan(0.6)
    expect(z[2]).toBeGreaterThan(0.6)
  })
})
