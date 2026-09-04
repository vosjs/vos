/**
 * Host-side mirror of ON_FRAME's card layout + the focus-space zoom clamp.
 *
 * ON_FRAME (lowerToComposition) is generated code — it computes the card rect
 * (padding, browser-bar strip, contain-fit) inline each frame. These pure
 * helpers duplicate that math for host consumers: focus clamping at lowering
 * time, and the preview focus-region overlay + the inspector's X/Y %
 * mapping. `layout.test.ts` pins the two implementations together — change
 * them TOGETHER or the overlay drifts from the rendered zoom.
 *
 * Clamping lives in normalized focus space (the OpenScreen trick): one bounds
 * function serves the camera, the overlay rect, and the % inputs, so "0%"
 * always means "camera flush against the card edge" at any zoom level.
 */
import {
  EXPORT_RESOLUTION_OPTIONS,
  aspectRatioValue,
  clampZoomLevel,
  resolveExportSize,
} from './types'
import type {
  CamStyle,
  ExportResolution,
  FrameStyle,
  ProjectDoc,
} from './types'

export interface CardLayout {
  /** canvas size the layout was computed for (comp px). */
  W: number
  H: number
  /** video destination rect, comp px. Contain: the fitted video. Cover
   *  the cover-scaled video, positioned by frame.focus — it can
   *  overflow the card, which crops it. */
  dx: number
  dy: number
  dw: number
  dh: number
  /** card rect = browser-bar strip + footage area — what the zoom must keep
   *  covering. Contain: cardX/cardW equal dx/dw. Cover: the padded area
   *  itself, which the video rect overflows. */
  cardX: number
  cardY: number
  cardW: number
  cardH: number
}

/**
 * Mirror of ON_FRAME's destination-rect math (see the "video destination rect"
 * block in lowerToComposition's ON_FRAME string). `video` is the source's
 * pixel size — only its aspect matters (contain-fit scales it).
 */
export function computeCardLayout(
  frame: FrameStyle,
  video: { width: number; height: number },
  W: number,
  H: number,
): CardLayout {
  const s = H / 1080 // scale design-px controls to comp px (same rule as ON_FRAME)
  const pad = (frame.padding || 0) * s
  // Per-side placement (MIRRORS ON_FRAME): frame.inset fractions override
  // the symmetric padding on the sides they name; a negative side bleeds.
  const ins = frame.inset ?? {}
  const padL = ins.left == null ? pad : ins.left * W
  const padR = ins.right == null ? pad : ins.right * W
  const padT = ins.top == null ? pad : ins.top * H
  const padB = ins.bottom == null ? pad : ins.bottom * H
  const bar = frame.browserBar
  const vw = video.width || 16
  const vh = video.height || 9
  // Card-chrome scale (MIRRORS ON_FRAME — change together): card-owned sizes
  // (the browser bar here) shrink with the card when the frame is narrower
  // than the footage; exactly 1 at native/wider aspects, so native layouts are
  // untouched. Under cover the card is as wide as the frame allows, so cf = 1.
  const fitCover = frame.fit === 'cover'
  const cf = fitCover ? 1 : Math.min(1, W / H / (vw / vh))
  const barH = bar.kind !== 'none' ? (bar.height || 44) * s * cf : 0
  const availW = Math.max(1, W - padL - padR)
  const availH = Math.max(1, H - padT - padB - barH)
  if (fitCover) {
    // Cover (MIRRORS ON_FRAME): the padded area is the card; the video
    // cover-fills it, positioned by frame.focus and clamped gap-free.
    const sc = Math.max(availW / vw, availH / vh)
    const dw = vw * sc
    const dh = vh * sc
    const fcx = clamp01(frame.focus?.cx ?? 0.5)
    const fcy = clamp01(frame.focus?.cy ?? 0.5)
    const vTop = padT + barH
    const dx = Math.min(
      padL,
      Math.max(padL + availW - dw, padL + availW / 2 - fcx * dw),
    )
    const dy = Math.min(
      vTop,
      Math.max(vTop + availH - dh, vTop + availH / 2 - fcy * dh),
    )
    return {
      W,
      H,
      dx,
      dy,
      dw,
      dh,
      cardX: padL,
      cardY: padT,
      cardW: availW,
      cardH: availH + barH,
    }
  }
  const sc = Math.min(availW / vw, availH / vh)
  const dw = vw * sc
  const dh = vh * sc
  // Centred inside the inset area: (W - dw) / 2 when no side is inset.
  const dx = padL + (availW - dw) / 2
  const dy = padT + barH + (availH - dh) / 2
  return {
    W,
    H,
    dx,
    dy,
    dw,
    dh,
    cardX: dx,
    cardY: dy - barH,
    cardW: dw,
    cardH: dh + barH,
  }
}

