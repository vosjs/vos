/**
 * How `vos session open` knows the person is done with the window, without
 * making the window look automated.
 *
 * A debugging endpoint is out: with `--remote-debugging-port` or
 * `--remote-debugging-pipe` on, Chrome reports `navigator.webdriver ===
 * true` to every page (measured, Chrome 155), which is exactly what a
 * sign-in that refuses automated browsers reads. So the window is watched
 * from OUTSIDE the browser, through what any process can see:
 *
 * - the process table: a Chrome window that draws a page has a renderer
 *   for it, and when the last window closes every renderer that is not an
 *   extension's exits while the browser process stays up (a Mac keeps
 *   Chrome running with no window; measured). A minimized window, or one on
 *   another desktop, keeps its renderer, so neither reads as closed;
 * - the profile's cookie store, a SQLite file Chrome commits about every
 *   thirty seconds: hosts, names and expiry dates are plain columns, the
 *   values are encrypted and never read here.
 *
 * The CLI never quits on a sign-in it detects. The person often is not
 * done: a second factor or a single sign-on hop finishes later, and they
 * pick a workspace and stage the account in that window, which every take
 * on the session inherits. Only the person's own act finishes it: the last
 * window closed, Chrome quit, or Enter in the terminal.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

/** How the person finished: closed the last window, quit Chrome, or pressed Enter. */
export type SessionFinish = 'window-closed' | 'quit' | 'enter'

export interface ProcessRow {
  pid: number
  ppid: number
  command: string
}

/** `ps -A -o pid= -o ppid= -o command=`, read into rows. */
export function parseProcessTable(out: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] })
  }
  return rows
}

/** A renderer that draws a page (a tab, a popup, a sign-in window), not an extension's. */
export function isPageRenderer(command: string): boolean {
  return (
    /\s--type=renderer(\s|$)/.test(command) &&
    !/\s--extension-process(\s|$)/.test(command)
  )
}

/** What one Chrome's process tree holds: its page renderers, and every helper's PID. */
export interface ChromeTree {
  pages: number
  pids: number[]
}

/**
 * The tree of the Chrome at `pid`, over every descendant: on Linux
 * renderers hang off a zygote, not the browser.
 */
export function chromeTree(rows: ProcessRow[], pid: number): ChromeTree {
  const kids = new Map<number, ProcessRow[]>()
  for (const r of rows) {
    const list = kids.get(r.ppid)
    if (list) list.push(r)
    else kids.set(r.ppid, [r])
  }
  let pages = 0
  const pids: number[] = []
  const stack = [...(kids.get(pid) ?? [])]
  const seen = new Set<number>()
  while (stack.length) {
    const r = stack.pop()!
    if (seen.has(r.pid)) continue
    seen.add(r.pid)
    pids.push(r.pid)
    if (isPageRenderer(r.command)) pages++
    stack.push(...(kids.get(r.pid) ?? []))
  }
  return { pages, pids }
}

/** The live tree off this machine's process table; null where there is no `ps`. */
export function readChromeTree(pid: number): Promise<ChromeTree | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'command='],
      { maxBuffer: 16 * 1024 * 1024, timeout: 5000 },
      (err, stdout) => {
        if (err) resolve(null)
        else resolve(chromeTree(parseProcessTable(stdout), pid))
      },
    )
  })
}

/**
 * Wait until every one of these processes is gone. The browser process
 * exits before its helpers do, and the network service, which owns the
 * cookie store, is still writing it for a moment after (measured: a read
 * straight after the exit found no store, under load). Bounded: a helper
 * that lingers past `ms` is not waited for.
 */
