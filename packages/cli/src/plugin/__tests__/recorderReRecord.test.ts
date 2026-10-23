/**
 * A take re-records from its own script, over a REAL Playwright browser on
 * a fixture page served in-process: the script a take keeps is
 * self-contained (a path a file held is written inline, a pasted file is
 * kept beside it), so the take records the same points with the original
 * files gone, and a script whose pasted file is missing says what it
 * needs. Skipped, and said, where no browser launches.
 */
import { createServer } from 'node:http'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'
import { closeBrowser } from './closeBrowser'
import { recordTake as recordInto } from '../recorder'
import { ensureTakeDir } from '../take'
import type { ActionsFile } from '../actions'

const CANVAS = `<!doctype html><html><head><meta charset="utf-8"><title>Canvas</title>
<style>body{margin:0}#board{position:absolute;left:0;top:0;width:640px;height:400px;background:#f4f4f4}</style></head><body>
<canvas id="board" width="640" height="400" tabindex="0"></canvas>
<pre id="mirror" style="position:absolute;left:0;top:470px;margin:0;font-size:2px;line-height:2px;max-height:4px;overflow:hidden"></pre>
<script>
window.log = [];
const board = document.getElementById('board');
board.addEventListener('pointermove', (e) => { if (e.buttons) log.push({ k: 'move', x: e.clientX, y: e.clientY }) });
document.addEventListener('paste', (e) => log.push({ k: 'paste', files: e.clipboardData.files.length }));
const mirror = document.getElementById('mirror');
const push = Array.prototype.push;
log.push = function () { const r = push.apply(log, arguments); mirror.textContent = JSON.stringify(log); return r };
</script></body></html>`

/** A real 4x4 red PNG, assembled here: the browser's clipboard decodes what it holds. */
function tinyPng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(4, 0)
  ihdr.writeUInt32BE(4, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0])
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat([row, row, row, row]))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

interface Logged {
  k: string
  [key: string]: unknown
}

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''
let dir = ''
const VIEWPORT = { width: 640, height: 480 }

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(CANVAS)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  dir = await mkdtemp(join(tmpdir(), 'vos-rerecord-'))
  await writeFile(
    join(dir, 'loop.json'),
    JSON.stringify({
      points: [
        [100, 100, 0],
        [140, 120, 60],
        [180, 100, 120],
        [140, 80, 180],
      ],
    }),
  )
  await writeFile(join(dir, 'dot.png'), tinyPng())
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

describe('a take re-records from its own script', () => {
  it('keeps a path inline and a pasted file beside it, so the take records the same points with the originals gone', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    // The script and its files live in a directory of their own.
    const src = await mkdtemp(join(tmpdir(), 'vos-script-'))
    await copyFile(join(dir, 'loop.json'), join(src, 'stroke.json'))
    await copyFile(join(dir, 'dot.png'), join(src, 'dot.png'))
    const script: ActionsFile = {
      url: `${base}/`,
      viewport: VIEWPORT,
      steps: [
        { do: 'drag', path: 'stroke.json' },
        { do: 'click', selector: '#board' },
        { do: 'paste', file: 'dot.png' },
        { do: 'wait', ms: 80, read: '#mirror' },
      ],
    }
    await writeFile(join(src, 'actions.json'), JSON.stringify(script))
    const moves = (text: string | undefined) =>
      (JSON.parse(text ?? '[]') as Logged[])
        .filter((l) => l.k === 'move')
        .map((l) => [l.x, l.y])
    const pastes = (text: string | undefined) =>
      (JSON.parse(text ?? '[]') as Logged[]).filter((l) => l.k === 'paste')

    const takeA = await mkdtemp(join(tmpdir(), 'vos-take-a-'))
    const first = await recordInto(
      browser,
      `${base}/`,
      script,
      await ensureTakeDir(takeA),
      () => {},
      { actionsDir: src },
    )
    const firstMoves = moves(first.meta.steps?.at(-1)?.text)
    expect(firstMoves).toEqual([
      [140, 120],
      [180, 100],
      [140, 80],
    ])
    // The take's script is self-contained: the stroke inline with its
    // times, the pasted file kept beside it under its own name.
    const kept = JSON.parse(
      await readFile(join(takeA, 'actions.json'), 'utf8'),
    ) as ActionsFile
    expect(kept.steps[0]).toEqual({
      do: 'drag',
      path: [
        [100, 100, 0],
        [140, 120, 60],
        [180, 100, 120],
        [140, 80, 180],
      ],
    })
    expect(kept.steps[2]).toEqual({ do: 'paste', file: 'paste-dot.png' })
    expect(existsSync(join(takeA, 'paste-dot.png'))).toBe(true)

    // The originals go; the take records again from its own script.
    await rm(src, { recursive: true })
    const takeB = await mkdtemp(join(tmpdir(), 'vos-take-b-'))
    const again = await recordInto(
      browser,
      `${base}/`,
      kept,
      await ensureTakeDir(takeB),
      () => {},
      { actionsDir: takeA },
    )
    expect(again.skipped).toEqual([])
    expect(moves(again.meta.steps?.at(-1)?.text)).toEqual(firstMoves)
    expect(pastes(again.meta.steps?.at(-1)?.text)).toHaveLength(1)
    const pathT = (r: typeof first) => {
      const s = r.meta.steps![0]
      const t = r.events
        .filter(
          (e) =>
            e.type === 'move' &&
            e.t >= s.tStart * 1000 &&
            e.t <= s.tEnd * 1000 &&
            [140, 180].includes(e.x),
        )
        .map((e) => e.t)
      return t.at(-1)! - t[0]
    }
    // The same timing, within a few frames of scheduling.
    expect(Math.abs(pathT(again) - pathT(first))).toBeLessThan(80)

    // A script whose pasted file is not beside it says what it needs.
    const bare = await mkdtemp(join(tmpdir(), 'vos-take-c-'))
    await expect(
      recordInto(
        browser,
        `${base}/`,
        kept,
        await ensureTakeDir(bare),
        () => {},
        { actionsDir: bare },
      ),
    ).rejects.toThrow(/a file paste needs its file beside the script/)
  }, 90_000)
})
