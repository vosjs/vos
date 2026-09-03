/**
 * A backdrop is the loop (or still) a frame opens on, together with its
 * GROUND: the loop's average colour, written into `frame.background` so
 * the frame before the first decoded frame, the reduced-motion still and
 * the offline fail-open all land on the loop's own colour instead of
 * whatever the frame carried before.
 *
 * WHICH backdrop a new take opens on is the host's decision, never this
 * package's: the studio hands its pick to `projectFromArtifact` as `frame`,
 * the CLI reads the set the platform publishes. The document model carries
 * the mechanism only, so the default here is a frame with no backdrop.
 * A doc that already carries a frame is never touched either way.
 */
import type { BackgroundMedia, FrameStyle } from './types'

export interface Backdrop {
  /** The loop's URL, or a take-dir path (`/bg.webm`). */
  key: string
  /** `video` unless said otherwise. */
  kind?: BackgroundMedia['kind']
  /** The loop's period in seconds, a fact of the asset. Video only. */
  duration?: number
  /** A still to show before the first decoded frame and under reduced motion. */
  poster?: string
  /**
   * The loop's average colour. Written as `frame.background` when given; a
   * backdrop without one keeps the frame's own fill under it.
   */
  ground?: string
}

/** A backdrop as a doc's `frame.backgroundMedia`. */
export function backdropMedia(backdrop: Backdrop): BackgroundMedia {
  return {
    kind: backdrop.kind ?? 'video',
    key: backdrop.key,
    ...(backdrop.duration !== undefined ? { duration: backdrop.duration } : {}),
    ...(backdrop.poster ? { poster: backdrop.poster } : {}),
    dim: 0,
  }
}

/**
 * A frame opening on a backdrop: the media, and its ground when it has one,
 * in one write. Everything else on the frame is kept.
 */
export function withBackdrop(
  frame: FrameStyle,
  backdrop: Backdrop,
): FrameStyle {
  return {
    ...frame,
    ...(backdrop.ground ? { background: backdrop.ground } : {}),
    backgroundMedia: backdropMedia(backdrop),
  }
}
