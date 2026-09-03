/**
 * The DEFAULT backdrop: the house loop every NEW take opens on
 * once the flag below is on. A committed constant, not a live vos, the same
 * way a marketing tile is a deliberate asset push: changing it is a code
 * change with a review, never something an autosave can re-skin.
 *
 * `ground` is the loop's average colour, written into `frame.background` so
 * the frame before the first decoded frame, the reduced-motion still and
 * the offline fail-open all land on the loop's own colour. The keys are the
 * loop's own public objects, which stay in the bucket forever, so a doc that
 * keys them by absolute URL keeps playing whatever the set does later.
 *
 * BACKDROP_DEFAULT_ON is the flip. Docs already carrying a frame are never
 * touched either way.
 */
import type { BackgroundMedia, FrameStyle } from './types'

export const DEFAULT_BACKDROP = {
  slug: 'mesh',
  title: 'Mesh',
  key: 'https://assets.vos.so/backdrops/mesh/1080p.webm',
  key2k: 'https://assets.vos.so/backdrops/mesh/2k.webm',
  poster: 'https://assets.vos.so/backdrops/mesh/poster.webp',
  duration: 12,
  ground: '#bab8dc',
} as const

export const BACKDROP_DEFAULT_ON = true as boolean

/** The default backdrop as a doc's `frame.backgroundMedia`. */
export function defaultBackdropMedia(): BackgroundMedia {
  return {
    kind: 'video',
    key: DEFAULT_BACKDROP.key,
    duration: DEFAULT_BACKDROP.duration,
    poster: DEFAULT_BACKDROP.poster,
    dim: 0,
  }
}

/** A frame style opening on the default backdrop (media + its ground). */
export function withDefaultBackdrop(frame: FrameStyle): FrameStyle {
  return {
    ...frame,
    background: DEFAULT_BACKDROP.ground,
    backgroundMedia: defaultBackdropMedia(),
  }
}