/**
 * The doc's card layout at design size (H = 1080, W from the output aspect).
 * All layout terms scale linearly with the canvas at a fixed aspect, so the
 * normalized focus bounds computed from this layout hold at ANY render size.
 *
 * Viewport-cropped window takes need no special casing here: normalization
 * rewrote meta.captureWidth/Height to the CROP dims, which is exactly what
 * ON_FRAME uses as source dims when `d.crop` is set (crp.w/crp.h) — the
 * golden contract holds through the crop.
 */
export function docCardLayout(
  doc: Pick<ProjectDoc, 'frame' | 'source'>,
): CardLayout {
  const meta = doc.source.meta
  const H = 1080
  const W = Math.max(
    2,
    Math.round(H * aspectRatioValue(doc.frame.aspectRatio, meta)),
  )
  return computeCardLayout(
    doc.frame,
    {
      width: meta.captureWidth ?? meta.width,
      height: meta.captureHeight ?? meta.height,
    },
    W,
    H,
  )
}

/**
 * Largest export preset whose footage card still gets ≥1 captured px per output
 * px. The composited chrome (background, bar, cursor, effects) is vector-drawn
 * and real at any size; the footage layer is bounded by capture pixels, so
 * presets above this one upscale the footage (the picker labels them, never
 * hides them). Judged on the width of
 * the contain-fitted card at each preset's output size vs meta.captureWidth
 * (crop-space when a viewport crop applies — ingest rewrote meta to crop dims).
 * Floors at the smallest preset for tiny captures.
 */
export function recommendedExportResolution(
  doc: Pick<ProjectDoc, 'frame' | 'source' | 'export'>,
): ExportResolution {
  const meta = doc.source.meta
  const capW = meta.captureWidth ?? meta.width
  const video = { width: capW, height: meta.captureHeight ?? meta.height }
  let best = EXPORT_RESOLUTION_OPTIONS[0]
  for (const r of EXPORT_RESOLUTION_OPTIONS) {
    const { width, height } = resolveExportSize(doc, r)
    // Card size grows linearly with output size at fixed aspect → first fail ends it.
    if (computeCardLayout(doc.frame, video, width, height).dw > capW) break
    best = r
  }
  return best
}

export interface CamBubbleRect {
  /** top-left corner of the bubble's square, design px (docCardLayout space). */
  x: number
  y: number
  /** the square's side — the bubble diameter. */
  size: number
  /** corner radius (size/2 for circles, the fixed rounded radius otherwise). */
  radius: number
}

/**
 * Host-side mirror of ON_FRAME's webcam-bubble geometry (the "webcam bubble"
 * block in lowerToComposition) — the picking oracle for the on-canvas cam
 * layer. Same design space as docCardLayout (H = 1080), and like ON_FRAME the
 * bubble is FRAME-owned chrome: everything scales by s = H/1080, never the
 * card-chrome cf. The bubble ignores card tilt/zoom (it paints on the
 * screen-space overlay plane), so this rect is valid under any camera pose.
 * camDraw.test.ts pins this to the painted geometry — change them TOGETHER.
 */
