/**
 * Remote-media probing for `vos validate` — the loud-failure sibling of the
 * dangling-reference ladder. A doc or config that references a
 * hosted file (a poster's shot, a backdrop loop, an audio bed) can go
 * quietly broken when that file is deleted: the render carries on without
 * it and nothing says so. Validate is the next touch, so validate probes.
 *
 * The COLLECTOR is pure and unit-tested; the PROBE is best-effort network:
 * an unreachable URL (>=400) is a PROBLEM in words, a failed probe (offline,
 * DNS, timeout) is a WARNING — validation must still work on a plane.
 */

const MEDIA_EXT =
  /\.(png|jpe?g|webp|gif|webm|mp4|mov|mp3|wav|m4a|ogg|glb|gltf|hdr|exr|woff2?)($|\?)/i

const isRemote = (v: unknown): v is string =>
  typeof v === 'string' && /^https?:\/\//i.test(v)

/** A remote URL that plausibly names media bytes (an asset route or a media
 * extension) — never a page, a docs link, or an API endpoint. */
const isRemoteMedia = (v: unknown): v is string =>
  isRemote(v) && (/\/api\/assets\/[^/]+\/file/i.test(v) || MEDIA_EXT.test(v))

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Every remote media URL a doc references: the backdrop loop, image/video
 * overlay keys, audio clip keys. Local take-dir keys ("/music.mp3") and
 * blob/data URLs are not probeable and not collected.
 */
export function collectDocMediaUrls(doc: unknown): string[] {
  if (!isObj(doc)) return []
  const urls: string[] = []
  const frame = doc.frame
  if (isObj(frame) && isObj(frame.backgroundMedia)) {
    const key = frame.backgroundMedia.key
    if (isRemoteMedia(key)) urls.push(key)
  }
  for (const list of [doc.overlays, doc.audio]) {
    if (!Array.isArray(list)) continue
    for (const clip of list) {
      if (isObj(clip) && isRemoteMedia(clip.key)) urls.push(clip.key)
      if (isObj(clip) && isRemoteMedia(clip.src)) urls.push(clip.src)
    }
  }
  return [...new Set(urls)]
}

/**
 * Every remote media URL a CONFIG references: element srcs (image/video/svg
 * by URL), font files, and any data value that names hosted media (the
 * poster family's shotUrl, a model URL knob).
 */
export function collectConfigMediaUrls(config: unknown): string[] {
  if (!isObj(config)) return []
  const urls: string[] = []
  if (Array.isArray(config.elements)) {
    for (const el of config.elements) {
      if (isObj(el) && isRemoteMedia(el.src)) urls.push(el.src)
    }
  }
  if (Array.isArray(config.fonts)) {
    for (const f of config.fonts) {
      if (isObj(f) && isRemote(f.url)) urls.push(f.url)
    }
  }
  if (isObj(config.data)) {
    for (const v of Object.values(config.data)) {
      if (isRemoteMedia(v)) urls.push(v)
    }
  }
  return [...new Set(urls)]
}

export interface MediaProbeResult {
  url: string
  /** true = reachable · false = the server answered >=400 · null = probe failed (offline, timeout) */
  ok: boolean | null
  status?: number
  error?: string
}

const PROBE_CAP = 16
const PROBE_TIMEOUT_MS = 5000

async function probeOne(url: string): Promise<MediaProbeResult> {
  const attempt = async (method: 'HEAD' | 'GET') => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS)
    try {
      return await fetch(url, {
        method,
        signal: ctl.signal,
        headers: method === 'GET' ? { range: 'bytes=0-0' } : undefined,
      })
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    let res = await attempt('HEAD')
    // Some hosts refuse HEAD; one ranged GET settles it without the bytes.
    if (res.status === 405 || res.status === 501) res = await attempt('GET')
    return { url, ok: res.status < 400, status: res.status }
  } catch (e) {
    return { url, ok: null, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Probe up to PROBE_CAP urls in parallel. */
export async function probeMediaUrls(
  urls: string[],
): Promise<MediaProbeResult[]> {
  return Promise.all(urls.slice(0, PROBE_CAP).map(probeOne))
}

/** Fold probe results into validate's problems/warnings, in words. */
export function mediaProbeLints(results: MediaProbeResult[]): {
  problems: string[]
  warnings: string[]
} {
  const problems: string[] = []
  const warnings: string[] = []
  for (const r of results) {
    if (r.ok === false) {
      problems.push(
        `media unreachable: ${r.url} answers ${String(r.status)} — a render will quietly carry on without it`,
      )
    } else if (r.ok === null) {
      warnings.push(`could not probe ${r.url} (${r.error ?? 'network error'})`)
    }
  }
  return { problems, warnings }
}
