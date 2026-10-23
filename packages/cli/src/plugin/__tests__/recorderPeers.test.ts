/**
 * `peers`, over a REAL Playwright browser on a fixture collaboration app
 * served in-process: a board whose shapes, presence and remote cursors sync
 * through the server, so two browser contexts (two users, as two people
 * are) see each other's work. The take films its own page only; a peer
 * signed in from its own storage state acts off camera, started with or
 * after a take step, and what it did reaches the footage through the app.
 * The take's cursor track holds the take's own gestures and nothing of the
 * peer's. A peer with no sign-in that lands on one, and a storage state
 * that is not there, refuse the take before anything is captured.
 * Skipped, and said, where no browser launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Browser } from 'playwright'
import type { IncomingMessage, Server } from 'node:http'
import { closeBrowser } from './closeBrowser'
import { recordTake as recordInto } from '../recorder'
import { ensureTakeDir } from '../take'
import { run } from '../run'
import { formatShotList, shotList } from '../shotList'
import type { ActionsFile } from '../actions'

// The board: shapes, who is here and where their pointers are live on the
// server; every client polls it, so a peer's work shows in the filmed page.
const BOARD = `<!doctype html><html><head><meta charset="utf-8"><title>Board</title>
<style>
body{margin:0;font:14px system-ui}
#board{position:absolute;left:0;top:0;width:640px;height:400px;background:#f4f1ea}
.shape{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:4px}
.cursor{position:absolute;width:10px;height:10px;background:#c33;border-radius:50%;pointer-events:none}
#bar{position:absolute;left:0;top:400px;width:640px;height:80px;padding:8px;box-sizing:border-box}
</style></head><body>
<div id="board"></div>
<div id="bar"><div id="here"></div><div id="count"></div><div id="log"></div></div>
<script>
  var me = (document.cookie.match(/user=(\\w+)/) || [])[1] || 'ada';
  var state = { shapes: [], here: [], cursors: {}, last: '' };
  window.app = { count: function () { return state.shapes.length } };
  function post(path, body) { return fetch(path, { method: 'POST', body: JSON.stringify(body || {}) }) }
  function draw() {
    var b = document.getElementById('board');
    b.innerHTML = '';
    state.shapes.forEach(function (s) { var d = document.createElement('div'); d.className = 'shape'; d.style.left = s.x + 'px'; d.style.top = s.y + 'px'; d.style.background = s.by === me ? '#335' : '#c63'; b.appendChild(d) });
    Object.keys(state.cursors).forEach(function (u) { if (u === me) return; var c = state.cursors[u]; var d = document.createElement('div'); d.className = 'cursor'; d.dataset.user = u; d.style.left = c.x + 'px'; d.style.top = c.y + 'px'; b.appendChild(d) });
    document.getElementById('here').textContent = 'Here: ' + state.here.join(', ');
    document.getElementById('count').textContent = 'Shapes: ' + state.shapes.length;
    document.getElementById('log').textContent = state.last;
  }
  var seen = '';
  function poll() { fetch('/state').then(function (r) { return r.text() }).then(function (t) { if (t === seen) return; seen = t; state = JSON.parse(t); draw() }).catch(function () {}).then(function () { setTimeout(poll, 80) }) }
  document.getElementById('board').addEventListener('mousedown', function (e) { post('/shape', { x: e.offsetX, y: e.offsetY }) });
  var lastMove = 0;
  document.addEventListener('mousemove', function (e) { var t = Date.now(); if (t - lastMove < 40) return; lastMove = t; post('/cursor', { x: e.clientX, y: e.clientY }) });
  post('/join').then(poll);
</script>
</body></html>`

const SIGNIN = `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head>
<body><form><input name="email"><input type="password" name="password"><button>Sign in</button></form></body></html>`

interface BoardState {
  shapes: { x: number; y: number; by: string }[]
  here: string[]
  cursors: Record<string, { x: number; y: number }>
  last: string
}
let state: BoardState = { shapes: [], here: [], cursors: {}, last: '' }
const reset = () => {
  state = { shapes: [], here: [], cursors: {}, last: '' }
}

const userOf = (req: IncomingMessage) =>
  /user=(\w+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'ada'

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const user = userOf(req)
      const body = (() => {
        try {
          return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
            x?: number
            y?: number
          }
        } catch {
          return {}
        }
      })()
      const json = (v: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(v))
      }
      if (req.url === '/join' && req.method === 'POST') {
        if (!state.here.includes(user)) state.here.push(user)
        state.here.sort()
        return json({ ok: true })
      }
      if (req.url === '/shape' && req.method === 'POST') {
        state.shapes.push({ x: body.x ?? 0, y: body.y ?? 0, by: user })
        state.last = `${user} added a shape`
        return json({ ok: true })
      }
      if (req.url === '/cursor' && req.method === 'POST') {
        state.cursors[user] = { x: body.x ?? 0, y: body.y ?? 0 }
        return json({ ok: true })
      }
      if (req.url === '/state') return json(state)
      if (req.url === '/private') {
        if (user !== 'bob') {
          res.writeHead(302, { location: '/signin' })
          return res.end()
        }
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(req.url === '/signin' ? SIGNIN : BOARD)
    })
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

const VIEWPORT = { width: 640, height: 480 }

/** Bob's sign-in, as `context.storageState()` would have saved it. */
const bobState = () =>
  JSON.stringify({
    cookies: [
      {
        name: 'user',
        value: 'bob',
        domain: '127.0.0.1',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ],
    origins: [],
  })

/** A script directory: actions.json and Bob's storage state beside it. */
async function scriptDir(actions: ActionsFile): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vos-peers-'))
  await writeFile(join(dir, 'bob.json'), bobState())
  await writeFile(join(dir, 'actions.json'), JSON.stringify(actions))
  return dir
}

