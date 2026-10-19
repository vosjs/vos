import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { MEDIA_HEAD_BYTES, sniffMediaType } from './container'
import type { Page } from 'playwright'

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  // A brand mark or an image overlay: an <img> refuses an SVG served as an
  // octet stream, so the kinds a doc can key are named.
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  // Take-dir audio (doc.audio keys like "/music.mp3") — decode goes through
  // fetch → arrayBuffer so the type is informational, but an <audio> element
  // would care; never serve these as octet-stream.
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
}

export interface TakeServer {
  base: string
  close: () => void
}

/**
 * A `/save` name is a file the CLI's own pages write: a render, a frame,
 * the encoded recording, a digest picture. Never a path, a dotfile, or one
 * of the take's own records, which no page has a reason to replace.
 */
const SAVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAVE_NEVER = new Set([
  'doc.json',
  'actions.json',
  'vos.json',
  'meta.json',
  'cursor.json',
])
export function saveNameOk(name: string): boolean {
  return SAVE_NAME.test(name) && !name.includes('..') && !SAVE_NEVER.has(name)
}

/**
 * The file a request path names inside the take directory, or null when it
 * names nothing there: the resolved real path must stay under the real
 * root, so an encoded `..` or a symlink out of the directory answers 404.
 */
export function fileInRoot(rootDir: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const file = resolve(rootDir, `.${decoded}`)
  if (!existsSync(file) || !statSync(file).isFile()) return null
  const root = realpathSync(rootDir)
  const real = realpathSync(file)
  return real.startsWith(root + sep) ? real : null
}

/**
 * Who may read a bare path (one without the token prefix): the server's own
 * pages, which fetch as same-origin, and a person at the address bar. A
 * page on any other origin reads only through the tokened base the studio
 * was handed, so a stray page on the machine cannot list the take.
 */
function ownReader(req: { headers: Record<string, unknown> }): boolean {
  const site = req.headers['sec-fetch-site']
  return site === undefined || site === 'same-origin' || site === 'none'
}

/**
 * Static server over the take dir + generated pages + a POST /save endpoint
 * the in-page encoder/renderer uses to hand bytes back to node. The recording
 * is fetched → blob URL (seekable), but a take-dir VIDEO BACKGROUND
 * (frame.backgroundMedia.key = "/bg.webm") is loaded directly by ON_FRAME and
 * seeked during export — so this serves Range/206 (an HTMLVideoElement hangs
 * forever seeking a naive 200-only static server).
 */
export function startTakeServer(
  rootDir: string,
  pages: Record<string, string>,
): Promise<TakeServer> {
  // The base the studio is handed carries a per-start token in its path,
  // and a cross-site read must carry it back; the server's own pages keep
  // their bare absolute paths (`/save`, `/recording.webm`).
  const token = randomBytes(16).toString('hex')
  const prefix = `/t/${token}`
  const server = createServer((req, res) => {
    const raw = new URL(req.url ?? '/', 'http://x')
    const tokened =
      raw.pathname === prefix || raw.pathname.startsWith(`${prefix}/`)
    if (!tokened && req.method !== 'OPTIONS' && !ownReader(req)) {
      res.writeHead(404).end()
      return
    }
    const url = tokened
      ? new URL(raw.pathname.slice(prefix.length) || '/', 'http://x')
      : raw
    url.search = raw.search
    // The studio (a different origin, https://vos.so) fetches take files for
    // `vos open`. Two doors a public page must pass to reach localhost:
    // CORS, answered on every response, and Chrome's private-network
    // check. Chrome 104 to 141 asked it as a preflight carrying
    // Access-Control-Request-Private-Network and wanted the Allow-
    // Private-Network answer; Chrome 142 and later (Local Network Access)
    // asks the PERSON instead, a prompt by the address bar, which no header
    // can answer (measured 2026-09-25 on Chrome 153: the fetch fails with
    // "Permission was denied for this request to access the loopback
    // address space" until it is allowed once per site). Both answered
    // here; the studio's reader says what to allow.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-private-network', 'true')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': '*',
        'access-control-max-age': '600',
      })
      res.end()
      return
    }
    if (req.method === 'POST' && url.pathname === '/save') {
      const name = url.searchParams.get('name') ?? 'out.bin'
      // Only the server's own pages write, and only a file name.
      if (tokened || !ownReader(req) || !saveNameOk(name)) {
        res.writeHead(404).end()
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        void writeFile(join(rootDir, name), Buffer.concat(chunks)).then(
          () => res.writeHead(200).end('ok'),
          (e) => res.writeHead(500).end(String(e)),
        )
      })
      return
    }
    if (pages[url.pathname]) {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(pages[url.pathname])
      return
    }
    const file = fileInRoot(rootDir, url.pathname)
    if (file) {
      const size = statSync(file).size
      const buf = readFileSync(file)
      // The BYTES outrank the extension for anything carrying a container
      // signature: a take pulled as mp4 under a `.webm` name would otherwise be
      // served as webm, and the page's video element would refuse to decode it.
      // Everything without one (html, js, json, svg) keeps the table's answer.
      const type =
        sniffMediaType(buf.subarray(0, MEDIA_HEAD_BYTES)) ??
        MIME[extname(file)] ??
        'application/octet-stream'
      const range = req.headers.range
      // Range/206 so an HTMLVideoElement can seek a take-dir video background.
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range)
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0
        const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
        if (start > end || start >= size) {
          res.writeHead(416, { 'content-range': `bytes */${size}` }).end()
          return
        }
        res.writeHead(206, {
          'content-type': type,
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': end - start + 1,
        })
        res.end(buf.subarray(start, end + 1))
        return
      }
      res.writeHead(200, {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-length': size,
      })
      res.end(buf)
      return
    }
    res.writeHead(404).end()
  })
  // Loopback only: a take is this machine's, never the LAN's.
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      done({
        base: `http://127.0.0.1:${port}${prefix}`,
        close: () => server.close(),
      })
    }),
  )
}

/** Poll a capture/encode page for window.__done / __error / __progress. */
export async function waitForPageDone(
  page: Page,
  label: string,
  onProgress: (fraction: number) => void,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  let last = -1
  for (;;) {
    const state: {
      done: Record<string, unknown> | null
      progress: number | null
      error: string | null
    } = await page.evaluate(
      '({ done: window.__done ?? null, progress: window.__progress ?? null, error: window.__error ?? null })',
    )
    if (state.error) throw new Error(`${label} failed: ${state.error}`)
    if (state.done) return state.done
    if (typeof state.progress === 'number') {
      const pct = Math.floor(state.progress * 10) * 10
      if (pct !== last) {
        onProgress(state.progress)
        last = pct
      }
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `${label} timed out after ${Math.round(timeoutMs / 1000)}s`,
      )
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}