export function camBubbleRect(
  cam: CamStyle,
  W: number,
  H = 1080,
): CamBubbleRect {
  const s = H / 1080
  const size = Math.max(40, (cam.size || 0.25) * H)
  const mg = 24 * s
  // Free placement wins over the corner anchor — mirrors ON_FRAME.
  const x =
    cam.x != null
      ? cam.x * W - size / 2
      : cam.position.includes('right')
        ? W - mg - size
        : mg
  const y =
    cam.y != null
      ? cam.y * H - size / 2
      : cam.position.includes('top')
        ? mg
        : H - mg - size
  return {
    x,
    y,
    size,
    radius: cam.shape === 'rounded' ? (cam.radius ?? 18) * s : size / 2,
  }
}

export interface FocusBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Focus bounds (normalized video coords) so the zoomed CARD covers the whole
 * canvas — the crop never reveals background past a card edge at full zoom.
 *
 * Derivation: ON_FRAME's transform maps content point p → f + (p − f)·L around
 * the focus anchor f (fx = dx + zx·dw), so the visible canvas [0, V] shows
 * content [f − f/L, f + (V − f)/L]. Requiring that window ⊆ the cover range
 * [o, o + c] and solving for the anchor (k = 1 − 1/L):
 *
 *   f ≥ o / k          and          f ≤ (o + c − V/L) / k
 *
 * When the zoomed card is too small to cover the canvas (low level + padding),
 * the bounds cross — collapse to their midpoint (the least-uncovered focus;
 * 0.5 for a centered card, matching OpenScreen's margin collapse).
 */
export function focusBounds(level: number, layout: CardLayout): FocusBounds {
  if (level <= 1.001) {
    // Identity transform — focus is irrelevant; pin to center like OpenScreen
    // (margin = min(0.5, ratio/2L) also collapses to [0.5, 0.5] at L = 1).
    return { minX: 0.5, maxX: 0.5, minY: 0.5, maxY: 0.5 }
  }
  const x = axisBounds(
    layout.dx,
    layout.dw,
    layout.cardX,
    layout.cardW,
    layout.W,
    level,
  )
  const y = axisBounds(
    layout.dy,
    layout.dh,
    layout.cardY,
    layout.cardH,
    layout.H,
    level,
  )
  return { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max }
}

/**
 * One axis of focusBounds. The focus is normalized over the ANCHOR rect (the
 * video: cx/cy ∈ [0,1] of it) while coverage is demanded of the COVER rect
 * (the card — bar included, since bar + video zoom together).
 */
function axisBounds(
  anchorOff: number,
  anchorSize: number,
  coverOff: number,
  coverSize: number,
  viewport: number,
  level: number,
): { min: number; max: number } {
  const k = 1 - 1 / level
  let lo = (coverOff / k - anchorOff) / anchorSize
  let hi =
    ((coverOff + coverSize - viewport / level) / k - anchorOff) / anchorSize
  if (lo > hi) {
    const mid = (lo + hi) / 2
    lo = mid
    hi = mid
  }
  return { min: clamp01(lo), max: clamp01(hi) }
}

/** Clamp a focus point into the bounds for its zoom level. */
export function clampFocus(
  cx: number,
  cy: number,
  level: number,
  layout: CardLayout,
): { cx: number; cy: number } {
  const b = focusBounds(level, layout)
  return {
    cx: Math.min(b.maxX, Math.max(b.minX, cx)),
    cy: Math.min(b.maxY, Math.max(b.minY, cy)),
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * The zoom level a focus rect of this canvas-fraction size
 * means — the aiming rect's size is purely 1/level, so a corner drag IS a
 * level drag, and this is the inverse. Floored a hair above the identity so
 * a drag can never reach level ≈ 1 and dismiss the aiming rect mid-gesture;
 * clamped and quantized like every stored level (clampZoomLevel).
 */
export function levelForFocusFraction(frac: number): number {
  if (!(frac > 0)) return clampZoomLevel(Number.POSITIVE_INFINITY)
  return clampZoomLevel(Math.max(1.1, 1 / frac))
}
