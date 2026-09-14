/**
 * Pinned layers: a layer placed beside its referent and carried with it
 * through the camera. The referent resolves from a step's rect, the presses
 * in a step's window, a press, or a rect; the placement is the referent
 * mapped through zoomView plus a gap off the chosen side, clamped into the
 * frame; the lowering bakes it into the clip's motion track and hands the
 * mark and the leader to ON_FRAME; an unpinned document lowers
 * byte-identically.
 */
import { describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { computeCardLayout, docCardLayout, zoomView } from '../layout'
import {
  docZoomTrack,
  lowerToComposition,
  overlayPinPoseAt,
  resolvePins,
} from '../lower/lowerToComposition'
import {
  PIN_GAP,
  PIN_MARGIN,
  pinBox,
  pinPlacement,
  pinReferent,
  simplify,
} from '../lower/pin'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { Keyframe, KeyframeTrack } from '@vosjs/timeline'
import type {
  CursorTrack,
  HtmlOverlayClip,
  OverlayPin,
  ProjectDoc,
  StepSpan,
} from '../types'

const VW = 1280
const VH = 720
/** The Copy button, top-right of the page. */
const COPY = { x: 1100, y: 80, w: 96, h: 36 }
/** A slider thumb at the left edge. */
const THUMB = { x: 60, y: 400, w: 16, h: 16 }

const cursor: CursorTrack = [
  { t: 0, x: 100, y: 100, type: 'move' },
  { t: 2000, x: 1148, y: 98, type: 'down', rect: COPY },
  { t: 2100, x: 1148, y: 98, type: 'up', rect: COPY },
  { t: 5000, x: 68, y: 408, type: 'down', rect: THUMB },
  { t: 5100, x: 68, y: 408, type: 'up', rect: THUMB },
]

const steps: StepSpan[] = [
  { step: 0, do: 'wait', tStart: 0, tEnd: 1.5 },
  {
    step: 1,
    id: 'copy',
    do: 'click',
    selector: 'button',
    tStart: 1.6,
    tEnd: 2.4,
    rect: COPY,
  },
  {
    step: 2,
    id: 'thumb',
    do: 'click',
    selector: 'input',
    tStart: 4.8,
    tEnd: 5.3,
  },
  { step: 3, do: 'scroll', tStart: 6, tEnd: 6.5 },
]

function makeDoc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor,
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10000,
        width: VW,
        height: VH,
        fps: 30,
        steps,
      },
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...DEFAULT_FRAME_STYLE, camera: 'stage' },
    export: { resolution: '1080p', fps: 60, format: 'mp4' },
    ...over,
  }
}

function note(
  pin: OverlayPin,
  over: Partial<HtmlOverlayClip> = {},
): HtmlOverlayClip {
  return {
    id: 'n1',
    kind: 'html',
    start: 2,
    duration: 3,
    html: '<div class="c">Copy the theme</div>',
    css: '.c{background:#111;color:#fff;padding:24px;border-radius:12px}',
    box: { width: 420, height: 120 },
    transform: { x: 0.5, y: 0.82, scale: 1, rotation: 0 },
    pin,
    ...over,
  }
}

describe('pinReferent', () => {
  it("reads a step's own rect, normalised into video fractions", () => {
    const r = pinReferent(makeDoc(), { step: 'copy' })
    expect(r?.by).toBe('step')
    expect(r?.rect.x).toBeCloseTo(COPY.x / VW, 6)
    expect(r?.rect.w).toBeCloseTo(COPY.w / VW, 6)
    expect(r?.at).toBe(1.6)
  })

  it('falls back to the presses inside the step window when the step has no rect', () => {
    const r = pinReferent(makeDoc(), { step: 'thumb' })
    expect(r?.by).toBe('step')
    expect(r?.rect.x).toBeCloseTo(THUMB.x / VW, 6)
    expect(r?.rect.h).toBeCloseTo(THUMB.h / VH, 6)
  })

  it('names a step by index too, and an unknown step or a skipped one resolves to nothing', () => {
    expect(pinReferent(makeDoc(), { step: 1 })?.rect.x).toBeCloseTo(
      COPY.x / VW,
      6,
    )
    expect(pinReferent(makeDoc(), { step: 'nope' })).toBeNull()
    expect(pinReferent(makeDoc(), { step: 0 })).toBeNull() // a wait: no press
    const skipped = makeDoc()
    skipped.source.meta.steps = steps.map((s) =>
      s.id === 'copy' ? { ...s, skipped: true } : s,
    )
    expect(pinReferent(skipped, { step: 'copy' })).toBeNull()
  })

  it('a press names the nearest click within half a second; a rect is taken as written', () => {
    expect(pinReferent(makeDoc(), { press: 5.2 })?.rect.y).toBeCloseTo(
      THUMB.y / VH,
      6,
    )
    expect(pinReferent(makeDoc(), { press: 3.5 })).toBeNull()
    const r = pinReferent(makeDoc(), {
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
    })
    expect(r?.by).toBe('rect')
    expect(r?.rect).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 })
  })
})

