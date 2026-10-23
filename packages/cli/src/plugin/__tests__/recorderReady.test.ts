/**
 * When a take starts: the first page counts as ready once its DOM has
 * stopped changing, not once its network went idle, because a page that
 * holds a request open never goes network-idle. Over a REAL Playwright
 * browser on fixture pages served in-process. Skipped, and said, where no
 * browser launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { run } from '../run'
import { READY_SETTLE_CAP_MS, recordTake } from '@vosjs/render-core/record'
import type { FrameSink } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'

// A page that keeps one request open for good (a socket, a beacon) and
// draws for a second after it loaded, then is still.
const HELD = `<!doctype html><html><head><meta charset="utf-8"><title>Held</title></head><body>
<ul id="list"></ul>
<script>
fetch('/hang').catch(function(){});
var n = 0;
var iv = setInterval(function(){
  var li = document.createElement('li'); li.textContent = 'row ' + (++n);
  document.getElementById('list').appendChild(li);
  if (n >= 10) clearInterval(iv);
}, 100);
</script>
</body></html>`

// A page that never stops changing: a ticker.
const BUSY = `<!doctype html><html><head><meta charset="utf-8"><title>Busy</title></head><body>
<p id="t">0</p>
<script>var n = 0; setInterval(function(){ document.getElementById('t').textContent = String(++n) }, 100)</script>
</body></html>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/hang') return // never answered
    if (req.url === '/still') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><html><body><p>still</p></body></html>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(req.url === '/busy' ? BUSY : HELD)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  try {
    const { launchBrowser } = await import('../../browser')
    browser = await launchBrowser()
  } catch (e) {
    skipReason = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
}, 60_000)

afterAll(async () => {
  await browser?.close()
  server?.closeAllConnections()
  server?.close()
}, 30_000)

const sink: FrameSink = { frame: () => {} }
const script = {
  viewport: { width: 640, height: 480 },
  steps: [{ do: 'wait' as const, ms: 50 }],
}

describe('the first load', () => {
  it('starts once the DOM settles, though a request never finishes', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const logs: string[] = []
    const started = Date.now()
    const result = await recordTake(
      browser,
      `${base}/held`,
      script,
      sink,
      (m) => logs.push(m),
      { dryRun: true, env: {} },
    )
    const wall = Date.now() - started
    expect(result.ready.mode).toBe('settle')
    expect(result.ready.capped).toBe(false)
    // A second of drawing, then the quiet beat: about two seconds, never
    // the network timeout.
    expect(result.ready.ms).toBeGreaterThanOrEqual(1500)
    expect(result.ready.ms).toBeLessThan(3500)
    expect(wall).toBeLessThan(10_000)
    // navTimeout is about network idle, which nobody asked for.
    expect(result.navTimeout).toBe(false)
    expect(logs.some((l) => l.includes('the page settled after'))).toBe(true)
  }, 30_000)

  it('starts at the cap on a page that never stops changing, and says so', async () => {
    if (!browser) return
    const logs: string[] = []
    const result = await recordTake(
      browser,
      `${base}/busy`,
      script,
      sink,
      (m) => logs.push(m),
      { dryRun: true, env: {} },
    )
    expect(result.ready).toMatchObject({ mode: 'settle', capped: true })
    expect(result.ready.ms).toBeGreaterThanOrEqual(READY_SETTLE_CAP_MS - 100)
    expect(result.ready.ms).toBeLessThan(READY_SETTLE_CAP_MS + 3000)
    expect(result.navTimeout).toBe(false)
    expect(logs.some((l) => l.includes('still changing'))).toBe(true)
  }, 30_000)
})

describe('vos record --dry-run --ready networkidle', () => {
  it('waits for network idle, and the next command keeps the flag', async () => {
    if (!browser) return
    const dir = await mkdtemp(join(tmpdir(), 'vos-ready-'))
    const file = join(dir, 'actions.json')
    await writeFile(file, JSON.stringify({ url: `${base}/still`, ...script }))
    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s) => out.push(String(s)) > 0)
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    let code: number
    try {
      code = await run([
        'record',
        '--actions',
        file,
        '--dry-run',
        '--ready',
        'networkidle',
        '--background',
        'none',
        '--max-duration',
        '60',
      ])
    } finally {
      spy.mockRestore()
      errSpy.mockRestore()
    }
    const text = out.join('')
    expect(code).toBe(0)
    expect(text).toMatch(
      /Next: vos record --actions \S+ --out take --ready networkidle --max-duration 60 --background none --strict/,
    )
  }, 60_000)
})
