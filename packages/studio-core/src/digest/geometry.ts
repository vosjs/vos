/**
 * The digest's crop geometry, pure and shared by the CLI's page and
 * the fleet's page: cursor/meta coords are CSS px of the viewport (or the
 * crop space when `source.crop` is set); the frame is capture px. A window
 * take's crop applies to the FRAME, never to the already-cropped cursor
 * coords. Both hosts compute boxes here so the two never drift by a dpr.
 */
import type { ProjectDoc } from '../types'
import type { Moment } from './moments'

export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}

/** A crop box is at least this fraction of the frame width (floor 320px). */
export const CROP_MIN_FRAC = 0.25
export const CROP_MIN_PX = 320
export const CROP_MAX_PX = 1024
export const CROP_PAD = 0.25
/** Default long edges (px) of the emitted images — the agent's token budget. */
export const DIGEST_FULL_MAX = 960
export const DIGEST_CROP_MAX = 640
/** Changed-pixel threshold (luma, 0..255) for the motion bins. */
export const MOTION_DELTA = 24

export interface FrameGeometry {
  /** The region of the frame the doc renders (the viewport crop, or all). */
  region: PxRect
  /** Cursor px → frame px. */
  scale: number
}

/** The frame's pixel size when no decode has told us: capture px, else CSS×dpr. */
export function expectedFrameSize(doc: ProjectDoc): {
  width: number
  height: number
} {
  const meta = doc.source.meta
  const dpr = meta.dpr > 0 ? meta.dpr : 1
  return {
    width: meta.captureWidth ?? Math.round(meta.width * dpr),
    height: meta.captureHeight ?? Math.round(meta.height * dpr),
  }
}

export function frameGeometry(
  doc: ProjectDoc,
  frameW: number,
  frameH: number,
): FrameGeometry {
  const meta = doc.source.meta
  const crop = doc.source.crop
  const region: PxRect = crop
    ? {
        x: Math.max(0, Math.round(crop.x)),
        y: Math.max(0, Math.round(crop.y)),
        w: Math.min(frameW, Math.round(crop.w)),
        h: Math.min(frameH, Math.round(crop.h)),
      }
    : { x: 0, y: 0, w: frameW, h: frameH }
  return { region, scale: region.w / Math.max(1, meta.width) }
}

/** The crop box (frame px) around a moment's rect or focus point, or null. */
export function cropBox(
  m: Pick<Moment, 'rect' | 'focus'>,
  geo: FrameGeometry,
  meta: { width: number; height: number },
): PxRect | null {
  if (!m.rect && !m.focus) return null
  const { region, scale } = geo
  const toPx = (nx: number, ny: number) => ({
    x: region.x + nx * meta.width * scale,
    y: region.y + ny * meta.height * scale,
  })
  let x0: number
  let y0: number
  let x1: number
  let y1: number
  if (m.rect) {
    const a = toPx(m.rect.x, m.rect.y)
    const b = toPx(m.rect.x + m.rect.w, m.rect.y + m.rect.h)
    const pad = CROP_PAD * Math.max(b.x - a.x, b.y - a.y)
    x0 = a.x - pad
    y0 = a.y - pad
    x1 = b.x + pad
    y1 = b.y + pad
  } else {
    const p = toPx(m.focus!.cx, m.focus!.cy)
    x0 = x1 = p.x
    y0 = y1 = p.y
  }
  const min = Math.max(CROP_MIN_PX, CROP_MIN_FRAC * region.w)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  let w = Math.max(min, x1 - x0)
  let h = Math.max(min, y1 - y0)
  const cap = Math.min(CROP_MAX_PX, region.w, region.h)
  if (Math.max(w, h) > cap) {
    const s = cap / Math.max(w, h)
    w *= s
    h *= s
  }
  let x = cx - w / 2
  let y = cy - h / 2
  x = Math.max(region.x, Math.min(x, region.x + region.w - w))
  y = Math.max(region.y, Math.min(y, region.y + region.h - h))
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(Math.min(w, region.w)),
    h: Math.round(Math.min(h, region.h)),
  }
}
