/**
 * `vos session`: takeover mode, local. A SESSION is a browser profile the
 * person signed in to once, in a plain Chrome window that no automation
 * touched, and the recorder reuses afterwards. Not `auth` and not `login`:
 * `login` is the vos.so account, and an agent that confuses the two pastes
 * the wrong credential into the wrong place.
 *
 * What was measured before this was written (SI0 b): a profile written by
 * plain Chrome reopens signed in under Playwright ONLY as the SYSTEM Chrome
 * with the real keychain. Playwright's bundled Chromium keeps its own
 * keychain entry and can never decrypt Chrome's cookies, and Playwright
 * adds `--use-mock-keychain` by default. So every reader of a session here
 * launches `channel: 'chrome'` with that switch removed, and nothing else.
 *
 * Rules that bind (the SI doc's §7): a session lives under
 * ~/.config/vos/sessions/<name>, beside the credentials file, never in a
 * take directory and never on vos.so; no verb prints a cookie value, and
 * --json does not either; expiry is said in words.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { BrowserContext } from 'playwright'

export const SESSIONS_DIR = join(homedir(), '.config', 'vos', 'sessions')

const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i

/** A session's name is a directory name: short, no separators, no dots to walk up. */
export function sessionNameVerdict(name: string | undefined): string | null {
  if (!name) return 'a session needs a name: --name <app>'
  if (!NAME.test(name) || name.includes('..'))
    return `"${name}" is not a session name: letters, digits, . _ - only, up to 64`
  return null
}

export function sessionDir(name: string): string {
  return join(SESSIONS_DIR, name)
}

/**
 * The system Chrome's executable, the one binary a session is ever opened
 * with. VOS_BROWSER_PATH first, then the install locations Playwright's
 * `channel: 'chrome'` itself resolves to, so `open` and the readers agree.
 */
export function systemChromePath(): string {
  const explicit = process.env.VOS_BROWSER_PATH
  if (explicit) return explicit
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : process.platform === 'win32'
        ? [
            join(
              process.env['PROGRAMFILES'] ?? 'C:\\Program Files',
              'Google',
              'Chrome',
              'Application',
              'chrome.exe',
            ),
            join(
              process.env['LOCALAPPDATA'] ?? '',
              'Google',
              'Chrome',
              'Application',
              'chrome.exe',
            ),
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/opt/google/chrome/chrome',
          ]
  const found = candidates.find((c) => existsSync(c))
  if (!found)
    throw new Error(
      'no Google Chrome found: a session needs the system Chrome (the bundled Chromium cannot read a profile Chrome wrote). Install Chrome, or set VOS_BROWSER_PATH',
    )
  return found
}

/**
 * Open a plain Chrome window on the session's profile and wait for it to
 * EXIT. A child process with no debugging pipe and no automation switch, so
 * a sign-in that refuses automated browsers (Google's) goes through, and
 * the person signs in however the app demands. The cookie store is flushed
 * when Chrome quits, not before: a killed Chrome writes nothing, which is
 * why this waits rather than polls.
 */
export async function openSession(
  name: string,
  url: string,
  opts: { log: (line: string) => void } = { log: () => {} },
): Promise<{ code: number | null }> {
  const dir = sessionDir(name)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const exe = systemChromePath()
  const args = [
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1100,800',
    url,
  ]
  opts.log(
    `a Chrome window opened on session "${name}": sign in to ${new URL(url).host}, then close the window`,
  )
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', (code) => resolve({ code }))
  })
}

/** What a session holds, said in counts and dates. Never a value. */
export interface SessionSummary {
  name: string
  origins: { host: string; cookies: number }[]
  /** the newest expiry among persistent cookies, ISO; null when every cookie dies with the window */
  newestExpires: string | null
  /** cookies with no expiry: they die when the window closes, so they cannot be reused */
  sessionOnly: number
  ageDays: number
}

/**
 * Read a session's cookies THROUGH the browser that can decrypt them
 * (headless system Chrome, real keychain) and summarize. The values pass
 * through memory here and nowhere else.
 */
export async function withSession<T>(
  name: string,
  fn: (ctx: BrowserContext) => Promise<T>,
  opts: {
    headless?: boolean
    viewport?: { width: number; height: number }
  } = {},
): Promise<T> {
  const dir = sessionDir(name)
  if (!existsSync(dir))
    throw new Error(`no session "${name}" (vos session list)`)
  const explicit = process.env.VOS_BROWSER_PATH
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: opts.headless ?? true,
    ...(explicit ? { executablePath: explicit } : { channel: 'chrome' }),
    // The real keychain: the whole reason a profile Chrome wrote can be read.
    ignoreDefaultArgs: ['--use-mock-keychain'],
    ...(opts.viewport ? { viewport: opts.viewport, deviceScaleFactor: 1 } : {}),
  })
  try {
    return await fn(ctx)
  } finally {
    await ctx.close().catch(() => {})
  }
}

export async function summarizeSession(name: string): Promise<SessionSummary> {
  const dir = sessionDir(name)
  const created = statSync(dir).birthtimeMs || statSync(dir).mtimeMs
  return withSession(name, async (ctx) => {
    const cookies = await ctx.cookies()
    const byHost = new Map<string, number>()
    let newest = 0
    let sessionOnly = 0
    for (const c of cookies) {
      const host = c.domain.replace(/^\./, '')
      byHost.set(host, (byHost.get(host) ?? 0) + 1)
      if (c.expires && c.expires > 0) newest = Math.max(newest, c.expires)
      else sessionOnly++
    }
    return {
      name,
      origins: [...byHost.entries()]
        .map(([host, n]) => ({ host, cookies: n }))
        .sort((a, b) => b.cookies - a.cookies),
      newestExpires: newest ? new Date(newest * 1000).toISOString() : null,
      sessionOnly,
      ageDays: Math.floor((Date.now() - created) / 86400000),
    }
  })
}

export function summaryLine(s: SessionSummary): string {
  if (!s.origins.length)
    return `session "${s.name}" holds no cookies: the window closed before a sign-in landed, or the sign-in never happened`
  const hosts = s.origins
    .slice(0, 4)
    .map((o) => `${o.host} (${o.cookies})`)
    .join(', ')
  const more = s.origins.length > 4 ? ` and ${s.origins.length - 4} more` : ''
  const exp = s.newestExpires
    ? `newest expires in ${Math.max(0, Math.round((new Date(s.newestExpires).getTime() - Date.now()) / 86400000))} days`
    : 'every cookie dies with the window (the app set no expiry), so this session cannot be reused'
  return `session "${s.name}" holds cookies for ${hosts}${more}; ${exp}`
}

export function listSessions(): { name: string; ageDays: number }[] {
  if (!existsSync(SESSIONS_DIR)) return []
  return readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && NAME.test(d.name))
    .map((d) => {
      const st = statSync(join(SESSIONS_DIR, d.name))
      return {
        name: d.name,
        ageDays: Math.floor(
          (Date.now() - (st.birthtimeMs || st.mtimeMs)) / 86400000,
        ),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function removeSession(name: string): boolean {
  const dir = sessionDir(name)
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}

/**
 * Is this JSON a Playwright storage state? The push guard's test: a take
 * directory holding one would upload live credentials with the take.
 */
export function looksLikeStorageState(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { cookies?: unknown; origins?: unknown }
  return Array.isArray(v.cookies) && Array.isArray(v.origins)
}
