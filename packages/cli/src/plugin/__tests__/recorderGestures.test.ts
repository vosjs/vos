/**
 * The canvas gestures over a REAL Playwright browser on fixture pages
 * served in-process: a page that logs every key, pointer, click and paste
 * it receives, and a page that lags (it busy-loops on every pointer move
 * and keeps changing its DOM after a release). The page must see exactly
 * what the script asked (the chord and its modifiers, the modifiers held
 * through a drag, the path's points in order, the click count and button,
 * the pasted words and file), the cursor track must carry each gesture's
 * points and never a key's identity, a settle must wait the lag out, and a
 * gesture that outran the page must be reported. Skipped, and said, where
 * no browser launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordTake } from '@vosjs/render-core/record'
import type { FrameSink } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'
import { closeBrowser } from './browserTeardown'
import { actionsDirFiles, scriptForHost } from '../recorder'

const CANVAS = `<!doctype html><html><head><meta charset="utf-8"><title>Canvas</title>
<style>body{margin:0;font:16px system-ui}#board{position:absolute;left:0;top:0;width:640px;height:400px;background:#f4f4f4}
#field{position:absolute;left:20px;top:420px;width:300px;height:30px}</style></head><body>
<canvas id="board" width="640" height="400" tabindex="0"></canvas>
<input id="field">
<script>
window.log = [];
const mods = (e) => (e.shiftKey ? 'S' : '') + (e.altKey ? 'A' : '') + (e.ctrlKey ? 'C' : '') + (e.metaKey ? 'M' : '');
document.addEventListener('keydown', (e) => log.push({ k: 'key', key: e.key, mods: mods(e), trusted: e.isTrusted }));
const board = document.getElementById('board');
board.addEventListener('pointerdown', (e) => log.push({ k: 'down', x: e.clientX, y: e.clientY, mods: mods(e), type: e.pointerType, pressure: e.pressure, button: e.button }));
board.addEventListener('pointermove', (e) => { if (e.buttons) log.push({ k: 'move', x: e.clientX, y: e.clientY, mods: mods(e), type: e.pointerType, pressure: e.pressure }) });
board.addEventListener('pointerup', (e) => log.push({ k: 'up', x: e.clientX, y: e.clientY, mods: mods(e) }));
board.addEventListener('click', (e) => log.push({ k: 'click', detail: e.detail }));
board.addEventListener('dblclick', () => log.push({ k: 'dblclick' }));
board.addEventListener('auxclick', (e) => log.push({ k: 'auxclick', button: e.button }));
board.addEventListener('contextmenu', (e) => { e.preventDefault(); log.push({ k: 'contextmenu' }) });
document.addEventListener('paste', (e) => {
  const files = [...e.clipboardData.files].map((f) => ({ type: f.type, size: f.size }));
  log.push({ k: 'paste', trusted: e.isTrusted, text: e.clipboardData.getData('text/plain'), files, target: document.activeElement && document.activeElement.id });
});
</script></body></html>`

// A page that cannot keep up: every pointer move costs it 40 ms of main
// thread, and a release starts 1.2 s of DOM changes.
const LAGGY = `<!doctype html><html><head><meta charset="utf-8"><title>Laggy</title>
<style>body{margin:0}#board{position:absolute;left:0;top:0;width:640px;height:400px;background:#eee}</style></head><body>
<div id="board"></div><ol id="out"></ol>
<script>
window.moves = 0;
window.lastChange = 0;
const board = document.getElementById('board');
board.addEventListener('pointermove', (e) => { if (!e.buttons) return; const t = performance.now(); while (performance.now() - t < 40) {} window.moves++ });
board.addEventListener('pointerup', () => {
  const started = performance.now();
  const tick = () => {
    const li = document.createElement('li'); li.textContent = String(performance.now());
    document.getElementById('out').appendChild(li);
    window.lastChange = Date.now();
    if (performance.now() - started < 1200) setTimeout(tick, 50);
  };
  tick();
});
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
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const row = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0])
  const raw = Buffer.concat([row, row, row, row])
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

// The recorder closes its context at the end, so each page mirrors its
// log into elements the last steps' \`read\` keeps, on every entry. A read
// keeps at most 2 KB of words, so the log rides as base64 (no whitespace to
// collapse) in CHUNKS chunks of 2000 characters.
const CHUNKS = 8
const MIRROR = `<div style="position:absolute;left:0;top:470px">${Array.from(
  { length: CHUNKS },
  (_, i) =>
    `<pre id="m${i}" style="display:inline-block;width:4px;height:2px;margin:0;overflow:hidden;font-size:1px"></pre>`,
).join(
  '',
)}</div><script>(function(){var l=window.log;if(!l)return;var push=Array.prototype.push;function show(){var b=btoa(unescape(encodeURIComponent(JSON.stringify(l))));for(var i=0;i<${CHUNKS};i++)document.getElementById('m'+i).textContent=b.slice(i*2000,(i+1)*2000)}show();l.push=function(){var r=push.apply(l,arguments);show();return r}})()</script>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''
let dir = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      (req.url === '/laggy' ? LAGGY : CANVAS).replace(
        '</body>',
        `${MIRROR}</body>`,
      ),
    )
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  dir = await mkdtemp(join(tmpdir(), 'vos-gestures-'))
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
  // Not a PNG at all: the browser's clipboard will not hold it.
  await writeFile(join(dir, 'broken.png'), new Uint8Array([1, 2, 3, 4, 5]))
  await writeFile(
    join(dir, 'mark.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>',
  )
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

const sink = (): FrameSink => ({ frame: () => {} })
const VIEWPORT = { width: 640, height: 480 }

interface Logged {
  k: string
  [key: string]: unknown
}

/** Record `steps` on a fixture page and hand back what the page logged, read off its mirror by the last step. */
async function record(
  steps: Parameters<typeof recordTake>[2]['steps'],
  opts: Partial<Parameters<typeof recordTake>[5]> & { page?: string } = {},
) {
  const { page = '/', ...rest } = opts
  const lines: string[] = []
  const result = await recordTake(
    browser!,
    `${base}${page}`,
    {
      viewport: VIEWPORT,
      steps: [
        ...steps,
        ...Array.from({ length: CHUNKS }, (_, i) => ({
          do: 'wait' as const,
          ms: i === 0 ? 80 : 1,
          read: `#m${i}`,
        })),
      ],
    },
    sink(),
    (m) => lines.push(m),
    { env: {}, files: actionsDirFiles(dir), ...rest },
  )
  const b64 = (result.meta.steps ?? [])
    .slice(-CHUNKS)
    .map((st) => st.text ?? '')
    .join('')
  const text = b64 ? Buffer.from(b64, 'base64').toString('utf8') : '[]'
  return { result, logged: JSON.parse(text) as Logged[], lines }
}

