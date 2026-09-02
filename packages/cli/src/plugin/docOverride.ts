/**
 * Doc-override flags for `render` / `frames` — the product-surface verification
 * seam (verification is how customers use it). The CLI and the studio are
 * producer AND consumer: when we want to CHECK a doc field
 * (a browser frame, a background, a tilt span), the right move is not a bespoke
 * harness but a flag that expresses it on the product surface — so the check and
 * the customer feature are the same thing. Every doc field is reachable via a
 * generic `--set <path>=<value>` (agents have the schema); the marquee
 * presentation knobs get named aliases (`--frame`, `--background`).
 *
 * Overrides patch the take's doc IN MEMORY only (doc.json on disk stays the
 * source of truth) and are LINT-GATED before rendering — a bad override fails
 * exactly like a bad doc.json, so the override path can't ship an invalid doc.
 */
import { lintDoc } from './validateDoc'
import { UsageError } from './args'
import type { ProjectDoc } from '@vosjs/studio-core'

export interface DocOverrides {
  /** raw `path=value` expressions from repeated --set. */
  set?: string[]
  /** --frame alias → frame.browserBar.kind. */
  frame?: string
  /** --background alias → frame.backgroundMedia (kind inferred from the URL,
   *  or a backdrop SLUG from GET /api/backdrops, resolved by
   *  resolveBackdropSlug before the sync apply). */
  background?: string
  /** The loop length a resolved backdrop slug brought with it. */
  backgroundDuration?: number
  /** Platform origin for slug resolution (platformOrigin(flags)). */
  origin?: string
}

/** A bare slug (`soft-beams`), never a URL, a path or `none`. */
export function isBackdropSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,49}$/.test(value) && value !== 'none'
}

/**
 * `--background <slug>` names a backdrop from the set. The set is
 * public (`GET /api/backdrops`), so this needs no credential; it rewrites
 * the override IN PLACE to the loop's 1080p URL and its own period, and
 * refuses in words when the slug is not in the set. URLs pass untouched.
 */
export async function resolveBackdropSlug(o: DocOverrides): Promise<void> {
  if (!o.background || !isBackdropSlug(o.background)) return
  const origin = (o.origin ?? 'https://vos.so').replace(/\/+$/, '')
  let list: {
    slug: string
    duration: number
    urls: { '1080p': string | null }
  }[] = []
  try {
    const res = await fetch(`${origin}/api/backdrops`)
    if (res.ok)
      list = ((await res.json()) as { backdrops: typeof list }).backdrops
  } catch {
    throw new UsageError(
      `--background "${o.background}" — could not read the backdrop set from ${origin}/api/backdrops; pass a URL instead`,
    )
  }
  const hit = list.find((b) => b.slug === o.background && b.urls['1080p'])
  if (!hit?.urls['1080p']) {
    throw new UsageError(
      `--background "${o.background}" is not in the set (${list.map((b) => b.slug).join(' | ') || 'empty'}); GET ${origin}/api/backdrops lists it, or pass a URL`,
    )
  }
  o.background = hit.urls['1080p']
  o.backgroundDuration = hit.duration
}

export function hasOverrides(o: DocOverrides): boolean {
  return !!(
    o.set?.length ||
    o.frame !== undefined ||
    o.background !== undefined
  )
}

/** Friendly --frame values → BrowserBarStyle.kind. */
const FRAME_KINDS: Record<string, string> = {
  macos: 'mac-light',
  mac: 'mac-light',
  'mac-light': 'mac-light',
  'mac-dark': 'mac-dark',
  windows: 'windows-light',
  'windows-light': 'windows-light',
  'windows-dark': 'windows-dark',
  minimal: 'minimal',
  none: 'none',
  hidden: 'none',
}

/** Default loop length assumed for a --background video with no explicit duration. */
export const BACKGROUND_DEFAULT_DURATION = 10

