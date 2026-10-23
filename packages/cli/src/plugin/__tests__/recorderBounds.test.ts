/**
 * A step never runs past its own bound: a page that stops answering (its main
 * thread blocked) ends the step it hung as a skip with the real time it took, and a
 * strict take stops there. Every step says when it starts and ends, and a
 * rehearsal warns of no dead time. Over a REAL Playwright browser on a
 * fixture page served in-process. Skipped, and said, where no browser
 * launches.
 */
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordTake } from '@vosjs/render-core/record'
import type { FrameSink } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'
import { closeBrowser } from './closeBrowser'

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Freeze</title>
<style>body{margin:0;font:16px system-ui}button{margin:24px;padding:12px 18px}</style>
</head><body>
<button id="ok">Fine</button>
<input id="field">
<button id="freeze" onclick="setTimeout(function(){ var x = new XMLHttpRequest(); x.open('GET', '/hang', false); x.send() }, 300)">Freeze</button>
</body></html>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    // A synchronous request the server never answers: the page's main
    // thread blocks on it, and the page stops answering without a busy loop.
    if (req.url === '/hang') return
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
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
  // Answer nothing, but let the blocked page go before the browser closes.
  server?.closeAllConnections()
  await closeBrowser(browser)
  server?.close()
}, 30_000)

const sink: FrameSink = { frame: () => {} }
const viewport = { width: 640, height: 360 }

describe('a page that stops answering', () => {
  it('ends the step it hung at its bound, with the real time, and a strict take stops there', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const events: Record<string, unknown>[] = []
    const started = Date.now()
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport,
        steps: [
          { id: 'freeze', do: 'click', selector: '#freeze', ms: 600 },
          { id: 'check', do: 'expect', selector: '#never', timeout: 1 },
          { do: 'click', selector: '#ok' },
        ],
      },
      sink,
      () => {},
      { env: {}, stopOnHang: true, onEvent: (e) => events.push(e) },
    )
    const wall = Date.now() - started
    // The expect said 1 s and was bounded at 6 s: never minutes.
    expect(wall).toBeLessThan(45_000)
    const skip = result.skipped.find((s) => s.step === 1)
    expect(skip?.reason).toMatch(
      /^the page stopped answering: this expect ran \d+(\.\d)? s, past its bound of 6 s$/,
    )
    expect(result.stopped?.step).toBe(1)
    expect(result.stopped?.reason).toMatch(/so the take stopped there/)
    // The click after it never ran.
    expect(result.meta.steps?.map((s) => s.step)).toEqual([0, 1])
    // Each step said when it started and ended, the hung one as hung.
    const steps = events.filter((e) => e.event === 'step')
    expect(steps.map((e) => `${String(e.phase)}:${String(e.i)}`)).toEqual([
      'start:0',
      'end:0',
      'start:1',
      'end:1',
    ])
    expect(steps[3]).toMatchObject({
      id: 'check',
      do: 'expect',
      skipped: true,
      hung: true,
    })
    expect(typeof steps[3].ms).toBe('number')
  }, 90_000)
})

describe('a rehearsal', () => {
  it('warns of no dead time, since it captures no frames', async () => {
    if (!browser) return
    const logs: string[] = []
    await recordTake(
      browser,
      `${base}/`,
      {
        viewport,
        // Typing runs at its own pace in a rehearsal too: a long stretch of
        // it with no frames read as a still page under a parked cursor.
        steps: [
          { do: 'type', selector: '#field', text: 'x'.repeat(80), delayMs: 50 },
          { do: 'wait', ms: 8000 },
        ],
      },
      sink,
      (m) => logs.push(m),
      { env: {}, dryRun: true },
    )
    expect(logs.some((l) => l.includes('WARNING'))).toBe(false)
  }, 60_000)
})
