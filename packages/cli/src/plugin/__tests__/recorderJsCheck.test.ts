/**
 * A check on the app's own state, over a REAL Playwright browser on a
 * fixture page served in-process: a canvas app keeps what it shows in
 * script, so the DOM says nothing about how many shapes are on the board.
 * An `expect` with `js` holds when the page's expression does, misses with
 * the value it got, and keeps that value on the step; an `await` with
 * `js` waits off camera for it; and a rehearsal through the command line
 * fails on the miss, naming the value. Skipped, and said, where no browser
 * launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closeBrowser } from './closeBrowser'
import { run } from '../run'
import { recordTake } from '@vosjs/render-core/record'
import type { FrameSink } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'

// A board whose shapes live in script: the canvas is drawn, the DOM never
// changes. "Add" adds one shape; "Add later" adds two, a beat apart.
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Board</title>
<style>body{margin:0;font:16px system-ui}button{margin:12px;padding:10px 16px}</style>
</head><body>
<button id="add">Add</button><button id="later">Add later</button>
<canvas id="c" width="400" height="300"></canvas>
<script>
  var shapes = [];
  function draw() { var g = document.getElementById('c').getContext('2d'); g.clearRect(0,0,400,300); shapes.forEach(function (s, i) { g.fillRect(20 + i * 30, 20, 20, 20) }) }
  window.app = {
    count: function () { return shapes.length },
    shapes: function () { return shapes.slice() },
    ready: Promise.resolve(true),
  };
  document.getElementById('add').onclick = function () { shapes.push({ kind: 'box' }); draw() };
  document.getElementById('later').onclick = function () {
    setTimeout(function () { shapes.push({ kind: 'box' }); draw() }, 600);
    setTimeout(function () { shapes.push({ kind: 'note' }); draw() }, 1200);
  };
</script>
</body></html>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(FIXTURE)
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
  await closeBrowser(browser)
  server?.close()
}, 30_000)

const frameSink = (): FrameSink => ({ frame: () => {} })
const VIEWPORT = { width: 640, height: 480 }

describe('expect js', () => {
  it('holds on the app’s own state, misses with the value it got, and keeps the value', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const logs: string[] = []
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: VIEWPORT,
        steps: [
          { do: 'expect', js: 'window.app.count() === 0' },
          { do: 'click', selector: '#add' },
          { id: 'one', do: 'expect', js: 'window.app.count()', equals: 1 },
          {
            do: 'expect',
            js: 'window.app.shapes()',
            equals: [{ kind: 'box' }],
          },
          { do: 'expect', js: 'window.app.ready' },
          {
            id: 'fourteen',
            do: 'expect',
            js: 'window.app.count()',
            equals: 14,
            timeout: 0.5,
          },
          { do: 'expect', js: 'window.app.count() === 14', timeout: 0.5 },
          { do: 'expect', js: 'window.nothing.count()', timeout: 0.5 },
        ],
      },
      frameSink(),
      (m) => logs.push(m),
      { dryRun: true, env: {} },
    )
    expect(result.skipped).toEqual([
      {
        step: 5,
        id: 'fourteen',
        do: 'expect',
        selector: '',
        reason: 'js `window.app.count()` was 1, not 14, for 0.5 s',
      },
      {
        step: 6,
        do: 'expect',
        selector: '',
        reason: 'js `window.app.count() === 14` was false for 0.5 s',
      },
      {
        step: 7,
        do: 'expect',
        selector: '',
        reason: expect.stringMatching(
          /^js `window\.nothing\.count\(\)` threw for 0\.5 s \(.*undefined.*\)$/,
        ) as unknown as string,
      },
    ])
    const steps = result.meta.steps ?? []
    expect(steps[0].value).toBe(true)
    expect(steps[2].value).toBe(1)
    expect(steps[3].value).toEqual([{ kind: 'box' }])
    expect(steps[4].value).toBe(true)
    expect(steps[5].value).toBe(1)
    // A throw has no value to keep.
    expect(steps[7]).not.toHaveProperty('value')
    expect(logs).toContain('expect js `window.app.count()` to equal 1: holds')
    // A check moves no cursor and presses nothing.
    expect(result.events.filter((e) => e.type === 'down')).toHaveLength(1)
  }, 60_000)
})

describe('await js', () => {
  it('waits off camera until the app’s state holds, and keeps the value it held at', async () => {
    if (!browser) return
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: VIEWPORT,
        steps: [
          { do: 'click', selector: '#later' },
          {
            id: 'two',
            do: 'await',
            until: { js: 'window.app.count()', equals: 2 },
            poll: 0.2,
            timeout: 10,
          },
          { do: 'wait', ms: 100 },
        ],
      },
      frameSink(),
      () => {},
      { env: {} },
    )
    expect(result.skipped).toEqual([])
    const wait = result.meta.steps?.[1]
    expect(wait?.value).toBe(2)
    expect(wait?.offCameraMs).toBeGreaterThan(800)
    expect(result.meta.skips?.[0]).toMatchObject({ step: 1, id: 'two' })
  }, 60_000)
})

/** `vos <argv>` through the dispatcher, as the binary runs it. */
async function vos(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((s: string | Uint8Array) => {
      out.push(String(s))
      return true
    })
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((s: string | Uint8Array) => {
      err.push(String(s))
      return true
    })
  try {
    return { code: await run(argv), out: out.join(''), err: err.join('') }
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
  }
}

describe('vos record with a js check', () => {
  it('fails a rehearsal on a miss, naming the value the app gave', async () => {
    if (!browser) return
    const dir = await mkdtemp(join(tmpdir(), 'vos-js-check-'))
    const file = join(dir, 'actions.json')
    await writeFile(
      file,
      JSON.stringify({
        url: `${base}/`,
        viewport: VIEWPORT,
        steps: [
          { do: 'click', selector: '#add' },
          { do: 'click', selector: '#add' },
          {
            id: 'board',
            do: 'expect',
            js: 'window.app.count()',
            equals: 14,
            timeout: 0.5,
          },
        ],
      }),
    )
    const r = await vos([
      'record',
      '--actions',
      file,
      '--dry-run',
      '--background',
      'none',
      '--max-duration',
      '60',
    ])
    expect(r.code).toBe(2)
    expect(r.out + r.err).toContain(
      'js `window.app.count()` was 2, not 14, for 0.5 s',
    )
  }, 90_000)

  it('refuses an expression that does not parse before a browser opens', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vos-js-parse-'))
    const file = join(dir, 'actions.json')
    await writeFile(
      file,
      JSON.stringify({
        url: 'http://127.0.0.1:9/',
        steps: [{ do: 'expect', js: 'window.app.count() ===' }],
      }),
    )
    const r = await vos(['validate', file])
    expect(r.code).toBe(2)
    expect(r.err).toContain(
      'steps[0]: expect js does not parse as an expression',
    )
  })
})