const VIDEO_EXT = /\.(webm|mp4|mov|m4v)(\?|#|$)/i
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i

/**
 * Coerce a `--set` value: JSON when it parses (numbers, booleans, null, objects,
 * arrays), else the raw string — so `tilt[0].rx=8` is a number, `tilt=null`
 * clears it, `frame.background=#000` stays a string, and
 * `frame.backgroundMedia={"kind":"video","key":"…","duration":10,"dim":0.2}`
 * is an object.
 */
export function coerceValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

interface PathSeg {
  key: string | number
}

/**
 * Tokenize `frame.browserBar.kind` / `zoom[0].level` into path segments, strictly
 * (contiguous — no empty segments, no `a..b`, no leading/trailing dot).
 */
function parsePath(path: string): PathSeg[] {
  const bad = (): never => {
    throw new UsageError(`--set: invalid path "${path}"`)
  }
  const segs: PathSeg[] = []
  let i = 0
  let expectKey = true // start of the path, or just after a '.'
  while (i < path.length) {
    const c = path[i]
    if (c === '.') {
      if (expectKey) bad() // leading '.' or '..'
      expectKey = true
      i++
    } else if (c === '[') {
      if (expectKey) bad() // '[' can only follow a name/index
      const j = path.indexOf(']', i)
      if (j < 0) bad()
      const num = path.slice(i + 1, j)
      if (!/^\d+$/.test(num)) bad()
      segs.push({ key: Number(num) })
      i = j + 1
    } else {
      let j = i
      while (j < path.length && path[j] !== '.' && path[j] !== '[') j++
      segs.push({ key: path.slice(i, j) })
      expectKey = false
      i = j
    }
  }
  if (expectKey || !segs.length) bad() // trailing '.' or empty
  return segs
}

/** Set a nested path on an object, creating intermediate objects/arrays. */
export function setPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segs = parsePath(path)
  let node: unknown = root
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i].key
    const nextIsIndex = typeof segs[i + 1].key === 'number'
    const container = node as Record<string | number, unknown>
    if (container[key] === undefined || container[key] === null) {
      container[key] = nextIsIndex ? [] : {}
    }
    node = container[key]
    if (typeof node !== 'object' || node === null) {
      throw new UsageError(
        `--set: "${path}" traverses a non-object at "${String(key)}"`,
      )
    }
  }
  ;(node as Record<string | number, unknown>)[segs[segs.length - 1].key] = value
}

function inferBackgroundKind(url: string): 'video' | 'image' {
  if (IMAGE_EXT.test(url)) return 'image'
  if (VIDEO_EXT.test(url)) return 'video'
  // Default to video (the flagship case: a vos loop); the lint still warns if a
  // video lacks duration, and --set gives precise control when the URL is opaque.
  return 'video'
}

/**
 * Apply overrides to `doc` IN PLACE. Named aliases first (so an explicit --set
 * can still override them), then --set expressions in order. Returns a
 * human-readable summary of what was applied. Throws UsageError on a malformed
 * expression; SEMANTIC validity is the caller's lint pass.
 */
export function applyDocOverrides(doc: ProjectDoc, o: DocOverrides): string[] {
  const applied: string[] = []
  const d = doc as unknown as Record<string, unknown>

  if (o.frame !== undefined) {
    const kind = FRAME_KINDS[o.frame.toLowerCase()]
    if (!kind) {
      throw new UsageError(
        `--frame "${o.frame}" — one of: ${Object.keys(FRAME_KINDS).join(' | ')}`,
      )
    }
    setPath(d, 'frame.browserBar.kind', kind)
    applied.push(`frame.browserBar.kind = ${kind}`)
  }

  if (o.background !== undefined) {
    if (o.background === 'none' || o.background === '') {
      setPath(d, 'frame.backgroundMedia', null)
      applied.push('frame.backgroundMedia = null')
    } else {
      const kind = inferBackgroundKind(o.background)
      const media: Record<string, unknown> = { kind, key: o.background, dim: 0 }
      if (kind === 'video')
        media.duration = o.backgroundDuration ?? BACKGROUND_DEFAULT_DURATION
      setPath(d, 'frame.backgroundMedia', media)
      applied.push(`frame.backgroundMedia = ${kind} ${o.background}`)
    }
  }

  for (const expr of o.set ?? []) {
    const eq = expr.indexOf('=')
    if (eq < 1) throw new UsageError(`--set expects path=value (got "${expr}")`)
    const path = expr.slice(0, eq)
    const value = coerceValue(expr.slice(eq + 1))
    setPath(d, path, value)
    applied.push(`${path} = ${JSON.stringify(value)}`)
  }

  return applied
}

/**
 * Apply overrides then LINT — the gate that makes the override path as safe as
 * editing doc.json. Throws UsageError (bad expression or resulting doc invalid)
 * so `render`/`frames` refuse an override that would produce a broken video.
 */
export function applyAndValidate(doc: ProjectDoc, o: DocOverrides): string[] {
  const applied = applyDocOverrides(doc, o)
  const lint = lintDoc(doc)
  if (lint.problems.length) {
    throw new UsageError(
      `override produced an invalid doc:\n  ${lint.problems.join('\n  ')}`,
    )
  }
  return applied
}
