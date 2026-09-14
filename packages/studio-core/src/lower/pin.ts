/**
 * Pinned layers — a layer placed beside its REFERENT and carried with it as
 * the camera moves it on screen.
 *
 * A callout is a statement bound to the thing it is about. The binding is
 * proximity (the layer sits a gap off one side of the referent), a connector
 * (an optional leader) and a mark on the subject (an optional ring or
 * underline). Nothing here paints: the placement is resolved at lowering
 * into the clip's ordinary motion track — the same clip-local
 * [x, y, scale, rotation, opacity] track a `motion` pose bakes to — so the
 * studio entry that paints layers stays camera-blind, picking in the
 * studio reads the same numbers, and every renderer (preview, export,
 * chunk, still) agrees by construction.
 *
 * The referent lives in the recording's cursor space (normalised video
 * fractions); the camera is the one function `layout.ts` pins to ON_FRAME
 * (`zoomView`), sampled from the OUTPUT-time zoom track at PIN_SAMPLE_HZ
 * through the layer's life and simplified to the samples a linear
 * interpolation cannot predict. The layer's SIZE stays screen-space: a
 * callout is the video's, not the app's, so it never shrinks with the app;
 * only its place follows.
 */
import { lerpArray, sample } from '@vosjs/timeline'
import { htmlLayerPictureBox, htmlLayerWidth } from '../htmlLayer'
import { zoomView } from '../layout'
import { overlayRect } from '../overlayText'
import { OVERLAY_MEDIA_DEFAULT_WIDTH } from '../types'
import type { Keyframe, KeyframeTrack } from '@vosjs/timeline'
import type { CameraModel, CardLayout } from '../layout'
import type {
  OverlayClip,
  OverlayPin,
  PinSide,
  ProjectDoc,
  Rect,
  StepSpan,
} from '../types'

/** Design px between the referent and the layer's visible box. */
export const PIN_GAP = 24
/** Design px the layer keeps from the frame's edge. */
export const PIN_MARGIN = 24
/** Placement samples per output second through the layer's life. */
export const PIN_SAMPLE_HZ = 30
/** Design px a sample may deviate from its neighbours' line and be dropped. */
export const PIN_SIMPLIFY_PX = 0.5
/** The layer's own entrance/exit length (mirrors the entry's olTD). */
const PIN_EDGE_S = 0.35
/** A press counts as "nearest" within this many source seconds. */
const PIN_PRESS_WINDOW_S = 0.5
/** Rough glyph advance for a text layer's box at lowering (no canvas). */
const PIN_TEXT_ADVANCE = 0.55

export type PinSideResolved = Exclude<PinSide, 'auto'>
const SIDE_ORDER: PinSideResolved[] = ['right', 'left', 'below', 'above']

/** The referent's rect in normalised video fractions, and how it was found. */
export interface PinReferent {
  rect: Rect
  by: 'step' | 'press' | 'rect'
  /** The step that named it, when `by` is 'step'. */
  step?: StepSpan
  /** SOURCE second the referent was measured at (a step's start, the press). */
  at: number | null
}

/**
 * Find a pin's referent in the recording. A `step` reads the step's own
 * rect (the recorder measures every selector step's box), else the union
 * of the presses inside the step's window (`down` and `key` events carry
 * the element's rect), so a take recorded before the recorder kept step
 * rects still resolves. A `press` is the nearest press to that source
 * second. A `rect` is taken as written. Null when nothing names a rect.
 */
