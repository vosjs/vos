/**
 * `vos session exec` runs a person's own browser code inside a saved
 * session, opened the way every vos verb opens one, so the script never
 * has to launch the profile itself (the way a session is lost). On a
 * profile the system Chrome keeps: a cookie set in one run is read in the
 * next, a script's error comes back after the profile is closed (the next
 * run still opens it), and a script that cannot run is refused in words.
 * The real-browser cases are skipped, and said, where there is no system
 * Chrome.
 */
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { run } from '../run'
import { systemChromePath } from '../session'
import { ExecScriptError, execInProfile, loadExecScript } from '../sessionExec'
import type { ExecScript } from '../sessionExec'
import type { Server } from 'node:http'

let server: Server | undefined
let base = ''
let skip = ''

beforeAll(async () => {
  try {
    systemChromePath()
  } catch (e) {
    skip = e instanceof Error ? e.message.split(':')[0] : String(e)
  }
  server = createServer((req, res) => {
    if (req.url === '/set') {
      res.writeHead(200, {
        'content-type': 'text/html',
        // A lasting cookie, so the profile keeps it between runs.
        'set-cookie': 'key=made; Max-Age=3600; Path=/',
      })
      res.end('<!doctype html><title>Made</title><p>made</p>')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      `<!doctype html><title>Keys</title><p id="c">${req.headers.cookie ?? 'none'}</p>`,
    )
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(() => {
  server?.close()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const script = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'vos-exec-script-'))
  const file = join(dir, 'script.mjs')
  writeFileSync(file, body)
  return file
}

describe('execInProfile (a script inside a saved session)', () => {
  it('hands the script the context and a page on --url, and the profile keeps what it set for the next run', async () => {
    if (skip) {
      console.warn(`skipped: no system Chrome (${skip})`)
      return
    }
    const profile = mkdtempSync(join(tmpdir(), 'vos-exec-profile-'))
    const first: ExecScript = async ({ page, url, name }) => ({
      title: await page.title(),
      url,
      name,
    })
    expect(
      await execInProfile(profile, first, { name: 'acme', url: `${base}/set` }),
    ).toEqual({ title: 'Made', url: `${base}/set`, name: 'acme' })

    const second: ExecScript = async ({ page }) => {
      await page.goto(`${base}/keys`)
      return page.textContent('#c')
    }
    expect(await execInProfile(profile, second, { name: 'acme' })).toBe(
      'key=made',
    )
  }, 60_000)

  it("returns the script's error after closing the profile, which the next run opens again", async () => {
    if (skip) {
      console.warn(`skipped: no system Chrome (${skip})`)
      return
    }
    const profile = mkdtempSync(join(tmpdir(), 'vos-exec-profile-'))
    const boom: ExecScript = async () => {
      throw new Error('the menu never opened')
    }
    await expect(
      execInProfile(profile, boom, { name: 'acme', url: `${base}/keys` }),
    ).rejects.toThrow('the menu never opened')
    const after: ExecScript = async ({ page }) => {
      await page.goto(`${base}/keys`)
      return page.title()
    }
    expect(await execInProfile(profile, after, { name: 'acme' })).toBe('Keys')
  }, 60_000)
})

describe('loadExecScript (a script that cannot run is said in words)', () => {
  it('needs a module file with a default export function', async () => {
    await expect(loadExecScript('/no/such/script.mjs')).rejects.toThrow(
      ExecScriptError,
    )
    await expect(
      loadExecScript(script('export default 1').replace('.mjs', '.ts')),
    ).rejects.toThrow(/no script at|\.mjs or \.js module/)
    await expect(loadExecScript(script('export const x = 1'))).rejects.toThrow(
      /no default export function/,
    )
    const fn = await loadExecScript(
      script('export default async ({ name }) => name'),
    )
    expect(typeof fn).toBe('function')
  })
})

describe('vos session exec', () => {
  it('refuses a session that does not exist, before any browser', async () => {
    const err: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => {
      err.push(String(c))
      return true
    })
    const code = await run([
      'session',
      'exec',
      'no-such-session-for-a-test',
      script('export default async () => 1'),
    ])
    expect(code).toBe(2)
    expect(err.join('')).toContain('no session "no-such-session-for-a-test"')
  })

  it('wants a session and a script', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await run(['session', 'exec', 'acme'])).toBe(2)
  })
})
