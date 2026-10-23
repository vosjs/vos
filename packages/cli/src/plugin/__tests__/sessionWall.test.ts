/**
 * The test of a session is whether the page opens as the person, never how
 * many cookies it holds: a site sets analytics cookies on a stranger's
 * first visit, and a page a stranger opens too proves nothing either. So
 * the check compares the saved profile against a STRANGER (a fresh, empty
 * context) on a local app with a public home, a sign-in page, and an app
 * page that sends a stranger to sign in. Profiles saved by the system
 * Chrome, one with only analytics cookies and one with a session cookie.
 * Skipped, and said, where there is no system Chrome.
 */
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  isSignInUrl,
  landedWords,
  profileVerdict,
  sessionVerdictOf,
  systemChromePath,
  verdictLine,
  withProfile,
} from '../session'
import type { WallVerdict } from '../wall'
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

describe('a session checked against a stranger', () => {
  it('calls a profile with only analytics cookies NOT signed in on the app page, and says where a stranger lands', async () => {
    if (skip) {
      console.warn(`skipped: ${skip}`)
      return
    }
    const dir = await profileWith([
      ['_ga', 'GA1.1.1'],
      ['_ga_ABC', 'GS1.1'],
      ['g_state', '{"i_l":0}'],
    ])
    const v = await profileVerdict(dir, `${base}/app`)
    expect(v.state).toBe('not-signed-in')
    if (v.state === 'not-signed-in') expect(landedWords(v.wall)).toBe('/signin')
  }, 120_000)

  it('calls a profile holding the session cookie signed in on the app page, where a stranger is walled', async () => {
    if (skip) return
    const dir = await profileWith([
      ['_ga', 'GA1.1.1'],
      ['session', 'ok'],
    ])
    const v = await profileVerdict(dir, `${base}/app`)
    expect(v.state).toBe('signed-in')
    if (v.state === 'signed-in') expect(landedWords(v.stranger)).toBe('/signin')
  }, 120_000)

  it("can't tell on a public page, which opens the same for a stranger, even with the session cookie", async () => {
    if (skip) return
    const dir = await profileWith([['session', 'ok']])
    await expect(profileVerdict(dir, `${base}/`)).resolves.toEqual({
      state: 'cant-tell',
      reason: 'same-for-stranger',
    })
  }, 120_000)

  it("can't tell on the sign-in page itself, and does not open it", async () => {
    // A profile directory that does not exist: nothing is launched.
    const v = await profileVerdict('/nonexistent/profile', `${base}/signin`)
    expect(v).toEqual({ state: 'cant-tell', reason: 'sign-in-page' })
    expect(verdictLine(v, `${base}/signin`, 'app')).toContain(
      "is a sign-in page, which a stranger opens too; check with the app's own page",
    )
  })
})

describe('the verdict, said', () => {
  const wall = (landed: string): WallVerdict => ({
    kind: 'signin',
    level: 'hard',
    asked: 'https://app.example.com/home',
    landed,
    message: 'asked for /home, landed on /login: no session',
  })

  it('reads two arrivals the one way', () => {
    const w = wall('https://app.example.com/login')
    expect(sessionVerdictOf(w, null).state).toBe('not-signed-in')
    expect(sessionVerdictOf(w, w).state).toBe('not-signed-in')
    expect(sessionVerdictOf(null, w).state).toBe('signed-in')
    expect(sessionVerdictOf(null, null)).toEqual({
      state: 'cant-tell',
      reason: 'same-for-stranger',
    })
  })

  it('knows a sign-in URL by the wall rules', () => {
    expect(isSignInUrl('https://vos.so/signin')).toBe(true)
    expect(isSignInUrl('https://app.example.com/auth/login')).toBe(true)
    expect(isSignInUrl('https://accounts.google.com/')).toBe(true)
    expect(isSignInUrl('https://vos.so/app')).toBe(false)
    expect(isSignInUrl('https://vos.so/')).toBe(false)
  })

  it('never calls a page that cannot tell signed in', () => {
    const url = 'https://vos.so/'
    const line = verdictLine(
      { state: 'cant-tell', reason: 'same-for-stranger' },
      url,
      'vosso',
    )
    expect(line).toMatch(
      /^can't tell: https:\/\/vos\.so\/ opens the same for a stranger; check with --url/,
    )
    expect(line).not.toMatch(/signed in:/)
    expect(
      verdictLine(
        { state: 'signed-in', stranger: wall('https://app.example.com/login') },
        'https://app.example.com/home',
        'app',
      ),
    ).toBe(
      'signed in: https://app.example.com/home opens as you (a stranger is sent to /login)',
    )
  })
})
