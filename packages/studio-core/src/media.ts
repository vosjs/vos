/**
 * Many media in one take, one rule: a recording is media plus the FACTS
 * only a capture has, and `doc.source` is the PRIMARY media (the subject:
 * the sequence, the camera and the cut belong to it). `doc.media` holds
 * the others, each the same shape with an `id`; a footage clip (a segment)
 * and every source-anchored span (zoom, tilt, speed, freeze, cam move, a
 * rejected proposal) name the media they belong to by that id, and an
 * absent `media` is the primary. Nothing else moves: `mapTime` still
 * answers source seconds, and the piece under the playhead says whose.
 */
import type { Segment } from '@vosjs/timeline'
import type { Media, ProjectDoc } from './types'

/** The primary media's key: the absent `media` on a clip or a span. */
export const PRIMARY_MEDIA = ''

/** The key a `media` field carries, the primary's when absent. */
export const mediaKey = (id: string | undefined | null): string =>
  id ?? PRIMARY_MEDIA

/** Do two `media` fields name the same media (absent = the primary)? */
export const sameMedia = (
  a: string | undefined | null,
  b: string | undefined | null,
): boolean => mediaKey(a) === mediaKey(b)

/** A piece of the rated list, carrying the media it plays. */
export type MediaSegment = Segment & { media?: string }

/**
 * Every media the document carries, the primary first (its key is the
 * empty string), then `doc.media` in order.
 */
export function docMediaList(
  doc: Pick<ProjectDoc, 'source' | 'media'>,
): { id: string; source: ProjectDoc['source'] }[] {
  return [
    { id: PRIMARY_MEDIA, source: doc.source },
    ...(doc.media ?? []).map((m) => ({ id: m.id, source: m })),
  ]
}

/** The media a key names, the primary for the empty key, null for a stranger. */
export function mediaSource(
  doc: Pick<ProjectDoc, 'source' | 'media'>,
  id: string | undefined | null,
): ProjectDoc['source'] | null {
  const key = mediaKey(id)
  if (key === PRIMARY_MEDIA) return doc.source
  return (doc.media ?? []).find((m) => m.id === key) ?? null
}

/** A media's source length in seconds (its capture meta). */
export function mediaDuration(
  source: Pick<ProjectDoc['source'], 'meta'>,
): number {
  return (source.meta.durationMs || 0) / 1000
}

/**
 * The media the output plays at `t`: the rated piece under it, the last
 * piece past the footage's end (the frame the card froze on), the primary
 * for an empty list.
 */
export function mediaAtOutput(
  rated: readonly MediaSegment[],
  t: number,
): string {
  let acc = 0
  let last: MediaSegment | null = null
  for (const p of rated) {
    const len = Math.max(0, p.out - p.in) / (p.rate && p.rate > 0 ? p.rate : 1)
    if (t < acc + len) return mediaKey(p.media)
    acc += len
    last = p
  }
  return last ? mediaKey(last.media) : PRIMARY_MEDIA
}

/** The next free media id (`m1`, `m2`, …). */
export function nextMediaId(doc: Pick<ProjectDoc, 'media'>): string {
  const taken = new Set((doc.media ?? []).map((m) => m.id))
  let n = 1
  while (taken.has(`m${n}`)) n++
  return `m${n}`
}

/** A document's media as `Media` rows (the primary is not one: it has no id). */
export type MediaRow = Media
