/**
 * Compositor v2 — the layer stage geometry.
 *
 * The stage turns the studio's single fullscreen-ortho quad into a three-layer mesh stack
 * under ONE perspective camera:
 *
 *   overlay quad     screen-space   cam bubble + text/image/video overlays
 *   card mesh        world-space    the existing 2D card painting, on a plane
 *                                   that can TILT (doc.tilt spans)
 *   background quad   screen-space   CSS fill + vos background loop
 *
 * Every layer is a plane placed perpendicular to the camera axis and centered
 * on it, sized to exactly fill the camera frustum at its depth. Perpendicular +
 * centered + frustum-filling ⇒ it projects to the full viewport regardless of
 * depth, so the background/overlay read as flat screen-space and the CARD, at
 * `tilt = 0`, projects PIXEL-IDENTICALLY to today's ortho fullscreen quad. Only
 * the card ever rotates; the perspective camera then gives it real
 * foreshortening (an ortho camera would only skew it).
 *
 * These are pure helpers (no THREE dependency) so the host can mirror the exact
 * projection the runtime draws with — the world-unit basis that
 * on-canvas picking builds on (host picks / instance renders). `stage.test.ts`
 * pins the math; the runtime (lowerToComposition CREATE_CONTENT/ON_FRAME) must
 * use these SAME constants — change them together.
 */

/**
 * Camera field of view (degrees). Deliberately gentle (telephoto-ish product
 * shot) so a card tilt reads as a premium 3D lean, not a fisheye warp. Parity
 * at tilt = 0 is INDEPENDENT of this value (every layer is sized to fill the
 * frustum), so it is a pure aesthetic dial for how dramatic tilt looks.
 */
export const CARD_FOV = 30

/**
 * Layer depths (world units in front of a camera at the origin looking down
 * −z). Absolute values are arbitrary — only the ORDER matters (painter's order
 * is set by renderOrder, not depth) and that near/far bracket them. The card
 * sits between the background (behind) and the overlay (in front).
 */
export const OVERLAY_Z = -2
export const CARD_Z = -4
export const BACKGROUND_Z = -6

/**
 * The card layer's overscan is quantised UP to this step, so a pose that is
 * being scrubbed grows the canvas a few times, not once per tick (a resize
 * reallocates the texture and the plane).
 */
export const CARD_OVERSCAN_STEP = 0.05

/**
 * The most the card layer will grow on an axis. The schema's 45° tilt
 * needs about 2.7 on a 16:9 frame and 3.8 on 21:9; past that the card's
 * receding edge nears the horizon and no finite texture covers it.
 */
export const CARD_OVERSCAN_MAX = 4

export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 100

/**
 * The card mesh's pose, as ON_FRAME sets it: Euler XYZ rotation in DEGREES
 * (`rx` about the horizontal axis, `ry` about the vertical), a uniform
 * `scale` about the frame's centre and a rise `dy` as a fraction of the
 * frame plane's height (the card-pose track's [scale, dy] pair).
 */
export interface CardPose {
  rx: number
  ry: number
  scale?: number
  dy?: number
}

/**
 * How far past each frame edge the card plane is SEEN under a pose, as a
 * multiple of the frame plane's half-size on that axis (1 = the plane's own
 * edge at rest). Each frame corner's viewing ray is intersected with the
 * posed plane and read back in the plane's local units: a receding side
 * shows more plane than the frame is wide, an approaching side less, a
 * smaller card shows more all round. The visible region is the frame's
 * image under a homography, so its bounding box is its four corners'.
 * A corner whose ray no longer meets the plane in front of the camera
 * reads as `CARD_OVERSCAN_MAX`.
 *
 * This is the TypeScript twin of ON_FRAME's card-overscan math (the
 * `okx`/`oky` block in lowerToComposition) — `stage.test.ts` pins the two
 * to a three.js raycast; change them together.
 */