describe('press speaks chords, plain keys and sequences', () => {
  it('sends the chord with its modifiers, a bare letter, and a sequence in order, each a ping with no key in it', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const { result, logged } = await record([
      { do: 'click', selector: '#board' },
      { do: 'press', keys: 'Shift+D' },
      { do: 'press', keys: 'Mod+z' },
      { do: 'press', keys: 'r' },
      { do: 'press', keys: ['v', 'Escape'] },
    ])
    const keys = logged.filter(
      (l) =>
        l.k === 'key' &&
        !['Shift', 'Meta', 'Control'].includes(l.key as string),
    )
    const mod = process.platform === 'darwin' ? 'M' : 'C'
    expect(keys.map((k) => `${k.mods as string}:${k.key as string}`)).toEqual([
      'S:D',
      `${mod}:z`,
      ':r',
      ':v',
      ':Escape',
    ])
    expect(keys.every((k) => k.trusted)).toBe(true)
    // One ping per key, and a ping carries where, never which.
    const pings = result.events.filter((e) => e.type === 'key')
    expect(pings).toHaveLength(5)
    expect(JSON.stringify(result.events)).not.toMatch(/Escape|"D"|Shift/)
    // A sequence is a person's hand apart, not a burst.
    const seq = result.meta.steps![4]
    expect(seq.tEnd - seq.tStart).toBeGreaterThan(0.14)
  }, 60_000)
})

