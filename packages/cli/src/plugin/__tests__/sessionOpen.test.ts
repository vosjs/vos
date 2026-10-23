/**
 * `vos session open` on the real system Chrome: a local page sets a cookie
 * that lasts, the test closes the window's only page (through a debugging
 * endpoint added for the TEST alone: the person's window never has one),
 * and the session must be saved by the CLI quitting its own Chrome, with
 * the cookie on disk and the process gone. The cookie is set seconds before
 * the close, inside Chrome's own half-minute commit, so only a clean
 * shutdown writes it. A real window opens for a few seconds; skipped, and
 * said, where there is no Chrome or no screen to open it on.
 */
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openSessionWindow, systemChromePath } from '../session'
import { readCookieRows } from '../sessionWindow'
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
  if (!skip && process.platform === 'linux' && !process.env.DISPLAY)
    skip = 'no display to open a window on'
  if (!skip && process.platform === 'win32')
    skip = 'the window is watched through ps, which Windows has not'
  server = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html',
      'set-cookie': 'signedin=yes; Max-Age=86400; Path=/; HttpOnly',
    })
    res.end('<!doctype html><title>signed in</title><p>signed in</p>')
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(() => {
  server?.close()
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Close the browser's only page, the way a person closes the window. */
async function closeOnlyPage(dir: string): Promise<void> {
  const portFile = join(dir, 'DevToolsActivePort')
  // A loaded machine can take a while to start Chrome: a minute at most.
  for (const until = Date.now() + 60_000; Date.now() < until; ) {
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, 'utf8').split('\n')[0]
      const list = (await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((r) => r.json())
        .catch(() => [])) as { id: string; type: string; title: string }[]
      const page = list.find(
        (t) => t.type === 'page' && t.title === 'signed in',
      )
      if (page) {
        await sleep(1500)
        await fetch(`http://127.0.0.1:${port}/json/close/${page.id}`)
        return
      }
    }
    await sleep(100)
  }
  throw new Error('the session window never showed its page')
}

describe('vos session open saves when the window closes', () => {
  it('quits its own Chrome on the last page closed, and the cookie is on disk', async () => {
    if (skip) {
      console.warn(`skipped: ${skip}`)
      return
    }
    const dir = mkdtempSync(join(tmpdir(), 'vos-session-'))
    const log: string[] = []
    const closing = closeOnlyPage(dir)
    const result = await openSessionWindow({
      dir,
      url: `${base}/`,
      label: 'session "test"',
      log: (l) => log.push(l),
      extraArgs: ['--remote-debugging-port=0', '--window-size=480,360'],
      pollMs: 250,
      stdin: false,
    })
    await closing
    expect(result.finish).toBe('window-closed')
    expect(result.forced).toBe(false)
    // the process is gone, and went cleanly
    expect(result.code).toBe(0)
    expect(log.join('\n')).toContain('the window closed')
    // The cookie store is read with node:sqlite (Node 22.5 and up).
    const rows = await readCookieRows(dir)
    // Quiet only where this Node has no node:sqlite at all; a store that
    // could not be READ is a failure, never a skip.
    const hasSqlite = Boolean(
      (
        process as { getBuiltinModule?: (id: string) => unknown }
      ).getBuiltinModule?.('node:sqlite'),
    )
    if (!hasSqlite) console.warn('cookie store not read: no node:sqlite')
    else
      expect(rows?.map((r) => [r.host, r.name])).toContainEqual([
        '127.0.0.1',
        'signedin',
      ])
    const prefs = JSON.parse(
      readFileSync(join(dir, 'Default', 'Preferences'), 'utf8'),
    ) as { profile?: { exit_type?: string } }
    expect(prefs.profile?.exit_type).not.toBe('Crashed')
  }, 150_000)
})