export function pinReferent(
  doc: ProjectDoc,
  pin: OverlayPin,
): PinReferent | null {
  const meta = doc.source.meta
  const w = meta.width || 0
  const h = meta.height || 0
  if (pin.rect && validRect(pin.rect)) {
    return { rect: { ...pin.rect }, by: 'rect', at: null }
  }
  if (pin.step !== undefined) {
    const step = findStep(meta.steps ?? [], pin.step)
    if (!step || step.skipped) return null
    if (step.rect && validRect(step.rect) && w > 0 && h > 0) {
      return {
        rect: normRect(step.rect, w, h),
        by: 'step',
        step,
        at: step.tStart,
      }
    }
    const union = unionRects(
      pressRects(doc, step.tStart - 0.05, step.tEnd + 0.05),
    )
    if (!union || w <= 0 || h <= 0) return null
    return { rect: normRect(union, w, h), by: 'step', step, at: step.tStart }
  }
  if (pin.press !== undefined && Number.isFinite(pin.press)) {
    let best: { t: number; rect: Rect } | null = null
    for (const e of doc.source.cursor) {
      if (e.type !== 'down' || !e.rect || !validRect(e.rect)) continue
      const t = e.t / 1000
      const d = Math.abs(t - pin.press)
      if (d > PIN_PRESS_WINDOW_S) continue
      if (!best || d < Math.abs(best.t - pin.press)) best = { t, rect: e.rect }
    }
    if (!best || w <= 0 || h <= 0) return null
    return { rect: normRect(best.rect, w, h), by: 'press', at: best.t }
  }
  return null
}

/** The step a pin names: its id first, then its record-time index. */
export function findStep(
  steps: readonly StepSpan[],
  ref: string | number,
): StepSpan | undefined {
  const byId = steps.find((s) => s.id !== undefined && s.id === ref)
  if (byId) return byId
  const idx = typeof ref === 'number' ? ref : Number(ref)
  if (!Number.isInteger(idx)) return undefined
  return steps.find((s) => s.step === idx)
}

function pressRects(doc: ProjectDoc, from: number, to: number): Rect[] {
  const out: Rect[] = []
  for (const e of doc.source.cursor) {
    if (e.type !== 'down' && e.type !== 'key') continue
    if (!e.rect || !validRect(e.rect)) continue
    const t = e.t / 1000
    if (t < from || t > to) continue
    out.push(e.rect)
  }
  return out
}

function unionRects(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function validRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h) &&
    r.w > 0 &&
    r.h > 0
  )
}

function normRect(r: Rect, w: number, h: number): Rect {
  return { x: r.x / w, y: r.y / h, w: r.w / w, h: r.h / h }
}

/**
 * The layer's VISIBLE box in design px at scale 1 — the part a viewer reads
 * as the card. An html layer's picture carries transparent bleed around its
 * design box (the room its shadow paints in); the gap is measured from the
 * box, never the bleed, or a shadowed card reads as standing off. A text
 * layer is measured with a rough advance (there is no canvas at lowering);
 * a media layer assumes 16:9 until its bytes are known.
 */
export function pinBox(
  clip: OverlayClip,
  layout: CardLayout,
): { w: number; h: number } {
  const scale = clip.transform.scale || 1
  if (clip.kind === 'html') {
    const pb = htmlLayerPictureBox(clip)
    const wPic = htmlLayerWidth(clip) * layout.W * scale
    const unit = wPic / pb.width
    return { w: clip.box.width * unit, h: clip.box.height * unit }
  }
  if (clip.kind !== 'text') {
    const w = (clip.width ?? OVERLAY_MEDIA_DEFAULT_WIDTH) * layout.W * scale
    return { w, h: w / (16 / 9) }
  }
  const r = overlayRect(clip, estimateMeasure, layout.W, layout.H)
  return { w: r.w, h: r.h }
}

function estimateMeasure(
  text: string,
  font: string,
  letterSpacingPx = 0,
): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font)
  const px = m ? Number(m[1]) : 16
  return text.length * (px * PIN_TEXT_ADVANCE + letterSpacingPx)
}

/**
 * A rect in normalised video fractions as the camera shows it at OUTPUT
 * time t, in design px: the zoom track sampled at t, mapped through
 * zoomView (the one camera function ON_FRAME mirrors).
 */