describe('drag holds modifiers and draws a path', () => {
  it('holds the modifiers from the press to the release of a straight drag', async () => {
    if (!browser) return
    const { result, logged } = await record([
      {
        do: 'drag',
        x: 100,
        y: 100,
        tx: 300,
        ty: 200,
        ms: 300,
        modifiers: ['Alt', 'Shift'],
      },
    ])
    const pointer = logged.filter((l) => ['down', 'move', 'up'].includes(l.k))
    expect(pointer[0]).toMatchObject({ k: 'down', x: 100, y: 100, mods: 'SA' })
    expect(pointer.at(-1)).toMatchObject({
      k: 'up',
      x: 300,
      y: 200,
      mods: 'SA',
    })
    expect(pointer.every((p) => p.mods === 'SA')).toBe(true)
    // Released after: a later key carries no modifier.
    expect(result.events.filter((e) => e.type === 'down')).toHaveLength(1)
  }, 60_000)

  it('replays an inline path point by point, evenly over ms, the press at the first and the release at the last', async () => {
    if (!browser) return
    const path: [number, number][] = [
      [50, 50],
      [80, 70],
      [120, 60],
      [150, 120],
      [200, 140],
    ]
    const { result, logged } = await record([{ do: 'drag', path, ms: 400 }])
    const down = logged.find((l) => l.k === 'down')
    const moves = logged.filter((l) => l.k === 'move')
    const up = logged.find((l) => l.k === 'up')
    expect([down?.x, down?.y]).toEqual([50, 50])
    expect(moves.map((m) => [m.x, m.y])).toEqual(path.slice(1))
    expect([up?.x, up?.y]).toEqual([200, 140])
    // The cursor track carries the path: the down at its first point, a
    // move at every later point in order, the up at its last.
    const s = result.meta.steps![0]
    const inStep = result.events.filter(
      (e) => e.t >= s.tStart * 1000 && e.t <= s.tEnd * 1000,
    )
    const downAt = inStep.findIndex((e) => e.type === 'down')
    const upAt = inStep.findIndex((e) => e.type === 'up')
    expect([inStep[downAt].x, inStep[downAt].y]).toEqual([50, 50])
    expect(
      inStep
        .slice(downAt + 1, upAt)
        .filter((e) => e.type === 'move')
        .map((e) => [e.x, e.y]),
    ).toEqual(path.slice(1))
    expect([inStep[upAt].x, inStep[upAt].y]).toEqual([200, 140])
    // Evenly over 400 ms.
    const moveT = inStep
      .slice(downAt + 1, upAt)
      .filter((e) => e.type === 'move')
      .map((e) => e.t)
    expect(moveT.at(-1)! - moveT[0]).toBeGreaterThan(250)
  }, 60_000)

  it('reads a timed path from a file beside the actions file and keeps its timing', async () => {
    if (!browser) return
    const { result, logged } = await record([
      { do: 'drag', path: 'loop.json', modifiers: ['Mod'] },
    ])
    const moves = logged.filter((l) => l.k === 'move')
    expect(moves.map((m) => [m.x, m.y])).toEqual([
      [140, 120],
      [180, 100],
      [140, 80],
    ])
    const mod = process.platform === 'darwin' ? 'M' : 'C'
    expect(moves.every((m) => m.mods === mod)).toBe(true)
    const t = result.events
      .filter((e) => e.type === 'move' && [140, 180].includes(e.x))
      .map((e) => e.t)
    expect(t.at(-1)! - t[0]).toBeGreaterThanOrEqual(100)
  }, 60_000)

  it('draws with a pen when the points carry pressure', async () => {
    if (!browser) return
    const { logged } = await record([
      {
        do: 'drag',
        path: [
          [60, 60, 0, 0.2],
          [90, 80, 30, 0.6],
          [120, 90, 60, 0.9],
        ],
        modifiers: ['Shift'],
      },
    ])
    const down = logged.find((l) => l.k === 'down')
    const moves = logged.filter((l) => l.k === 'move')
    expect(down).toMatchObject({ type: 'pen', mods: 'S' })
    expect(down!.pressure as number).toBeCloseTo(0.2, 2)
    expect(moves.map((m) => +(m.pressure as number).toFixed(2))).toEqual([
      0.6, 0.9,
    ])
    expect(moves.every((m) => m.type === 'pen' && m.mods === 'S')).toBe(true)
  }, 60_000)

  it('refuses a path file outside the directory, or a link, before capturing anything', async () => {
    if (!browser) return
    await symlink(join(dir, 'loop.json'), join(dir, 'link.json'))
    await expect(record([{ do: 'drag', path: 'link.json' }])).rejects.toThrow(
      /symbolic link/,
    )
    await expect(
      recordTake(
        browser,
        `${base}/`,
        { viewport: VIEWPORT, steps: [{ do: 'drag', path: 'loop.json' }] },
        sink(),
        () => {},
        { env: {} },
      ),
    ).rejects.toThrow(/no actions directory/)
  }, 60_000)
})

describe('click counts and picks its button', () => {
  it('double- and triple-clicks with the platform interval, and presses the right and middle buttons', async () => {
    if (!browser) return
    const { result, logged } = await record([
      { do: 'click', selector: '#board', count: 2 },
      { do: 'click', selector: '#board', count: 3 },
      { do: 'click', selector: '#board', button: 'right' },
      { do: 'click', selector: '#board', button: 'middle' },
    ])
    const clicks = logged.filter((l) => l.k === 'click').map((l) => l.detail)
    expect(clicks).toEqual([1, 2, 1, 2, 3])
    expect(logged.filter((l) => l.k === 'dblclick')).toHaveLength(2)
    expect(logged.some((l) => l.k === 'contextmenu')).toBe(true)
    expect(
      logged.filter((l) => l.k === 'auxclick').map((l) => l.button),
    ).toContain(1)
    const downs = result.events.filter((e) => e.type === 'down')
    expect(downs.map((d) => d.button)).toEqual([0, 0, 0, 0, 0, 2, 1])
  }, 60_000)
})