describe('pinBox', () => {
  it("an html layer's box is its design box, never the picture's bleed", () => {
    const layout = docCardLayout(makeDoc())
    const clip = note({ step: 'copy' })
    const b = pinBox(clip, layout)
    // design size: the box lands 1:1 in design px at any bleed
    expect(b.w).toBeCloseTo(420, 3)
    expect(b.h).toBeCloseTo(120, 3)
    const shadowed = note(
      { step: 'copy' },
      { css: '.c{box-shadow:0 20px 60px rgba(0,0,0,.4)}' },
    )
    const b2 = pinBox(shadowed, layout)
    expect(b2.w).toBeCloseTo(420, 3)
  })
})

describe('pinPlacement', () => {
  const doc = makeDoc()
  const layout = docCardLayout(doc)
  const referent = pinReferent(doc, { step: 'copy' })!.rect
  const base = [0.5, 0.82, 1, 0, 1]

  it('with no camera the layer sits a gap off the referent, on the first side with room', () => {
    // The Copy button is top-right: the right side has no room, the left has.
    const p = pinPlacement({
      clip: note({ step: 'copy' }),
      referent,
      layout,
      camera: 'stage',
      zoomTrack: null,
      base,
    })
    expect(p.side).toBe('left')
    const v = sample(p.track, 1, lerpArray)
    const refPx = {
      x: layout.dx + referent.x * layout.dw,
      y: layout.dy + referent.y * layout.dh,
      h: referent.h * layout.dh,
    }
    expect(v[0] * layout.W).toBeCloseTo(refPx.x - PIN_GAP - p.box.w / 2, 1)
    expect(v[1] * layout.H).toBeCloseTo(refPx.y + refPx.h / 2, 1)
    // scale, rotation and opacity come from the base
    expect(v.slice(2)).toEqual([1, 0, 1])
    // a still camera collapses to two keyframes
    expect(p.track.keyframes.length).toBe(2)
    expect(p.clamped).toBe(0)
  })

  it('a stated side is honoured and the layer is clamped inside the frame', () => {
    const p = pinPlacement({
      clip: note({ step: 'copy', side: 'right' }),
      referent,
      layout,
      camera: 'stage',
      zoomTrack: null,
      base,
    })
    expect(p.side).toBe('right')
    const v = sample(p.track, 1, lerpArray)
    expect(v[0] * layout.W + p.box.w / 2).toBeLessThanOrEqual(
      layout.W - PIN_MARGIN + 0.05,
    )
    expect(p.clamped).toBeGreaterThan(0)
  })

  it('through a zoom the layer follows the referent as zoomView maps it', () => {
    const zoomed = makeDoc({
      zoom: [
        {
          id: 'z1',
          in: 2.5,
          out: 4.5,
          level: 1.8,
          cx: 0.86,
          cy: 0.11,
          source: 'manual',
        },
      ],
    })
    const track = docZoomTrack(zoomed)!
    const clip = note(
      { step: 'copy', side: 'below' },
      { start: 2, duration: 3 },
    )
    const p = pinPlacement({
      clip,
      referent,
      layout,
      camera: 'stage',
      zoomTrack: track,
      base,
    })
    // At the apex (output 3.5 s → clip-local 1.5) the referent sits where
    // the camera puts it; the layer hangs a gap under its bottom edge.
    const z = sample(track, 3.5, lerpArray)
    expect(z[0]).toBeCloseTo(1.8, 3)
    const v = zoomView(z[0], z[1], z[2], layout, 'stage', z[3])
    const map = (nx: number, ny: number) => ({
      x: v.ox + (layout.dx + nx * layout.dw - v.wcx) * v.level,
      y: v.oy + (layout.dy + ny * layout.dh - v.wcy) * v.level,
    })
    const a = map(referent.x, referent.y)
    const b = map(referent.x + referent.w, referent.y + referent.h)
    const got = sample(p.track, 1.5, lerpArray)
    expect(got[0] * layout.W).toBeCloseTo((a.x + b.x) / 2, 0)
    expect(got[1] * layout.H).toBeCloseTo(b.y + PIN_GAP + p.box.h / 2, 0)
    // and it moved from where it sat at rest
    const rest = sample(p.track, 0, lerpArray)
    expect(Math.abs(rest[1] - got[1]) * layout.H).toBeGreaterThan(40)
    // the ramp keeps its samples; the holds keep two
    expect(p.track.keyframes.length).toBeGreaterThan(6)
    expect(p.track.keyframes.length).toBeLessThan(60)
    expect(p.track.keyframes.every((k) => k.ease === 'linear')).toBe(true)
    // the leader's tip is the layer's top edge midpoint (side below)
    const tip = sample(p.tip, 1.5, lerpArray)
    expect(tip[0]).toBeCloseTo(got[0], 4)
    expect(tip[1] * layout.H).toBeCloseTo(got[1] * layout.H - p.box.h / 2, 1)
  })

  it('auto picks the roomiest side when none fits', () => {
    const wide = note({ step: 'copy' }, { box: { width: 1800, height: 1000 } })
    const p = pinPlacement({
      clip: wide,
      referent,
      layout,
      camera: 'stage',
      zoomTrack: null,
      base,
    })
    expect(['right', 'left', 'below', 'above']).toContain(p.side)
    expect(p.clamped).toBeGreaterThan(0)
  })
})

