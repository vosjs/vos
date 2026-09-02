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

export const CAMERA_NEAR = 0.1
export const CAMERA_FAR = 100

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
