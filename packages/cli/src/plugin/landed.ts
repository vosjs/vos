/**
 * `vos push --wait`: stay until what was pushed can be LOOKED at.
 *
 * A push answers as soon as the version exists, but its still and preview
 * are rendered afterwards on the fleet, so "look at what landed" used to
 * mean polling the API by hand. The version's own still answers 404 until
 * its render lands, which makes it the one honest signal; once it is there
 * the vos's `contentUrls` name the still and preview to open, made absolute
 * here because a relative path means nothing outside the site.
 *
 * A render that is deferred (the fleet rates media) or slow is not a failed
 * push: the wait ends in words, with the links to come back to.
 */
import { apiJson } from './platform'

export interface Landed {
  /** The version's still rendered before the wait ran out. */
  still: boolean
  watchUrl: string
  studioUrl: string
  thumbnailUrl: string | null
  previewUrl: string | null
  /** A private vos's links answer only to its owner's key or session. */
  private: boolean
  waitedMs: number
}

export interface WaitOptions {
  origin: string
  key: string
  vosId: string
  versionId: string | null
  timeoutMs?: number
  intervalMs?: number
  log?: (line: string) => void
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const absolute = (origin: string, url: unknown): string | null =>
  typeof url === 'string' && url
    ? /^https?:/.test(url)
      ? url
      : `${origin}${url.startsWith('/') ? '' : '/'}${url}`
    : null

export async function waitForLanded(opts: WaitOptions): Promise<Landed> {
  const origin = opts.origin.replace(/\/+$/, '')
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = opts.now ?? (() => Date.now())
  const timeoutMs = opts.timeoutMs ?? 300_000
  const intervalMs = opts.intervalMs ?? 4_000
  const started = now()
  let still = false
  if (opts.versionId) {
    opts.log?.('waiting for the still to render…')
    for (;;) {
      const res = await fetch(
        `${origin}/api/vos/${opts.vosId}/versions/${opts.versionId}/thumbnail`,
        { headers: { authorization: `Bearer ${opts.key}` } },
      )
      await res.arrayBuffer().catch(() => undefined)
      if (res.ok) {
        still = true
        break
      }
      if (now() - started >= timeoutMs) break
      await sleep(intervalMs)
    }
  }
  const meta = await apiJson(origin, `/api/vos/${opts.vosId}`, {
    key: opts.key,
  })
  // The single-vos read wraps its answer: { vos: { …, contentUrls } }.
  const vos = (meta.body.vos ?? {}) as Record<string, unknown>
  const urls = (vos.contentUrls ?? {}) as Record<string, unknown>
  return {
    still,
    watchUrl: `${origin}/vos/${opts.vosId}`,
    studioUrl: `${origin}/studio?vos=${opts.vosId}`,
    thumbnailUrl: still ? absolute(origin, urls.thumbnail) : null,
    previewUrl: still ? absolute(origin, urls.preview) : null,
    private: vos.visibility === 'private',
    waitedMs: now() - started,
  }
}

/** The lines a waited push prints under its own. */
export function landedLines(l: Landed): string {
  if (!l.still) {
    return `  still:  not rendered yet (the fleet renders it after the push; open the watch page in a minute)`
  }
  const links = !!(l.thumbnailUrl || l.previewUrl)
  return [
    l.thumbnailUrl ? `  still:   ${l.thumbnailUrl}` : null,
    l.previewUrl ? `  preview: ${l.previewUrl}` : null,
    // A bare fetch of a private vos's media answers 404 by design; say so,
    // or the still reads as missing when it is only fenced.
    links && l.private
      ? `  (private: these answer 404 without a credential; fetch with 'Authorization: Bearer <your key>' or open them signed in)`
      : null,
  ]
    .filter(Boolean)
    .join('\n')
}
