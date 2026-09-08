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
import { MEDIA_FRAME_KEYS, MEDIA_KEY_PREFIX, pageDisplayUrl } from './types'
import type { FrameStyle, Media, MediaFrameKey, ProjectDoc } from './types'

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

/**
 * The card a media wears: the take's frame with the media's own card
 * fields over it. Facts first: a media with a recorded page names it in
 * the bar, and one with no page (an upload) wears no bar, unless its own
 * `frame.browserBar` says otherwise. The primary wears the take's frame.
 */
export function mediaFrame(
  doc: Pick<ProjectDoc, 'source' | 'media' | 'frame'>,
  id: string | undefined | null,
): FrameStyle {
  const key = mediaKey(id)
  if (key === PRIMARY_MEDIA) return doc.frame
  const m = (doc.media ?? []).find((x) => x.id === key)
  if (!m) return doc.frame
  const over = m.frame ?? {}
  const out: FrameStyle = { ...doc.frame }
  for (const k of MEDIA_FRAME_KEYS) {
    if (k === 'browserBar') continue
    const v = over[k]
    if (v !== undefined) (out as Record<MediaFrameKey, unknown>)[k] = v
  }
  const bar = { ...doc.frame.browserBar }
  const page = pageDisplayUrl(m.meta.pageUrl)
  if (page) bar.url = page
  if (!m.meta.pageUrl) bar.kind = 'none'
  out.browserBar = { ...bar, ...(over.browserBar ?? {}) }
  return out
}

/** The card-owned fields of a frame, alone (what a media's card is made of). */
export function cardFields(frame: FrameStyle): Pick<FrameStyle, MediaFrameKey> {
  const out: Partial<Pick<FrameStyle, MediaFrameKey>> = {}
  for (const k of MEDIA_FRAME_KEYS) {
    const v = frame[k]
    if (v !== undefined) (out as Record<MediaFrameKey, unknown>)[k] = v
  }
  return out as Pick<FrameStyle, MediaFrameKey>
}

/** The overlay key that shows a document media (`''` = the primary). */
export const mediaRef = (id: string): string => MEDIA_KEY_PREFIX + id

/** The media id an overlay key names, `''` for the primary, null for a plain key. */
export function mediaRefId(key: string | undefined | null): string | null {
  if (typeof key !== 'string' || !key.startsWith(MEDIA_KEY_PREFIX)) return null
  return key.slice(MEDIA_KEY_PREFIX.length)
}

/** The document media a layer's key shows, or null for a plain key or a stranger. */
export function layerMedia(
  doc: Pick<ProjectDoc, 'source' | 'media'>,
  key: string | undefined | null,
): ProjectDoc['source'] | null {
  const id = mediaRefId(key)
  return id === null ? null : mediaSource(doc, id)
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