describe('paste puts it where a person’s ⌘V does', () => {
  it('pastes words into a field and a file onto the canvas, trusted, as typing pings', async () => {
    if (!browser) return
    const { result, logged, lines } = await record([
      { do: 'paste', selector: '#field', text: 'hello canvas' },
      { do: 'click', selector: '#board' },
      { do: 'paste', file: 'dot.png' },
    ])
    const pastes = logged.filter((l) => l.k === 'paste')
    expect(pastes).toHaveLength(2)
    expect(pastes[0]).toMatchObject({
      trusted: true,
      text: 'hello canvas',
      target: 'field',
    })
    expect(pastes[1]).toMatchObject({ trusted: true, target: 'board' })
    expect(pastes[1].files).toEqual([
      { type: 'image/png', size: expect.any(Number) },
    ])
    expect(result.skipped).toEqual([])
    expect(lines).toContain('paste 12 chars into #field')
    // The words never reach the cursor track.
    expect(JSON.stringify(result.events)).not.toContain('hello')
    expect(result.events.filter((e) => e.type === 'key')).toHaveLength(2)
  }, 60_000)
})

describe('paste when the clipboard refuses', () => {
  it('dispatches the paste in the page, says so, and an SVG rides as its markup too', async () => {
    if (!browser) return
    const { result, logged, lines } = await record([
      { do: 'click', selector: '#board' },
      { do: 'paste', file: 'broken.png' },
      { do: 'paste', file: 'mark.svg' },
    ])
    const pastes = logged.filter((l) => l.k === 'paste')
    expect(pastes).toHaveLength(2)
    expect(pastes[0]).toMatchObject({ trusted: false, target: 'board' })
    expect(
      lines.some((l) =>
        /^paste the file broken\.png, dispatched in the page \(the browser's clipboard refused it: .+\); its events are untrusted$/.test(
          l,
        ),
      ),
    ).toBe(true)
    expect(pastes[1].text as string).toContain('<svg')
    expect(result.skipped).toEqual([])
  }, 60_000)
})

describe('the script a hosted take runs', () => {
  it('goes up with every path inline, the paste left for the refusal to name', async () => {
    const sent = await scriptForHost(
      {
        steps: [
          { do: 'drag', path: 'loop.json' },
          { do: 'paste', file: 'not-here.png' },
        ],
      },
      dir,
    )
    expect(Array.isArray((sent.steps[0] as { path: unknown }).path)).toBe(true)
    expect(sent.steps[1]).toEqual({ do: 'paste', file: 'not-here.png' })
    await expect(
      scriptForHost({ steps: [{ do: 'drag', path: 'gone.json' }] }, dir),
    ).rejects.toThrow(/could not be read beside the actions file/)
  })
})

describe('a page that cannot keep up', () => {
  const stroke = (n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [40 + i * 10, 100 + (i % 3) * 5])

  it('is reported: a drawn path that ran past its script names its step and how far over', async () => {
    if (!browser) return
    const { result, lines } = await record(
      [{ id: 'scribble', do: 'drag', path: stroke(20), ms: 200 }],
      { page: '/laggy' },
    )
    expect(result.overruns).toHaveLength(1)
    const o = result.overruns[0]
    expect(o).toMatchObject({
      step: 0,
      id: 'scribble',
      do: 'drag',
      plannedMs: 200,
    })
    expect(o.tookMs).toBeGreaterThan(500)
    expect(result.meta.steps![0].overrunMs).toBe(o.overrunMs)
    expect(
      lines.some((l) =>
        /1 step ran \d+\.\d× slower than scripted \(#0 \(scribble\) drag\): the page could not keep up; add settle or raise ms/.test(
          l,
        ),
      ),
    ).toBe(true)
  }, 60_000)

  it('settles: the next step waits until the page stopped changing, and no settle means no wait', async () => {
    if (!browser) return
    const run = (settle: boolean) =>
      record(
        [
          { do: 'drag', path: stroke(4), ms: 100, settle },
          { do: 'wait', ms: 10 },
        ],
        { page: '/laggy' },
      )
    const waited = await run(true)
    const s = waited.result.meta.steps![0]
    // The release starts 1.2 s of DOM changes (the drag's own 0.4 s hold
    // after the release sees the first of them); the settle outlasts the
    // rest by its quiet.
    expect(s.settleMs).toBeGreaterThanOrEqual(900)
    expect(s.settleMs).toBeLessThan(4000)
    const plain = await run(false)
    expect(plain.result.meta.steps![0].settleMs).toBeUndefined()
    const span = (r: typeof plain) =>
      r.result.meta.steps![0].tEnd - r.result.meta.steps![0].tStart
    expect(span(waited) - span(plain)).toBeGreaterThan(0.6)
  }, 60_000)
})