export async function helpersGone(
  pids: number[],
  ms = 10000,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<void> {
  const alive = (p: number) => {
    try {
      process.kill(p, 0)
      return true
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
  }
  const until = Date.now() + ms
  while (pids.some(alive) && Date.now() < until) await sleep(100)
}

/** What the watch needs, every part injectable so the logic is tested without a browser. */
export interface SessionWatch {
  /** page renderers now; null when this platform cannot tell (then only quit and Enter finish) */
  pages: () => Promise<number | null>
  /** settles when the browser process exits */
  exited: Promise<unknown>
  /** settles when the person presses Enter; never, without a terminal */
  enter: Promise<unknown>
  /** once per poll: the cookie report */
  onTick?: () => Promise<void>
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  /**
   * Polls in a row with no page before the window counts as closed. One is
   * a navigation swapping its renderer; two is a window that is gone.
   */
  emptyPolls?: number
  /**
   * How long the browser must stay up once its pages are gone before the
   * window counts as closed. Chrome that is EXITING (quit, or gone on its
   * own) drops its renderers first and its own process a moment later;
   * that is a quit, never a window the person closed.
   */
  confirmMs?: number
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Wait until the person finishes. A window counts as closed only after a
 * page was seen at least once (Chrome starts with none for a moment), and
 * only once it stays closed for `emptyPolls` polls.
 */
export async function waitForFinish(w: SessionWatch): Promise<SessionFinish> {
  const sleep = w.sleep ?? realSleep
  const pollMs = w.pollMs ?? 1000
  const needEmpty = w.emptyPolls ?? 2
  let done: SessionFinish | null = null
  void w.exited.then(() => {
    done ??= 'quit'
  })
  void w.enter.then(() => {
    done ??= 'enter'
  })
  let seen = false
  let empty = 0
  while (done === null) {
    await Promise.race([sleep(pollMs), w.exited, w.enter])
    if (done !== null) break
    const n = await w.pages().catch(() => null)
    if (done !== null) break
    if (n !== null) {
      if (n > 0) {
        seen = true
        empty = 0
      } else if (seen && ++empty >= needEmpty) {
        const exiting = await Promise.race([
          w.exited.then(() => true),
          sleep(w.confirmMs ?? 1500).then(() => false),
        ])
        if (exiting) break
        done = 'window-closed'
        break
      }
    }
    await w.onTick?.().catch(() => {})
  }
  // Set by the exit's own callback, which runs before this one resumes.
  return done ?? 'quit'
}

/**
 * Quit the session's own Chrome, by its PID. SIGTERM is a clean shutdown to
 * Chromium on Mac and Linux (it writes the cookie store and marks the
 * profile's exit normal), and a PID names this Chrome and no other: the
 * person's everyday Chrome is the same app, so never by name and never
 * through AppleScript. A Chrome that does not go in `graceMs` is killed,
 * and the caller says the last cookies may be missing.
 */
export async function quitOwnChrome(d: {
  pid: number
  exited: Promise<unknown>
  kill: (pid: number, signal: NodeJS.Signals) => void
  graceMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<{ forced: boolean }> {
  const sleep = d.sleep ?? realSleep
  try {
    d.kill(d.pid, 'SIGTERM')
  } catch {
    // already gone
  }
  const quit = await Promise.race([
    d.exited.then(() => true),
    sleep(d.graceMs ?? 20000).then(() => false),
  ])
  if (quit) return { forced: false }
  try {
    d.kill(d.pid, 'SIGKILL')
  } catch {
    // gone in between
  }
  await d.exited
  return { forced: true }
}

/**
 * The whole finish: wait for the person, quit this Chrome when the person
 * left it running (a closed window, Enter), then save, which is reading the
 * profile Chrome wrote on the way out. Every finish saves.
 */
export async function runSessionWindow<T>(d: {
  pid: number
  watch: SessionWatch
  kill: (pid: number, signal: NodeJS.Signals) => void
  save: () => Promise<T>
  /** after Chrome exits, before the save: wait for its helpers (helpersGone) */
  afterExit?: () => Promise<void>
  log: (line: string) => void
  graceMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<{ finish: SessionFinish; forced: boolean; saved: T }> {
  const finish = await waitForFinish(d.watch)
  let forced = false
  if (finish !== 'quit') {
    d.log(
      finish === 'enter'
        ? 'Enter: saving the session and quitting its Chrome'
        : 'the window closed: saving the session and quitting its Chrome',
    )
    ;({ forced } = await quitOwnChrome({
      pid: d.pid,
      exited: d.watch.exited,
      kill: d.kill,
      ...(d.graceMs !== undefined ? { graceMs: d.graceMs } : {}),
      ...(d.sleep ? { sleep: d.sleep } : {}),
    }))
    if (forced)
      d.log(
        'Chrome did not quit in time and was stopped: cookies set in the last half minute may not be saved',
      )
  }
  // The browser is gone; its helpers finish writing the profile.
  await d.afterExit?.()
  return { finish, forced, saved: await d.save() }
}

/** Enter in the terminal, when there is one. `close` lets go of stdin. */
export function enterPressed(): { pressed: Promise<void>; close: () => void } {
  if (!process.stdin.isTTY)
    return { pressed: new Promise<void>(() => {}), close: () => {} }
  const rl = createInterface({ input: process.stdin })
  const pressed = new Promise<void>((resolve) =>
    rl.once('line', () => resolve()),
  )
  return { pressed, close: () => rl.close() }
}

/**
 * Cookie names that are measurement, never a sign-in: a site sets them on
 * a stranger's first visit, so counting them reads as progress that is
 * not there. Matched by the whole name, or by prefix where a vendor
 * numbers or suffixes its cookies: Google Analytics and Ads (`_ga`,
 * `_ga_*`, `_gid`, `_gat*`, `_gcl_*`), Google sign-in's one-tap state
 * (`g_state`, which holds no session), PostHog (`ph_*`, `*_posthog`),
 * Segment (`ajs_*`), Meta (`_fbp`, `_fbc`), Hotjar (`_hj*`), Stripe's
 * fraud signals (`__stripe_*`), Microsoft Clarity and Ads (`_clck`,
 * `_clsk`, `_uet*`), Mixpanel (`mp_*`), Amplitude (`amp_*`), HubSpot
 * (`__hs*`, `hubspotutk`) and Cloudflare's bot checks (`__cf_bm`,
 * `cf_clearance`, `_cfuvid`).
 */
const ANALYTICS_COOKIE =
  /^(?:_ga|_ga_.*|_gid|_gat.*|_gcl_.*|g_state|ph_.*|.*_posthog|ajs_.*|_fbp|_fbc|_hj.*|__stripe_.*|_clck|_clsk|_uet.*|mp_.*|amp_.*|__hs.*|hubspotutk|__cf_bm|cf_clearance|_cfuvid)$/

/** Is this cookie measurement rather than anything a sign-in could have set? */
export function isAnalyticsCookie(name: string): boolean {
  return ANALYTICS_COOKIE.test(name)
}

/** One cookie row as the store keeps it, minus the value, which is never read. */
export interface CookieRow {
  host: string
  name: string
  /**
   * Chrome's own expiry, as text: microseconds since 1601, which for any
   * cookie that lasts is past the largest integer a JavaScript number holds
   * exactly, and some Nodes' SQLite refuses to hand it back as one.
   */
  expires: string
}

/** Does a cookie stored for `cookieHost` go with requests to `host`? */
export function cookieAppliesTo(cookieHost: string, host: string): boolean {
  const d = cookieHost.replace(/^\./, '').toLowerCase()
  // A cookie belongs to a host NAME, never a port: localhost:5301's cookies
  // are stored for localhost.
  const h = host.toLowerCase().replace(/:\d+$/, '')
  return h === d || h.endsWith(`.${d}`)
}

/**
 * What to say about the target host's cookies this poll: a line when they
 * changed since the last line, null otherwise. The first read is the
 * baseline (the page's own first-visit cookies), so the first line is the
 * first CHANGE. Counts only.
 */
export function cookieReport(
  state: { last: string | null; said: boolean },
  rows: CookieRow[],
  host: string,
): string | null {
  const mine = rows.filter(
    (r) => cookieAppliesTo(r.host, host) && !isAnalyticsCookie(r.name),
  )
  const sig = mine
    .map((r) => `${r.host}\t${r.name}\t${r.expires}`)
    .sort()
    .join('\n')
  if (state.last === null) {
    state.last = sig
    return null
  }
  if (sig === state.last) return null
  state.last = sig
  if (!mine.length) return `${host} holds none now (analytics not counted)`
  const n = `${mine.length} cookie${mine.length === 1 ? '' : 's'}`
  if (state.said) return `${host}: ${n} now`
  state.said = true
  return `${host} set ${n} (analytics not counted). When you are done in the window, close it: the session is then checked by opening ${host} again`
}

/** The profile's cookie store: `Default/Network/Cookies` on newer builds, `Default/Cookies` before. */
export function cookieStore(profileDir: string): string | null {
  for (const p of [
    join(profileDir, 'Default', 'Network', 'Cookies'),
    join(profileDir, 'Default', 'Cookies'),
  ])
    if (existsSync(p)) return p
  return null
}

type Sqlite = {
  DatabaseSync: new (
    path: string,
    opts?: { readOnly?: boolean },
  ) => {
    prepare(sql: string): { all(): unknown[] }
    close(): void
  }
}
let sqlite: Promise<Sqlite | null> | null = null

/** `node:sqlite`, where this Node has it (22.5 and up); null otherwise, and the report stays quiet. */
function loadSqlite(): Promise<Sqlite | null> {
  sqlite ??= (async () => {
    // Older Nodes print an experimental-feature warning on import: this is
    // a read of a local file, and the warning would only confuse the person.
    const emit = process.emitWarning
    process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
      if (String(w).includes('SQLite')) return
      ;(emit as (...a: unknown[]) => void).call(process, w, ...rest)
    }) as typeof process.emitWarning
    try {
      // Asked of Node itself, never a bundler or a test runner's resolver,
      // neither of which knows this module on every version.
      const builtin = (
        process as { getBuiltinModule?: (id: string) => unknown }
      ).getBuiltinModule
      return (builtin?.('node:sqlite') as Sqlite | undefined) ?? null
    } catch {
      return null
    } finally {
      process.emitWarning = emit
    }
  })()
  return sqlite
}

/** Hosts, names and expiry of every saved cookie; null when the store cannot be read this moment. */
export async function readCookieRows(
  profileDir: string,
): Promise<CookieRow[] | null> {
  const file = cookieStore(profileDir)
  if (!file) return []
  const mod = await loadSqlite()
  if (!mod) return null
  try {
    const db = new mod.DatabaseSync(file, { readOnly: true })
    try {
      return (
        db
          .prepare(
            'SELECT host_key, name, CAST(expires_utc AS TEXT) AS expires FROM cookies',
          )
          .all() as { host_key: string; name: string; expires: string | null }[]
      ).map((r) => ({
        host: r.host_key,
        name: r.name,
        expires: r.expires ?? '0',
      }))
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}

/** The per-poll cookie report for `host`, said through `log`. */
export function cookieWatch(
  profileDir: string,
  host: string,
  log: (line: string) => void,
): () => Promise<void> {
  const state = { last: null as string | null, said: false }
  return async () => {
    const rows = await readCookieRows(profileDir)
    if (!rows) return
    const line = cookieReport(state, rows, host)
    if (line) log(line)
  }
}
