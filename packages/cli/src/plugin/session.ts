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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { BrowserContext } from 'playwright'
import {
  cookieWatch,
  enterPressed,
  helpersGone,
  readChromeTree,
  runSessionWindow,
} from './sessionWindow'
import type { SessionFinish } from './sessionWindow'
import { WALL_PROBE, isIdpHost, isSignInPath, wallVerdict } from './wall'
import type { WallVerdict } from './wall'

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
 * Open a plain Chrome window on the session's profile and wait for the
 * person to FINISH, however they finish (sessionWindow.ts): the last window
 * closed, Chrome quit, or Enter in the terminal. A child process with no
 * debugging endpoint and no automation switch, so a sign-in that refuses
 * automated browsers goes through, and the person signs in however the app
 * demands. The cookie store is written when Chrome quits, so a finish that
 * leaves Chrome running (a closed window on a Mac, Enter) quits THIS
 * Chrome, by its PID, and only then is the session read.
 */
export async function openSession(
  name: string,
  url: string,
  opts: { log: (line: string) => void } = { log: () => {} },
): Promise<SessionOpened> {
  const dir = sessionDir(name)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return openSessionWindow({
    dir,
    url,
    label: `session "${name}"`,
    log: opts.log,
  })
}

export interface SessionOpened {
  finish: SessionFinish
  /** Chrome had to be stopped after the grace: the last cookies may be missing */
  forced: boolean
  /** Chrome's exit code; 0 on a clean quit */
  code: number | null
}

/**
 * The window itself, on any profile directory. `extraArgs` exists for the
 * test of this, which closes the page through a debugging endpoint the
 * person's window never has.
 */
