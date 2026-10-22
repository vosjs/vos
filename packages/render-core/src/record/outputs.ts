/**
 * What a `download` step keeps: the bytes of a file the page made, under a
 * plain name in the take's `outputs/`. The pure parts (the name, the byte
 * read, the in-page fetch) live here; the recorder drives the click or
 * the fetch, and the host's `OutputSink` puts the bytes somewhere.
 */
import { fileNameProblem } from './actions'

/** The most a download keeps: a file the page made, never a disk's worth. */
export const OUTPUT_MAX_BYTES = 512 * 1024 * 1024

/**
 * A name the page suggested, made plain: its last path segment, control
 * characters and leading dots removed, or `fallback` when nothing usable
 * is left. A page chooses this name, so it is cleaned, never trusted.
 */
export function plainName(suggested: string, fallback: string): string {
  const last = suggested.split(/[/\\]/).pop() ?? ''
  const clean = last
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200)
  return clean && !fileNameProblem(clean) ? clean : fallback
}

/** The file name a URL's path ends in, decoded, or ''. */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'blob:' || u.protocol === 'data:') return ''
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(seg)
  } catch {
    return ''
  }
}

/**
 * The name a download is saved under: the step's `as` when it gave one,
 * else the page's suggestion made plain, made unique among the names this
 * take already used (`clip.mp4`, `clip-2.mp4`).
 */
export function outputName(
  asked: string | undefined,
  suggested: string,
  fallback: string,
  used: ReadonlySet<string>,
): string {
  const base = asked ?? plainName(suggested, fallback)
  if (!used.has(base)) return base
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let n = 2; ; n++) {
    const next = `${stem}-${n}${ext}`
    if (!used.has(next)) return next
  }
}

/** A chunk of a byte stream as bytes: a Node Buffer is one already. */
function chunkBytes(c: unknown): Uint8Array {
  if (c instanceof Uint8Array) return c
  if (typeof c === 'string') return new TextEncoder().encode(c)
  if (c instanceof ArrayBuffer) return new Uint8Array(c)
  throw new Error('the download stream gave something that is not bytes')
}

/** Read a stream of byte chunks whole, refusing past `max` bytes. */
export async function readAllBytes(
  stream: AsyncIterable<unknown>,
  max = OUTPUT_MAX_BYTES,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  let n = 0
  for await (const c of stream) {
    const u = chunkBytes(c)
    n += u.length
    if (n > max)
      throw new Error(
        `the file is larger than ${Math.round(max / 1024 / 1024)} MB`,
      )
    parts.push(u)
  }
  const out = new Uint8Array(n)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * The expression that reads a media element's source: its `currentSrc`
 * (what it is actually playing), else its `src`. '' while it has none
 * yet, null when nothing matches. A CSS selector, read in the page.
 */
export function currentSrcScript(selector: string): string {
  return `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; return el.currentSrc || el.src || el.getAttribute('src') || '' })()`
}

/**
 * The expression that fetches a URL inside the page, for what the page
 * alone can read (a `blob:` or a `data:` source): base64 and the type, or
 * an error in words. Same-origin requests carry the page's cookies.
 */
export function fetchInPageScript(url: string): string {
  return `(async () => {
  try {
    const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
    if (!res.ok) return { error: 'answered ' + res.status };
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), type: res.headers.get('content-type') || '' };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
})()`
}
