/**
 * Every recording path records exactly the viewport. Headless Chrome gives
 * its window a frame the content surface loses, and a take recorded through
 * it was 87 px short (1280x720 became 1280x633); the recorder now fits the
 * window to the viewport before the camera rolls (surfaceFit.ts in
 * render-core). This records a tiny take through `vos record
 * --storage-state`, on the browser the CLI launches, and reads the size the
 * footage has. Skipped, and said, where no browser launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { run } from '../run'
import type { Server } from 'node:http'

let server: Server | undefined
let base = ''
let skip = ''

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><html><head><title>Full</title></head>
<body style="margin:0;height:100vh;background:linear-gradient(#e33,#33e)">
<button id="go" style="margin:40px;padding:10px 16px">Go</button>
<div id="n">0</div>
<script>setInterval(function(){document.getElementById('n').textContent=Date.now()},100)</script>
</body></html>`)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  try {
    const { launchBrowser } = await import('../../browser')
    await (await launchBrowser()).close()
  } catch (e) {
    skip = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
}, 60_000)

afterAll(() => {
  server?.close()
})

describe('a --storage-state take records the whole viewport', () => {
  it('is 1280x720 when the script asks for 1280x720', async () => {
    if (skip) {
      console.warn(`skipped: no browser (${skip})`)
      return
    }
    const dir = await mkdtemp(join(tmpdir(), 'vos-full-'))
    const actions = join(dir, 'actions.json')
    await writeFile(
      actions,
      JSON.stringify({
        viewport: { width: 1280, height: 720 },
        steps: [
          { do: 'wait', ms: 300 },
          { do: 'click', selector: '#go' },
          { do: 'wait', ms: 300 },
        ],
      }),
    )
    const state = join(dir, 'state.json')
    await writeFile(
      state,
      JSON.stringify({
        cookies: [
          {
            name: 'signedin',
            value: 'yes',
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      }),
    )
    const out = join(dir, 'take')
    const code = await run([
      'record',
      '--actions',
      actions,
      '--url',
      `${base}/`,
      '--out',
      out,
      '--storage-state',
      state,
      '--json',
    ])
    expect(code).toBe(0)
    const meta = JSON.parse(await readFile(join(out, 'meta.json'), 'utf8')) as {
      width: number
      height: number
      captureWidth: number
      captureHeight: number
    }
    expect([meta.width, meta.height]).toEqual([1280, 720])
    expect([meta.captureWidth, meta.captureHeight]).toEqual([1280, 720])
  }, 120_000)
})