export function pinRectOnScreen(
  rect: Rect,
  t: number,
  layout: CardLayout,
  camera: CameraModel,
  zoomTrack?: KeyframeTrack<number[]> | null,
): Rect {
  let level = 1
  let cx = 0.5
  let cy = 0.5
  let centring: number | undefined
  if (zoomTrack && zoomTrack.keyframes.length) {
    const z = sample(zoomTrack, t, lerpArray)
    level = z[0]
    cx = z[1]
    cy = z[2]
    if (z.length > 3) centring = z[3]
  }
  const v = zoomView(level, cx, cy, layout, camera, centring)
  const map = (nx: number, ny: number) => {
    const px = layout.dx + nx * layout.dw
    const py = layout.dy + ny * layout.dh
    return {
      x: v.ox + (px - v.wcx) * v.level,
      y: v.oy + (py - v.wcy) * v.level,
    }
  }
  const a = map(rect.x, rect.y)
  const b = map(rect.x + rect.w, rect.y + rect.h)
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y }
}

export interface PinPlacementInput {
  clip: OverlayClip
  referent: Rect
  layout: CardLayout
  camera: CameraModel
  /** The OUTPUT-time zoom track ([level, cx, cy, centring?]); absent = no camera. */
  zoomTrack?: KeyframeTrack<number[]> | null
  /** The clip's base [x, y, scale, rotation, opacity]. */
  base: readonly number[]
  /** The clip's own motion track, for scale, rotation and opacity. */
  motion?: KeyframeTrack<number[]> | null
}

export interface PinPlacement {
  side: PinSideResolved
  /** Clip-local [x, y, scale, rotation, opacity] in frame fractions. */
  track: KeyframeTrack<number[]>
  /** Clip-local [x, y] of the leader's tip: the layer's near-edge midpoint. */
  tip: KeyframeTrack<number[]>
  /** The most the layer had to move, in design px, to stay inside the frame. */
  clamped: number
  /** The layer's visible box in design px. */
  box: { w: number; h: number }
}

/**
 * Place a pinned layer through its life. The referent is mapped through the
 * camera at each sample; the layer's centre sits a gap off the chosen side;
 * the centre is clamped inside the frame's margin; the samples are
 * simplified. `side: 'auto'` is decided ONCE (never per frame, so the layer
 * cannot flip sides mid-life): the first side in order whose box fits at
 * the layer's start, middle and end, else the side with the most room.
 */