const boardScript = (): ActionsFile => ({
  url: `${base}/`,
  viewport: VIEWPORT,
  steps: [
    { id: 'open', do: 'wait', ms: 300 },
    { id: 'see-bob', do: 'expect', text: 'Here: ada, bob' },
    { id: 'draw', do: 'click', x: 320, y: 200 },
    { id: 'bob-drew', do: 'expect', text: 'bob added a shape' },
    { id: 'three', do: 'expect', text: 'Shapes: 3' },
    { do: 'wait', ms: 200 },
  ],
  peers: [
    {
      id: 'bob',
      storageState: 'bob.json',
      steps: [
        { after: 'draw', do: 'click', x: 500, y: 340 },
        { with: 'three', do: 'drag', x: 100, y: 300, tx: 200, ty: 320 },
      ],
    },
  ],
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

describe('a take with a peer', () => {
  it('films its own page, the peer acting off camera as another user, its work arriving through the app', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    reset()
    const script = boardScript()
    const dir = await scriptDir(script)
    const take = await mkdtemp(join(tmpdir(), 'vos-peers-take-'))
    const logs: string[] = []
    const result = await recordInto(
      browser,
      `${base}/`,
      script,
      await ensureTakeDir(take),
      (m) => logs.push(m),
      { actionsDir: dir },
    )
    expect(result.skipped).toEqual([])
    // The board saw two people and three shapes, two of them Bob's.
    expect(state.here).toEqual(['ada', 'bob'])
    expect(state.shapes.map((s) => s.by)).toEqual(['ada', 'bob', 'bob'])
    // Bob's pointer moved his own page, which the app drew as his cursor.
    expect(state.cursors.bob).toBeDefined()
    expect(result.frames.length).toBeGreaterThan(0)

    // Ordering: Bob's click began once the take's click had ended; his
    // drag began with the take's last check, which waited for it.
    const steps = result.meta.steps!
    const bob = result.meta.peers![0]
    expect(bob.id).toBe('bob')
    expect(bob.steps.map((s) => [s.do, s.after ?? s.with])).toEqual([
      ['click', 'draw'],
      ['drag', 'three'],
    ])
    expect(bob.steps[0].tStart).toBeGreaterThanOrEqual(steps[2].tEnd - 0.05)
    expect(bob.steps[1].tStart).toBeGreaterThanOrEqual(steps[4].tStart - 0.05)
    expect(bob.steps[1].tStart).toBeLessThanOrEqual(steps[4].tEnd)
    expect(result.peers[0].notRun).toEqual([])

    // The cursor track is the take's own: one press, and no sample where
    // Bob's pointer went.
    expect(result.events.filter((e) => e.type === 'down')).toHaveLength(1)
    expect(
      result.events.some(
        (e) =>
          (Math.abs(e.x - 500) < 8 && Math.abs(e.y - 340) < 8) ||
          (e.y > 290 && e.x > 90 && e.x < 210),
      ),
    ).toBe(false)
    // The script the take keeps carries its peers, never their sign-in.
    expect(result.actions.peers?.[0].storageState).toBe('bob.json')
    expect(logs.some((l) => l.includes('peer bob: goto'))).toBe(true)
  }, 90_000)

  it('says the peer step a take that ended early never reached', async () => {
    if (!browser) return
    reset()
    const script: ActionsFile = {
      url: `${base}/`,
      viewport: VIEWPORT,
      steps: [
        { id: 'open', do: 'wait', ms: 100 },
        {
          id: 'never',
          do: 'await',
          until: { text: 'this never shows' },
          timeout: 0.5,
          poll: 0.1,
        },
        { id: 'later', do: 'wait', ms: 100 },
      ],
      peers: [
        {
          id: 'bob',
          storageState: 'bob.json',
          steps: [
            { after: 'open', do: 'wait', ms: 10 },
            { with: 'later', do: 'click', x: 10, y: 10 },
          ],
        },
      ],
    }
    const dir = await scriptDir(script)
    const take = await mkdtemp(join(tmpdir(), 'vos-peers-take-'))
    const logs: string[] = []
    const result = await recordInto(
      browser,
      `${base}/`,
      script,
      await ensureTakeDir(take),
      (m) => logs.push(m),
      { actionsDir: dir },
    )
    expect(result.stopped?.step).toBe(1)
    expect(result.peers[0].steps.map((s) => s.do)).toEqual(['wait'])
    expect(result.peers[0].notRun).toEqual([1])
    expect(
      logs.some((l) =>
        l.includes(
          "peer bob #1 click: not run: the take's step later never started",
        ),
      ),
    ).toBe(true)
  }, 60_000)
})

describe('vos record with peers', () => {
  it('rehearses a peer’s steps beside the take’s, saying each', async () => {
    if (!browser) return
    reset()
    const dir = await scriptDir(boardScript())
    const r = await vos([
      'record',
      '--actions',
      join(dir, 'actions.json'),
      '--dry-run',
      '--background',
      'none',
      '--max-duration',
      '60',
    ])
    expect(r.code).toBe(0)
    expect(r.out).toContain('peer bob (off camera):')
    expect(r.out).toMatch(/✓ #0 click {2}after draw/)
    expect(r.out).toMatch(/✓ #1 drag {2}with three/)
    expect(r.out).toContain('Rehearsal passed: 6/6 steps resolved')
  }, 90_000)

  it('refuses a peer that lands on a sign-in, and a storage state that is not there', async () => {
    if (!browser) return
    reset()
    const signedOut = await scriptDir({
      url: `${base}/private`,
      viewport: VIEWPORT,
      steps: [{ do: 'wait', ms: 50 }],
      peers: [{ id: 'cy', steps: [{ do: 'wait', ms: 10 }] }],
    })
    const landed = await vos([
      'record',
      '--actions',
      join(signedOut, 'actions.json'),
      '--dry-run',
      '--background',
      'none',
      '--max-duration',
      '60',
      // The take itself is signed in; the peer is not.
      '--storage-state',
      join(signedOut, 'bob.json'),
    ])
    expect(landed.code).toBe(2)
    expect(landed.err).toContain('peer cy landed on')
    expect(landed.err).toContain(
      "give it a storageState of the second person's sign-in",
    )

    const missing = await scriptDir({
      url: `${base}/`,
      viewport: VIEWPORT,
      steps: [{ do: 'wait', ms: 50 }],
      peers: [
        {
          id: 'bob',
          storageState: 'nobody.json',
          steps: [{ do: 'wait', ms: 10 }],
        },
      ],
    })
    const gone = await vos([
      'record',
      '--actions',
      join(missing, 'actions.json'),
      '--dry-run',
      '--background',
      'none',
      '--max-duration',
      '60',
    ])
    expect(gone.code).toBe(2)
    expect(gone.err).toContain(
      'peer bob\'s storage state "nobody.json" could not be read (there is no file at',
    )
  }, 90_000)
})

describe('vos actions script with peers', () => {
  it('says what the second person does, beat by beat, against the take’s beats', () => {
    const text = formatShotList(shotList(boardScript()))
    expect(text).toContain(
      'A second person (bob) does this at the same time, in their own browser on the same page; their screen is not recorded, the app shows what they do:',
    )
    expect(text).toMatch(/bob1\. Once beat 2 is done: Click /)
    expect(text).toMatch(/bob2\. As beat 4 starts: /)
  })
})
