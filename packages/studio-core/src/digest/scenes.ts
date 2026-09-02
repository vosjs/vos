/**
 * Scene changes from the digest's motion bins: a SOURCE second whose
 * changed-pixel fraction jumps past `motion` after a second at or below
 * `quiet` is a scene — a navigation, a dialog, a page swap. A luma diff, not
 * a scene detector: a video playing inside the page is a permanent change,
 * and the moment kind says `scene`, never "navigation" — the agent looks at
 * the frame to say what it was.
 */
export interface SceneOptions {
  /** Changed-pixel fraction that reads as a change. */
  motion?: number
  /** The bin before must be at or below this. */
  quiet?: number
}

/**
 * Calibrated on a dark-theme CLI take (launch-d2, 2026-08-25): a page swap
 * moved 0.33–0.36 of a 64×36 luma thumb, a click's own ripple ≤0.03 — so a
 * quarter of the pixels is a scene and a tenth is still quiet.
 */
export const SCENE_MOTION = 0.25
export const SCENE_QUIET = 0.1

export function sceneChanges(
  bins: readonly number[],
  opts: SceneOptions = {},
): number[] {
  const motion = opts.motion ?? SCENE_MOTION
  const quiet = opts.quiet ?? SCENE_QUIET
  const out: number[] = []
  for (let i = 1; i < bins.length; i++) {
    if (bins[i] >= motion && bins[i - 1] <= quiet) out.push(i)
  }
  return out
}
