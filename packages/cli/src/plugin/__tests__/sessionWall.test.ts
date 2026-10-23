/**
 * The test of a session is whether the page opens as the person, never how
 * many cookies it holds: a site sets analytics cookies on a stranger's
 * first visit. Two profiles saved by the system Chrome, one with only
 * analytics cookies and one with a session cookie, opened on a local app
 * that sends a stranger to its sign-in page: the wall check `vos session
 * open` and `vos session check --url` both run must call the first NOT
 * signed in and pass the second. Skipped, and said, where there is no
 * system Chrome.
 */
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  landedWords,
  profileWall,
  systemChromePath,
  withProfile,
} from '../session'
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
    const signedIn = /(?:^|;\s*)session=ok(?:;|$)/.test(
      req.headers.cookie ?? '',
    )
    if (req.url === '/app' && !signedIn) {
      res.writeHead(302, { location: '/signin' })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(
      req.url === '/signin'
        ? '<!doctype html><title>Sign in</title><form><input type="email"><input type="password"></form>'
        : '<!doctype html><title>App</title><p>your projects</p>',
    )
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})

afterAll(() => {
  server?.close()
})

/** A profile the system Chrome saved, holding exactly these cookies. */
async function profileWith(names: [string, string][]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'vos-wall-'))
  await withProfile(dir, async (ctx) => {
    await ctx.addCookies(
      names.map(([name, value]) => ({
        name,
        value,
        domain: '127.0.0.1',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 86400,
      })),
    )
  })
  return dir
}

describe('the wall check on a saved session', () => {
  it('calls a profile with only analytics cookies NOT signed in, and says where a stranger lands', async () => {
    if (skip) {
      console.warn(`skipped: ${skip}`)
      return
    }
    const dir = await profileWith([
      ['_ga', 'GA1.1.1'],
      ['_ga_ABC', 'GS1.1'],
      ['g_state', '{"i_l":0}'],
    ])
    const wall = await profileWall(dir, `${base}/app`)
    expect(wall).not.toBeNull()
    expect(landedWords(wall!)).toBe('/signin')
  }, 120_000)

  it('passes a profile holding the session cookie', async () => {
    if (skip) return
    const dir = await profileWith([
      ['_ga', 'GA1.1.1'],
      ['session', 'ok'],
    ])
    await expect(profileWall(dir, `${base}/app`)).resolves.toBeNull()
  }, 120_000)
})
