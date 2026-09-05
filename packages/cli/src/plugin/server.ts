import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
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
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    // The studio (a different origin) fetches take files for `vos voila open`.
    res.setHeader('access-control-allow-origin', '*')
    if (req.method === 'POST' && url.pathname === '/save') {
      const name = (url.searchParams.get('name') ?? 'out.bin').replace(
        /[^\w.-]/g,
        '',
      )
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
    const file = join(rootDir, decodeURIComponent(url.pathname))
    if (existsSync(file) && statSync(file).isFile()) {
      const type = MIME[extname(file)] ?? 'application/octet-stream'
      const size = statSync(file).size
      const buf = readFileSync(file)
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
  return new Promise((resolve) =>
    server.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ base: `http://localhost:${port}`, close: () => server.close() })
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