describe('a carried referent (a drag)', () => {
  /** A slider drag: press at x 200, travel to x 500 over a second, release. */
  const dragCursor: CursorTrack = [
    { t: 0, x: 100, y: 100, type: 'move' },
    {
      t: 5000,
      x: 200,
      y: 400,
      type: 'down',
      rect: { x: 192, y: 392, w: 16, h: 16 },
    },
    ...[1, 2, 3, 4, 5].map((i) => ({
      t: 5000 + i * 200,
      x: 200 + i * 60,
      y: 400,
      type: 'move' as const,
    })),
    {
      t: 6000,
      x: 500,
      y: 400,
      type: 'up',
      rect: { x: 192, y: 392, w: 16, h: 16 },
    },
    { t: 8000, x: 500, y: 400, type: 'move' },
  ]
  const dragSteps: StepSpan[] = [
    {
      step: 0,
      id: 'thumb',
      do: 'drag',
      selector: 'input',
      tStart: 4.9,
      tEnd: 6.1,
    },
  ]
  const dragDoc = (over: Partial<ProjectDoc> = {}) =>
    makeDoc({
      source: {
        ...makeDoc().source,
        cursor: dragCursor,
        meta: { ...makeDoc().source.meta, steps: dragSteps },
      },
      ...over,
    })

  it('a drag step names a carried referent; a still press does not', () => {
    const r = pinReferent(dragDoc(), { step: 'thumb' })
    expect(r?.carry).toEqual({ t0: 5, t1: 6, x0: 200 / VW, y0: 400 / VH })
    expect(pinReferent(makeDoc(), { step: 'copy' })?.carry).toBeUndefined()
  })

  it('the layer and the mark follow the pointer through the drag and hold at the release', () => {
    const doc = dragDoc({
      overlays: [
        note(
          { step: 'thumb', side: 'above', mark: 'ring', color: '#7c3aed' },
          { start: 4.5, duration: 4 },
        ),
      ],
    })
    const layout = docCardLayout(doc)
    const pins = resolvePins(doc, layout, 'stage', docZoomTrack(doc))
    const p = pins.get('n1')!
    // output = source here (no trims, rate 1): at 5.5 s the pointer is at x 350
    const atPress = sample(p.track, 0.5, lerpArray)[0] * layout.W
    const mid = sample(p.track, 1.0, lerpArray)[0] * layout.W
    const held = sample(p.track, 3.5, lerpArray)[0] * layout.W
    expect(mid - atPress).toBeCloseTo((150 / VW) * layout.dw, 0)
    expect(held - atPress).toBeCloseTo((300 / VW) * layout.dw, 0)
    // and data.pins carries the drag for ON_FRAME
    const { data } = lowerToComposition(doc)
    const pin = (data.pins as Record<string, unknown>[])[0]
    expect(pin.carry).toEqual({
      t0: 5,
      t1: 6,
      x0: +(200 / VW).toFixed(5),
      y0: +(400 / VH).toFixed(5),
    })
  })
})

