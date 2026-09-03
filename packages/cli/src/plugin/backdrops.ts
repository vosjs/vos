/**
 * The backdrop SET: the loops the platform publishes at `GET /api/backdrops`
 * (public, no credential, each with its 1080p loop, poster, period and
 * ground). Two readers: `--background <slug>` on the verification verbs, and
 * the frame a FRESH take opens on, which is the set's first ready loop, the
 * house pick, so a take made here opens on what a take made in the studio
 * opens on. The pick is the platform's ordering of its set, never a
 * constant in this package: the studio names its own, the CLI reads it.
 */
import { UsageError } from './args'
import type { Backdrop } from '@vosjs/studio-core'

export interface BackdropRow {
  slug: string
  title?: string
  duration: number
  ground?: string
  urls: {
    '1080p': string | null
    '2k'?: string | null
    poster?: string | null
  }
}

/** A backdrop from the set, with the slug it was picked by. */
export interface NamedBackdrop extends Backdrop {
  slug: string
}

/** Reads the set. Throws when the origin cannot be reached or answers badly. */
export async function fetchBackdropSet(origin: string): Promise<BackdropRow[]> {
  const base = origin.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/backdrops`)
  if (!res.ok)
    throw new Error(`GET ${base}/api/backdrops answered ${res.status}`)
  const body = (await res.json()) as { backdrops?: unknown }
  return Array.isArray(body.backdrops) ? (body.backdrops as BackdropRow[]) : []
}

function rowBackdrop(row: BackdropRow): NamedBackdrop | null {
  const key = row.urls['1080p']
  if (!key) return null
  return {
    slug: row.slug,
    key,
    kind: 'video',
    duration: row.duration,
    ...(row.urls.poster ? { poster: row.urls.poster } : {}),
    ...(row.ground ? { ground: row.ground } : {}),
  }
}

/** The house backdrop: the first row of the set with a loop, or null. */
export function houseBackdrop(
  rows: readonly BackdropRow[],
): NamedBackdrop | null {
  for (const row of rows) {
    const b = rowBackdrop(row)
    if (b) return b
  }
  return null
}

/** One row of the set by slug; null when it is absent or has no loop yet. */
export function backdropBySlug(
  rows: readonly BackdropRow[],
  slug: string,
): NamedBackdrop | null {
  const row = rows.find((r) => r.slug === slug)
  return row ? rowBackdrop(row) : null
}

/** A bare slug (`soft-beams`), never a URL, a path or `none`. */
export function isBackdropSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,49}$/.test(value) && value !== 'none'
}

const VIDEO_EXT = /\.(webm|mp4|mov|m4v)(\?|#|$)/i
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i

/**
 * The media kind a URL or take-dir path implies. Video when the extension
 * says nothing (the flagship case is a loop); `--set` gives precise control
 * when the URL is opaque.
 */
export function inferBackgroundKind(url: string): 'video' | 'image' {
  if (IMAGE_EXT.test(url)) return 'image'
  if (VIDEO_EXT.test(url)) return 'video'
  return 'video'
}

/** Default loop length assumed for a --background video with no explicit duration. */
export const BACKGROUND_DEFAULT_DURATION = 10

/** A backdrop for a URL or take-dir path handed to `--background`. */
export function backdropFromKey(key: string, duration?: number): Backdrop {
  const kind = inferBackgroundKind(key)
  return kind === 'video'
    ? { key, kind, duration: duration ?? BACKGROUND_DEFAULT_DURATION }
    : { key, kind }
}

/**
 * The backdrop a fresh take opens on, from `--background`: `none` is the
 * bare frame, a slug is that loop (refused in words when the set lacks it),
 * a URL or path is taken as given, and ABSENT is the set's house pick. When
 * the set cannot be read and nothing was asked, the take opens on the bare
 * frame and `note` says so; an asked slug that cannot be read is an error.
 */
export async function openingBackdrop(
  background: string | undefined,
  origin: string,
): Promise<{ backdrop: Backdrop | null; note?: string }> {
  if (background === 'none' || background === '') return { backdrop: null }
  if (background !== undefined && !isBackdropSlug(background)) {
    return { backdrop: backdropFromKey(background) }
  }
  let rows: BackdropRow[]
  try {
    rows = await fetchBackdropSet(origin)
  } catch (err) {
    if (background !== undefined) {
      throw new UsageError(
        `--background "${background}" — could not read the backdrop set from ${origin}/api/backdrops (${(err as Error).message}); pass a URL instead`,
      )
    }
    return {
      backdrop: null,
      note: `could not read the backdrop set from ${origin}/api/backdrops; the take opens on a flat ground (--background <slug|url> picks one later)`,
    }
  }
  if (background !== undefined) {
    const hit = backdropBySlug(rows, background)
    if (!hit) {
      throw new UsageError(
        `--background "${background}" is not in the set (${rows.map((b) => b.slug).join(' | ') || 'empty'}); GET ${origin}/api/backdrops lists it, or pass a URL`,
      )
    }
    return { backdrop: hit }
  }
  const house = houseBackdrop(rows)
  return house
    ? { backdrop: house }
    : {
        backdrop: null,
        note: `the backdrop set at ${origin}/api/backdrops has no ready loop; the take opens on a flat ground`,
      }
}
