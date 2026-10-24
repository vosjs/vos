/**
 * `teardown` steps, over a REAL Playwright browser on a fixture page served
 * in-process: a page whose button creates a key on the server (and sets a
 * session cookie), and a keys page whose button revokes it, honoured only
 * with that cookie. The teardown runs after a take and after a rehearsal,
 * when the take stops early and when it throws, on the take's own context,
 * after the screencast has stopped; a teardown that fails is reported and
 * the take stands. Skipped, and said, where no browser launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { closeBrowser } from './closeBrowser'
import { run } from '../run'
import { SetupEnvError, recordTake } from '@vosjs/render-core/record'
import type { ActionsFile } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'

const HOME = `<!doctype html><html><head><meta charset="utf-8"><title>Keys</title>
<style>body{margin:0;font:16px system-ui}button{margin:12px;padding:10px 16px}</style>
</head><body>
<button id="create" onclick="fetch('/keys',{method:'POST'}).then(function(){var m=document.createElement('p');m.id='made';m.textContent='Key created';document.body.appendChild(m)})">Create key</button>
</body></html>`

const KEYS = `<!doctype html><html><head><meta charset="utf-8"><title>Your keys</title></head><body>
<button id="revoke" onclick="fetch('/revoke',{method:'POST'}).then(function(){document.body.style.background='#c00';var m=document.createElement('p');m.id='gone';m.textContent='Revoked';document.body.appendChild(m)})">Revoke</button>
</body></html>`

const state = { created: 0, revoked: 0, revokedAt: 0, revokedWithoutCookie: 0 }

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/keys') {
      state.created++
      res.writeHead(200, { 'set-cookie': 'sid=demo; Path=/' })
      res.end('ok')
      return
    }
    if (req.method === 'POST' && req.url === '/revoke') {
      // Only the signed-in context may revoke: the take's own cookie.
      if (/(^|;\s*)sid=demo/.test(req.headers.cookie ?? '')) {
        state.revoked++
        state.revokedAt = Date.now()
      } else state.revokedWithoutCookie++
      res.writeHead(200)
      res.end('ok')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(req.url === '/keys' ? KEYS : HOME)
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

beforeEach(() => {
  state.created = 0
  state.revoked = 0
  state.revokedAt = 0
  state.revokedWithoutCookie = 0
})

const VIEWPORT = { width: 640, height: 480 }

const script = (over: Partial<ActionsFile> = {}): ActionsFile => ({
  viewport: VIEWPORT,
  steps: [
    { do: 'click', selector: '#create', ms: 300 },
    { do: 'wait', ms: 200 },
  ],
  teardown: [
    { do: 'goto', url: `${base}/keys` },
    { do: 'click', selector: '#revoke' },
  ],
  ...over,
})

function noBrowser(): boolean {
  if (browser) return false
  console.warn(`skipped: no browser (${skipReason})`)
  return true
}

describe('teardown after a take', () => {
  it('undoes what the take created, off camera, on the take’s own session', async () => {
    if (noBrowser()) return
    const frameAt: number[] = []
    const logs: string[] = []
    const result = await recordTake(
      browser!,
      `${base}/`,
      script(),
      { frame: () => void frameAt.push(Date.now()) },
      (l) => logs.push(l),
      { env: {} },
    )
    expect(state.created).toBe(1)
    expect(state.revoked).toBe(1)
    expect(state.revokedWithoutCookie).toBe(0)
    expect(result.teardown).toEqual({ ran: 2, of: 2 })
    // Nothing of it is the take's: no step span, no frame after it began.
    expect(result.meta.steps?.map((s) => s.step)).toEqual([0, 1])
    expect(frameAt.length).toBeGreaterThan(0)
    expect(Math.max(...frameAt)).toBeLessThan(state.revokedAt)
    expect(result.meta.pageTitle).toBe('Keys')
    expect(logs).toContain('teardown: 2 step(s), off camera')
    expect(logs.some((l) => l.includes('teardown #1 click #revoke'))).toBe(true)
  }, 60_000)

  it('runs after a rehearsal too, since the rehearsal clicked for real', async () => {
    if (noBrowser()) return
    const result = await recordTake(
      browser!,
      `${base}/`,
      script(),
      { frame: () => {} },
      () => {},
      { env: {}, dryRun: true },
    )
    expect(state.created).toBe(1)
    expect(state.revoked).toBe(1)
    expect(result.teardown).toEqual({ ran: 2, of: 2 })
  }, 60_000)

  it('runs when the take stops early', async () => {
    if (noBrowser()) return
    const result = await recordTake(
      browser!,
      `${base}/`,
      script({
        steps: [
          { do: 'click', selector: '#create', ms: 300 },
          {
            do: 'await',
            until: { selector: '#never' },
            timeout: 1,
            poll: 0.25,
          },
          { do: 'wait', ms: 200 },
        ],
      }),
      { frame: () => {} },
      () => {},
      { env: {} },
    )
    expect(result.stopped?.step).toBe(1)
    expect(state.revoked).toBe(1)
    expect(result.teardown).toEqual({ ran: 2, of: 2 })
  }, 60_000)

  it('runs when the take throws after its first step, and the throw propagates', async () => {
    if (noBrowser()) return
    const logs: string[] = []
    await expect(
      recordTake(
        browser!,
        `${base}/`,
        script(),
        { frame: () => {} },
        (l) => logs.push(l),
        {
          env: {},
          onEvent: (e) => {
            if (e.event === 'step' && e.phase === 'end')
              throw new Error('the host fell over')
          },
        },
      ),
    ).rejects.toThrow('the host fell over')
    expect(state.created).toBe(1)
    expect(state.revoked).toBe(1)
    expect(logs.some((l) => l.includes('teardown: 2 step(s) ran'))).toBe(true)
  }, 60_000)

  it('reports a failing teardown and keeps the take', async () => {
    if (noBrowser()) return
    const logs: string[] = []
    const result = await recordTake(
      browser!,
      `${base}/`,
      script({
        teardown: [
          { do: 'goto', url: `${base}/keys` },
          { do: 'click', selector: '#revoke' },
          { do: 'click', selector: '#confirm-revoke' },
          { do: 'wait', ms: 10 },
        ],
      }),
      { frame: () => {} },
      (l) => logs.push(l),
      { env: {} },
    )
    expect(result.stopped).toBeNull()
    expect(result.skipped).toEqual([])
    expect(result.meta.durationMs).toBeGreaterThan(0)
    expect(result.teardown?.ran).toBe(2)
    expect(result.teardown?.of).toBe(4)
    expect(result.teardown?.failed).toMatchObject({
      step: 2,
      do: 'click',
      selector: '#confirm-revoke',
    })
    expect(result.teardown?.failed?.error).toMatch(/timeout/i)
    expect(
      logs.some((l) =>
        l.includes('TEARDOWN FAILED at teardown[2] (click #confirm-revoke): '),
      ),
    ).toBe(true)
  }, 60_000)

  it('refuses before anything runs when a teardown variable is not set', async () => {
    if (noBrowser()) return
    await expect(
      recordTake(
        browser!,
        `${base}/`,
        script({
          teardown: [
            { do: 'type', selector: '#reason', text: { env: 'TD_REASON' } },
          ],
        }),
        { frame: () => {} },
        () => {},
        { env: {} },
      ),
    ).rejects.toBeInstanceOf(SetupEnvError)
    expect(state.created).toBe(0)
  }, 60_000)
})

describe('vos record --dry-run with a teardown', () => {
  async function actionsFile(over: Partial<ActionsFile>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'vos-teardown-'))
    const file = join(dir, 'actions.json')
    await writeFile(
      file,
      JSON.stringify({ url: `${base}/`, ...script(over) }, null, 2),
    )
    return file
  }

  async function capture(argv: string[]): Promise<{
    code: number
    out: string
  }> {
    const out: string[] = []
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((s) => out.push(String(s)) > 0)
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true)
    try {
      const code = await run(argv)
      return { code, out: out.join('') }
    } finally {
      spy.mockRestore()
      errSpy.mockRestore()
    }
  }

  it('carries the teardown on the done event', async () => {
    if (noBrowser()) return
    const file = await actionsFile({})
    const { code, out } = await capture([
      'record',
      '--actions',
      file,
      '--dry-run',
      '--background',
      'none',
      '--json',
    ])
    expect(code).toBe(0)
    const done = out
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((e) => e.event === 'done')
    expect(done?.teardown).toEqual({ ran: 2, of: 2 })
    expect(state.revoked).toBe(1)
  }, 60_000)

  it('says a failed teardown in words and keeps the exit code', async () => {
    if (noBrowser()) return
    const file = await actionsFile({
      teardown: [{ do: 'click', selector: '#gone-already' }],
    })
    const { code, out } = await capture([
      'record',
      '--actions',
      file,
      '--dry-run',
      '--background',
      'none',
    ])
    expect(code).toBe(0)
    expect(out).toContain('Rehearsal passed')
    expect(out).toContain(
      'TEARDOWN FAILED at teardown[0] (click #gone-already): ',
    )
    expect(out).toContain(
      'What the take created may still be in the product; remove it by hand.',
    )
  }, 60_000)
})
