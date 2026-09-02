/**
 * The DEFAULT backdrop: the house loop every NEW take opens on
 * once the flag below is on. A committed constant, not a live vos, the same
 * way Home's door tiles are a deliberate asset push (decided 2026-08-17):
 * changing it is a code change with a review, never something an autosave
 * can re-skin.
 *
 * `ground` is the loop's average colour, written into `frame.background` so
 * the frame before the first decoded frame, the reduced-motion still and
 * the offline fail-open all land on the loop's own colour. The
 * keys are the pre-registry bucket objects, which stay in the bucket
 * forever; the registry's `backdrops/{slug}/…` keys replace them when the
 * house loop is featured through the verb.
 *
 * BACKDROP_DEFAULT_ON is the flip. It stays OFF until the set has a signed-off
 * seed and the fleet measurement has run: a switch, not a surprise.
 * Docs already carrying a frame are never touched either way.
 */
import type { BackgroundMedia, FrameStyle } from './types'

export const DEFAULT_BACKDROP = {
  slug: 'soft-beams',
  title: 'Soft Beams',
  key: 'https://assets.vos.so/backgrounds/soft-beams-1080p.webm',
  key2k: 'https://assets.vos.so/backgrounds/soft-beams-2k.webm',
  poster: 'https://assets.vos.so/backgrounds/soft-beams-poster.jpg',
  duration: 10,
  ground: '#a7b2d1',
} as const

export const BACKDROP_DEFAULT_ON = false as boolean

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