export function cardVisibleExtent(
  pose: CardPose,
  aspect: number,
  fovDeg = CARD_FOV,
): { left: number; right: number; top: number; bottom: number } {
  const D = Math.abs(CARD_Z)
  const hh = D * Math.tan((fovDeg * Math.PI) / 180 / 2)
  const hw = hh * aspect
  const rx = (pose.rx * Math.PI) / 180
  const ry = (pose.ry * Math.PI) / 180
  const sc = Math.max(0.05, pose.scale ?? 1)
  const py = (pose.dy ?? 0) * 2 * hh
  const cx = Math.cos(rx)
  const sx = Math.sin(rx)
  const cy = Math.cos(ry)
  const sy = Math.sin(ry)
  // R = Rx(rx) · Ry(ry), three.js's Euler 'XYZ' with rz = 0, by column.
  const c0 = [cy, sx * sy, -cx * sy]
  const c1 = [0, cx, sx]
  const n = [sy, -sx * cy, cx * cy] // the plane's normal, R · ẑ
  const nDotPos = n[1] * py - n[2] * D
  let left = 0
  let right = 0
  let top = 0
  let bottom = 0
  for (const kx of [-1, 1]) {
    for (const ky of [-1, 1]) {
      const d = [kx * hw, ky * hh, -D]
      const nd = n[0] * d[0] + n[1] * d[1] + n[2] * d[2]
      const lam = nd === 0 ? -1 : nDotPos / nd
      if (!(lam > 0)) {
        left = right = top = bottom = CARD_OVERSCAN_MAX
        continue
      }
      const q = [lam * d[0], lam * d[1] - py, lam * d[2] + D]
      const lx = (c0[0] * q[0] + c0[1] * q[1] + c0[2] * q[2]) / sc / hw
      const ly = (c1[0] * q[0] + c1[1] * q[1] + c1[2] * q[2]) / sc / hh
      left = Math.max(left, -lx)
      right = Math.max(right, lx)
      top = Math.max(top, ly)
      bottom = Math.max(bottom, -ly)
    }
  }
  const cap = (v: number) => Math.min(CARD_OVERSCAN_MAX, v)
  return {
    left: cap(left),
    right: cap(right),
    top: cap(top),
    bottom: cap(bottom),
  }
}

/** Quantise an overscan factor UP to the step, never below 1. */
export function quantiseOverscan(k: number): number {
  if (!(k > 1)) return 1
  // In thousandths, so a value a hair under a step never rounds across it.
  const q =
    Math.ceil(
      Math.round((k + CARD_OVERSCAN_STEP / 10) * 1000) /
        (CARD_OVERSCAN_STEP * 1000),
    ) * CARD_OVERSCAN_STEP
  return Math.min(CARD_OVERSCAN_MAX, Math.round(q * 1000) / 1000)
}

/**
 * The card layer's overscan budget for a composition: the factor its canvas
 * and plane grow by on each axis, about the frame's centre, so that at
 * every pose the two tracks can reach the frame sees painted card and
 * never the texture's edge. The budget is the extent at the tracks'
 * EXTREMES (the largest lean on each axis, the smallest scale, the
 * largest rise, every sign), which bounds every interpolated frame because
 * the extent grows with each of them. `[1, 1]` for a card that never moves,
 * which is pixel-identical to a plane that fills the frame.
 *
 * Twin of the ON_FRAME block; see `cardVisibleExtent`.
 */
export function cardOverscanFor(
  tilt: { keyframes: { value: number[] }[] } | null | undefined,
  pose: { keyframes: { value: number[] }[] } | null | undefined,
  aspect: number,
  fovDeg = CARD_FOV,
): [number, number] {
  let rxM = 0
  let ryM = 0
  for (const k of tilt?.keyframes ?? []) {
    rxM = Math.max(rxM, Math.abs(k.value[0] || 0))
    ryM = Math.max(ryM, Math.abs(k.value[1] || 0))
  }
  let scMin = 1
  let dyM = 0
  for (const k of pose?.keyframes ?? []) {
    scMin = Math.min(scMin, k.value[0] ?? 1)
    dyM = Math.max(dyM, Math.abs(k.value[1] || 0))
  }
  if (rxM === 0 && ryM === 0 && scMin >= 1 && dyM === 0) return [1, 1]
  let kx = 1
  let ky = 1
  for (const sr of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sd of [-1, 1]) {
        const e = cardVisibleExtent(
          { rx: sr * rxM, ry: sy * ryM, scale: scMin, dy: sd * dyM },
          aspect,
          fovDeg,
        )
        kx = Math.max(kx, e.left, e.right)
        ky = Math.max(ky, e.top, e.bottom)
      }
    }
  }
  return [quantiseOverscan(kx), quantiseOverscan(ky)]
}

export interface PlaneSize {
  width: number
  height: number
}

/**
 * The world-space size of a plane that exactly fills a perspective camera's
 * frustum at `|distance|` in front of it. Height subtends the full vertical FOV;
 * width follows the viewport aspect. This is the one sizing primitive the whole
 * stack shares — every layer plane, and the host-side projection basis for
 * picking, derive from it.
 */
export function planeSizeAtDepth(
  distance: number,
  fovDeg: number,
  aspect: number,
): PlaneSize {
  const height = 2 * Math.abs(distance) * Math.tan((fovDeg * Math.PI) / 180 / 2)
  return { width: height * aspect, height }
}

/**
 * Project a point on the (untilted) card plane, given in normalized card-canvas
 * coordinates (u, v ∈ [0,1], v measured from the TOP like a canvas), to
 * normalized screen coordinates (sx, sy ∈ [0,1], sy from the top). At tilt = 0
 * this is the identity — the card fills the viewport — so it is exact for the
 * common case and the basis the tilt/camera matrices extend for
 * on-canvas picking. Kept here so host and runtime never disagree on
 * where the card is.
 */
export function cardPointToScreen(
  u: number,
  v: number,
): { sx: number; sy: number } {
  return { sx: u, sy: v }
}