export async function openSessionWindow(opts: {
  dir: string
  url: string
  label: string
  log: (line: string) => void
  extraArgs?: string[]
  pollMs?: number
  /** listen for Enter (default: when stdin is a terminal) */
  stdin?: boolean
}): Promise<SessionOpened> {
  const exe = systemChromePath()
  const args = [
    `--user-data-dir=${opts.dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1100,800',
    ...(opts.extraArgs ?? []),
    opts.url,
  ]
  const { host, hostname } = new URL(opts.url)
  const tty = opts.stdin !== false && process.stdin.isTTY === true
  const enter = tty
    ? enterPressed()
    : { pressed: new Promise<void>(() => {}), close: () => {} }
  opts.log(
    `a Chrome window opened on ${opts.label}: sign in to ${host}, and set the account up the way the takes should find it (a workspace, demo data). When you are done, close the window${tty ? ' or press Enter here' : ''}; the session saves either way`,
  )
  const child = spawn(exe, args, { stdio: 'ignore' })
  let failed: Error | null = null
  let code: number | null = null
  const exited = new Promise<void>((resolve) => {
    child.once('exit', (c) => {
      code = c
      resolve()
    })
    child.once('error', (e) => {
      failed = e
      resolve()
    })
  })
  try {
    const pid = child.pid
    if (pid === undefined) {
      await exited
      throw failed ?? new Error(`could not start ${exe}`)
    }
    // The last helper PIDs seen: the cookie store is written by one of them.
    let helpers: number[] = []
    const { finish, forced } = await runSessionWindow({
      pid,
      watch: {
        pages: async () => {
          const tree = await readChromeTree(pid)
          if (tree) helpers = tree.pids
          return tree ? tree.pages : null
        },
        exited,
        enter: enter.pressed,
        onTick: cookieWatch(opts.dir, hostname, opts.log),
        ...(opts.pollMs !== undefined ? { pollMs: opts.pollMs } : {}),
      },
      kill: (p, signal) => process.kill(p, signal),
      afterExit: () => helpersGone(helpers),
      save: async () => undefined,
      log: opts.log,
    })
    if (failed) throw failed
    return { finish, forced, code }
  } finally {
    enter.close()
  }
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
  return withProfile(dir, fn, opts)
}

/** `withSession` on any profile directory (the test of the wall check makes its own). */
export async function withProfile<T>(
  dir: string,
  fn: (ctx: BrowserContext) => Promise<T>,
  opts: {
    headless?: boolean
    viewport?: { width: number; height: number }
  } = {},
): Promise<T> {
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

/**
 * Does this profile open `url` as the person who signed in? The wall
 * check's own verdict, headless, on the saved profile: null when the page
 * opens where it was asked, else where a stranger is sent and why. Cookies
 * prove nothing on their own (a site sets analytics cookies on every
 * visit), so this is the one test of a sign-in that `open` and `check`
 * both say.
 */
export async function profileWall(
  dir: string,
  url: string,
): Promise<WallVerdict | null> {
  return withProfile(dir, (ctx) => arrivalWall(ctx, url))
}

/** Open `url` in this context and give the wall check's verdict on where it landed. */
async function arrivalWall(
  ctx: BrowserContext,
  url: string,
): Promise<WallVerdict | null> {
  const page = await ctx.newPage()
  const response = await page
    .goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    .catch(() => null)
  const seen = (await page.evaluate(WALL_PROBE).catch(() => null)) as {
    passwordFields: number
    newPasswordField: boolean
    oneTimeCodeField: boolean
  } | null
  return wallVerdict({
    askedUrl: url,
    landedUrl: page.url(),
    ...(response ? { status: response.status() } : {}),
    passwordFields: seen?.passwordFields ?? 0,
    newPasswordField: seen?.newPasswordField ?? false,
    oneTimeCodeField: seen?.oneTimeCodeField ?? false,
  })
}

/**
 * What a session's check found, against a STRANGER: a page that opens the
 * same for someone with no session cannot tell a sign-in from none, and a
 * sign-in page opens for everyone.
 */
export type SessionVerdict =
  | { state: 'signed-in'; stranger: WallVerdict }
  | { state: 'not-signed-in'; wall: WallVerdict }
  | { state: 'cant-tell'; reason: 'sign-in-page' | 'same-for-stranger' }

/** Is this URL a sign-in page by the wall's own rules (a sign-in path, an identity provider)? */
export function isSignInUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return isSignInPath(u.pathname) || isIdpHost(u.hostname)
  } catch {
    return false
  }
}

/**
 * The verdict from the two arrivals: the saved profile's and a stranger's
 * (a fresh, empty context). Pure. Walled with the profile is not signed
 * in; open with the profile and walled for the stranger is signed in;
 * open for both is a URL that cannot tell.
 */
export function sessionVerdictOf(
  profile: WallVerdict | null,
  stranger: WallVerdict | null,
): SessionVerdict {
  if (profile) return { state: 'not-signed-in', wall: profile }
  if (stranger) return { state: 'signed-in', stranger }
  return { state: 'cant-tell', reason: 'same-for-stranger' }
}

/**
 * Check a saved profile against a stranger on `url`. A sign-in URL is not
 * opened at all: a stranger reaches it too, so it proves nothing.
 */
export async function profileVerdict(
  dir: string,
  url: string,
): Promise<SessionVerdict> {
  if (isSignInUrl(url)) return { state: 'cant-tell', reason: 'sign-in-page' }
  const profile = await profileWall(dir, url)
  if (profile) return sessionVerdictOf(profile, null)
  const stranger = await strangerWall(url)
  return sessionVerdictOf(null, stranger)
}

/** The wall check for someone with no session: a fresh, empty context on the same Chrome. */
async function strangerWall(url: string): Promise<WallVerdict | null> {
  const dir = mkdtempSync(join(tmpdir(), 'vos-stranger-'))
  try {
    return await withProfile(dir, (ctx) => arrivalWall(ctx, url))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The check on a named session. */
export function sessionVerdict(
  name: string,
  url: string,
): Promise<SessionVerdict> {
  return profileVerdict(sessionDir(name), url)
}

/** The sentence for a verdict, said the same way by `open` and `check`. */
export function verdictLine(
  v: SessionVerdict,
  url: string,
  name: string,
): string {
  switch (v.state) {
    case 'signed-in':
      return `signed in: ${url} opens as you (a stranger is sent to ${landedWords(v.stranger)})`
    case 'not-signed-in':
      return `NOT signed in: ${url} sends a stranger to ${landedWords(v.wall)}, and this session along with them; nothing a take needs was saved`
    case 'cant-tell':
      return v.reason === 'sign-in-page'
        ? `can't tell: ${url} is a sign-in page, which a stranger opens too; check with the app's own page: vos session check ${name} --url <a page only a signed-in person sees, such as its dashboard>`
        : `can't tell: ${url} opens the same for a stranger; check with --url <a page only a signed-in person sees>: vos session check ${name} --url <that page>`
  }
}

/** Where a verdict says a stranger lands, as the person reads it: the path on the same host, else the URL. */
export function landedWords(v: WallVerdict): string {
  try {
    const asked = new URL(v.asked)
    const landed = new URL(v.landed)
    return landed.host === asked.host ? landed.pathname : v.landed
  } catch {
    return v.landed
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