describe('simplify', () => {
  const key = (t: number, v: number[]): Keyframe<number[]> => ({
    t,
    value: v,
    ease: 'linear',
  })
  it('drops the samples a straight line predicts and keeps the ends', () => {
    const line = [0, 1, 2, 3, 4].map((i) => key(i / 30, [i * 0.01, 0.5]))
    expect(simplify(line, [1920, 1080]).map((k) => k.t)).toEqual([0, 0.133])
    const bend = [
      key(0, [0, 0]),
      key(0.1, [0.01, 0]),
      key(0.2, [0.02, 0]),
      key(0.3, [0.02, 0.05]),
      key(0.4, [0.02, 0.1]),
    ]
    expect(simplify(bend, [1920, 1080]).map((k) => k.t)).toEqual([0, 0.2, 0.4])
  })
})

describe('lowering', () => {
  it('an unpinned document lowers byte-identically, and a pin adds only data', () => {
    const plain = lowerToComposition(
      makeDoc({ overlays: [note({ step: 'copy' }, { pin: undefined })] }),
    )
    const pinned = lowerToComposition(
      makeDoc({ overlays: [note({ step: 'copy' })] }),
    )
    expect(pinned.config.onFrame).toBe(plain.config.onFrame)
    expect(pinned.config.setup).toBe(plain.config.setup)
    expect(JSON.stringify(Object.keys(plain.data))).not.toContain('pins')
    const plainOv = (
      plain.stack[STUDIO_ENTRY_ID].overlays as Record<string, unknown>[]
    )[0]
    const pinnedOv = (
      pinned.stack[STUDIO_ENTRY_ID].overlays as Record<string, unknown>[]
    )[0]
    expect(plainOv.track).toBeUndefined()
    expect(
      (pinnedOv.track as KeyframeTrack<number[]>).keyframes.length,
    ).toBeGreaterThanOrEqual(2)
    // a pin with neither mark nor leader hands ON_FRAME nothing
    expect(pinned.data.pins).toBeUndefined()
  })

  it('a mark or a leader lands in data.pins with the referent and the tip', () => {
    const { data } = lowerToComposition(
      makeDoc({
        overlays: [
          note({ step: 'copy', mark: 'ring', leader: true, color: '#7c3aed' }),
        ],
      }),
    )
    const pins = data.pins as Record<string, unknown>[]
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({
      id: 'n1',
      start: 2,
      dur: 3,
      mark: 'ring',
      leader: true,
      color: '#7c3aed',
      side: 'left',
      enter: 'rise',
    })
    expect(pins[0].x).toBeCloseTo(COPY.x / VW, 3)
    expect(
      (pins[0].tip as KeyframeTrack<number[]>).keyframes.length,
    ).toBeGreaterThanOrEqual(2)
  })

  it('a pin that resolves to nothing leaves the layer on its transform', () => {
    const { stack, data } = lowerToComposition(
      makeDoc({ overlays: [note({ step: 'nope', mark: 'ring' })] }),
    )
    const ov = (stack[STUDIO_ENTRY_ID].overlays as Record<string, unknown>[])[0]
    expect(ov.track).toBeUndefined()
    expect(ov.x).toBe(0.5)
    expect(data.pins).toBeUndefined()
  })

  it('overlayPinPoseAt is the host-side mirror of the baked track', () => {
    const doc = makeDoc({
      zoom: [
        {
          id: 'z1',
          in: 2.5,
          out: 4.5,
          level: 1.8,
          cx: 0.86,
          cy: 0.11,
          source: 'manual',
        },
      ],
      overlays: [note({ step: 'copy', side: 'below' })],
    })
    const layout = docCardLayout(doc)
    const pins = resolvePins(doc, layout, 'stage', docZoomTrack(doc))
    const baked = sample(pins.get('n1')!.track, 1.5, lerpArray)
    const pose = overlayPinPoseAt(doc, doc.overlays![0], 1.5)!
    expect(pose[0]).toBeCloseTo(baked[0], 6)
    expect(pose[1]).toBeCloseTo(baked[1], 6)
    expect(
      overlayPinPoseAt(doc, { ...doc.overlays![0], pin: undefined }, 1.5),
    ).toBeNull()
  })
})