export function pinPlacement(input: PinPlacementInput): PinPlacement {
  const { clip, referent, layout, camera, zoomTrack, base, motion } = input
  const dur = Math.max(0.001, clip.duration)
  const gap = clip.pin?.gap ?? PIN_GAP
  const box = pinBox(clip, layout)
  const W = layout.W
  const H = layout.H

  const refAt = (local: number): Rect =>
    pinRectOnScreen(referent, clip.start + local, layout, camera, zoomTrack)

  const centreFor = (r: Rect, side: PinSideResolved) => {
    switch (side) {
      case 'right':
        return { x: r.x + r.w + gap + box.w / 2, y: r.y + r.h / 2 }
      case 'left':
        return { x: r.x - gap - box.w / 2, y: r.y + r.h / 2 }
      case 'below':
        return { x: r.x + r.w / 2, y: r.y + r.h + gap + box.h / 2 }
      case 'above':
        return { x: r.x + r.w / 2, y: r.y - gap - box.h / 2 }
    }
  }
  const fits = (c: { x: number; y: number }) =>
    c.x - box.w / 2 >= PIN_MARGIN &&
    c.x + box.w / 2 <= W - PIN_MARGIN &&
    c.y - box.h / 2 >= PIN_MARGIN &&
    c.y + box.h / 2 <= H - PIN_MARGIN
  const room = (c: { x: number; y: number }) => {
    const x0 = Math.max(PIN_MARGIN, c.x - box.w / 2)
    const x1 = Math.min(W - PIN_MARGIN, c.x + box.w / 2)
    const y0 = Math.max(PIN_MARGIN, c.y - box.h / 2)
    const y1 = Math.min(H - PIN_MARGIN, c.y + box.h / 2)
    return Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  }

  let side: PinSideResolved
  const asked = clip.pin?.side ?? 'auto'
  if (asked !== 'auto') side = asked
  else {
    const edge = Math.min(PIN_EDGE_S, dur / 3)
    const probes = [edge, dur / 2, dur - edge].map(refAt)
    const fitting = SIDE_ORDER.find((s) =>
      probes.every((r) => fits(centreFor(r, s))),
    )
    if (fitting) side = fitting
    else {
      let best: PinSideResolved = SIDE_ORDER[0]
      let bestRoom = -1
      for (const s of SIDE_ORDER) {
        const total = probes.reduce((acc, r) => acc + room(centreFor(r, s)), 0)
        if (total > bestRoom) {
          bestRoom = total
          best = s
        }
      }
      side = best
    }
  }

  const clampC = (c: { x: number; y: number }) => {
    const minX = Math.min(W / 2, PIN_MARGIN + box.w / 2)
    const maxX = Math.max(W / 2, W - PIN_MARGIN - box.w / 2)
    const minY = Math.min(H / 2, PIN_MARGIN + box.h / 2)
    const maxY = Math.max(H / 2, H - PIN_MARGIN - box.h / 2)
    return {
      x: Math.max(minX, Math.min(maxX, c.x)),
      y: Math.max(minY, Math.min(maxY, c.y)),
    }
  }
  const tipFor = (c: { x: number; y: number }) => {
    switch (side) {
      case 'right':
        return { x: c.x - box.w / 2, y: c.y }
      case 'left':
        return { x: c.x + box.w / 2, y: c.y }
      case 'below':
        return { x: c.x, y: c.y - box.h / 2 }
      case 'above':
        return { x: c.x, y: c.y + box.h / 2 }
    }
  }

  const n = Math.max(1, Math.ceil(dur * PIN_SAMPLE_HZ))
  const poses: Keyframe<number[]>[] = []
  const tips: Keyframe<number[]>[] = []
  let clamped = 0
  for (let i = 0; i <= n; i++) {
    const local = i === n ? dur : i / PIN_SAMPLE_HZ
    const want = centreFor(refAt(local), side)
    const c = clampC(want)
    clamped = Math.max(clamped, Math.hypot(c.x - want.x, c.y - want.y))
    const pose = motion?.keyframes.length
      ? sample(motion, local, lerpArray)
      : base
    poses.push({
      t: local,
      value: [c.x / W, c.y / H, pose[2], pose[3], pose[4]],
      ease: 'linear',
    })
    const tp = tipFor(c)
    tips.push({ t: local, value: [tp.x / W, tp.y / H], ease: 'linear' })
  }
  return {
    side,
    track: { keyframes: simplify(poses, [W, H, 1, 1, 1]) },
    tip: { keyframes: simplify(tips, [W, H]) },
    clamped: round(clamped),
    box,
  }
}

/**
 * Drop every sample its neighbours' straight line predicts within
 * PIN_SIMPLIFY_PX (per component, scaled to design px by `scalePx`): a hold
 * collapses to its two ends, a smooth ease keeps the samples its curvature
 * needs. The first and the last sample always stay.
 */
export function simplify(
  keys: readonly Keyframe<number[]>[],
  scalePx: readonly number[],
): Keyframe<number[]>[] {
  if (keys.length <= 2) return keys.map(roundKey)
  const out: Keyframe<number[]>[] = [roundKey(keys[0])]
  let a = 0
  for (let i = 2; i <= keys.length - 1; i++) {
    // Would the line a → i predict every sample strictly between them?
    const ka = keys[a]
    const ki = keys[i]
    let ok = true
    for (let j = a + 1; j < i && ok; j++) {
      const kj = keys[j]
      const u = (kj.t - ka.t) / (ki.t - ka.t || 1)
      for (let k = 0; k < kj.value.length; k++) {
        const pred = ka.value[k] + (ki.value[k] - ka.value[k]) * u
        if (
          Math.abs(pred - kj.value[k]) * (scalePx[k] ?? 1) >
          PIN_SIMPLIFY_PX
        ) {
          ok = false
          break
        }
      }
    }
    if (!ok) {
      a = i - 1
      out.push(roundKey(keys[a]))
    }
  }
  const last = keys[keys.length - 1]
  if (out[out.length - 1].t !== round(last.t)) out.push(roundKey(last))
  return out
}

function roundKey(k: Keyframe<number[]>): Keyframe<number[]> {
  return { t: round(k.t), value: k.value.map(round4), ease: k.ease }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
function round4(v: number): number {
  return Math.round(v * 100000) / 100000
}
