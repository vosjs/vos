/**
 * The framing check: does a zoom span's visible window contain the
 * thing it points at? A host-side mirror of ON_FRAME's transform, the same
 * derivation focusBounds uses (layout.ts) — content point p maps to
 * f + (p − f)·L around the anchor f = dx + cx·dw, so the canvas [0, W] shows
 * content [f − f/L, f + (W − f)/L]. `layout.test.ts`'s rule binds: change the
 * two together. Lowering clamps the focus first (clampFocus), so the window
 * is computed from the clamped focus, exactly what renders.
 */
import { clampFocus, zoomViewport } from '../layout'
import type { CameraModel, CardLayout } from '../layout'
import type { NormRect } from './moments'

export interface ZoomWindow {
  x0: number
  x1: number
  y0: number
  y1: number
}

/**
 * The visible window in normalized video coords at `level` around the
 * focus, under the frame's camera model (absent = the magnifier, whose
 * focus is clamped first exactly as the lowering clamps it).
 */
export function zoomWindow(
  span: { level: number; cx: number; cy: number },
  layout: CardLayout,
  camera: CameraModel = 'card',
): ZoomWindow {
  const L = Math.max(1, span.level)
  const { cx, cy } = clampFocus(span.cx, span.cy, L, layout, camera)
  const v = zoomViewport(L, cx, cy, layout, camera)
  const px0 = v.x * layout.W
  const px1 = (v.x + v.w) * layout.W
  const py0 = v.y * layout.H
  const py1 = (v.y + v.h) * layout.H
  return {
    x0: (px0 - layout.dx) / layout.dw,
    x1: (px1 - layout.dx) / layout.dw,
    y0: (py0 - layout.dy) / layout.dh,
    y1: (py1 - layout.dy) / layout.dh,
  }
}

/**
 * True when the rect (normalized) sits inside the zoom's visible window, with
 * `tol` of slack per edge (frame fractions). A level ≤ 1 zoom shows the whole
 * frame and covers everything.
 */
export function zoomCoversRect(
  span: { level: number; cx: number; cy: number },
  rect: NormRect,
  layout: CardLayout,
  tol = 0.02,
  camera: CameraModel = 'card',
): boolean {
  if (span.level <= 1.001) return true
  const w = zoomWindow(span, layout, camera)
  return (
    rect.x >= w.x0 - tol &&
    rect.x + rect.w <= w.x1 + tol &&
    rect.y >= w.y0 - tol &&
    rect.y + rect.h <= w.y1 + tol
  )
}