describe('ON_FRAME', () => {
  const W = 1920
  const H = 1080
  const g = globalThis as Record<string, unknown>

  function paint(doc: ProjectDoc, t: number) {
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const ops: { op: string; args: unknown[] }[] = []
    const style: Record<string, unknown> = {}
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient' || key === 'createRadialGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'roundRect')
            return (...args: unknown[]) =>
              ops.push({ op: 'roundRect', args: [...args, style.strokeStyle] })
          if (key in style) return style[key]
          return (...args: unknown[]) =>
            ops.push({
              op: key,
              args: [...args, style.strokeStyle, style.fillStyle],
            })
        },
        set: (_t, key: string, v) => {
          style[key] = v
          return true
        },
      },
    )
    const video = {
      videoWidth: VW,
      videoHeight: VH,
      readyState: 2,
      paused: true,
      currentTime: t,
      duration: 10,
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
    delete g.window
    delete g.__vosTimeline
    return ops
  }

  it('paints the ring around the referent while the layer is up, and nothing outside it', () => {
    const doc = makeDoc({
      overlays: [note({ step: 'copy', mark: 'ring', color: '#7c3aed' })],
    })
    const layout = computeCardLayout(doc.frame, { width: VW, height: VH }, W, H)
    const during = paint(doc, 3.5)
    const rings = during.filter(
      (o) => o.op === 'roundRect' && o.args[5] === '#7c3aed',
    )
    expect(rings).toHaveLength(1)
    const [x, y, w, h] = rings[0].args as number[]
    const refX = layout.dx + (COPY.x / VW) * layout.dw
    const refW = (COPY.w / VW) * layout.dw
    // pad 6 design px at s = 1, cf = 1 (16:9 footage at 16:9)
    expect(x).toBeCloseTo(refX - 6, 1)
    expect(w).toBeCloseTo(refW + 12, 1)
    expect(y).toBeLessThan(layout.dy + (COPY.y / VH) * layout.dh)
    expect(h).toBeGreaterThan(0)
    const before = paint(doc, 1)
    expect(
      before.filter((o) => o.op === 'roundRect' && o.args[5] === '#7c3aed'),
    ).toHaveLength(0)
  })

  it('draws the leader from the tip to the referent edge, with the dot at the referent', () => {
    const doc = makeDoc({
      overlays: [note({ step: 'copy', leader: true, color: '#7c3aed' })],
    })
    const ops = paint(doc, 3.5)
    const lines = ops.filter(
      (o) => o.op === 'lineTo' && o.args[2] === '#7c3aed',
    )
    expect(lines).toHaveLength(1)
    const dots = ops.filter((o) => o.op === 'arc' && o.args[6] === '#7c3aed')
    expect(dots).toHaveLength(1)
    // the referent end is the left edge midpoint (side left, the Copy button top-right)
    const layout = computeCardLayout(doc.frame, { width: VW, height: VH }, W, H)
    const [lx, ly] = lines[0].args as number[]
    expect(lx).toBeCloseTo(layout.dx + (COPY.x / VW) * layout.dw, 1)
    expect(ly).toBeCloseTo(
      layout.dy + ((COPY.y + COPY.h / 2) / VH) * layout.dh,
      1,
    )
    expect((dots[0].args as number[])[0]).toBeCloseTo(lx, 3)
  })
})
