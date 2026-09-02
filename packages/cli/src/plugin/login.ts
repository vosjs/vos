/**
 * `vos login` browser flow — the RFC-8628-shaped device flow behind
 * the AgentDoor promise ("run `vos login` and let me finish the browser
 * sign-in"). The CLI asks the platform for a short user code + a vos_dc_
 * poll secret, shows the approval URL (the printed URL is the contract;
 * the browser launch is best-effort), and polls until a signed-in human
 * approves at /cli/auth. The key arrives exactly once and goes STRAIGHT to
 * ~/.config/vos/credentials — never into stdout, NDJSON, or logs (the
 * attribution doctrine: never print a credential).
 */
import { hostname } from 'node:os'
import { apiError, apiJson, writeCredential } from './platform'
import type { Reporter } from './output'

/** The origin has no device-flow endpoints (older server) — caller falls
    back to the paste-a-key ladder. */
export class LoginUnsupportedError extends Error {
  constructor() {
    super('this origin does not support browser login')
  }
}

/** Consecutive network failures tolerated before the loop gives up. */
const MAX_TRANSIENT_FAILURES = 5
/** Backoff ceiling when the server answers 429. */
const MAX_INTERVAL_MS = 30_000

export interface BrowserLoginOptions {
  /** Optional requester label shown on the approval page (--label). */
  label?: string
  /** Attempt the OS browser launch (TTY, local, not --json/--no-browser). */
  openBrowser: boolean
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Injected for tests — defaults to the real credentials file. */
  store?: (key: string) => string
}

/** Best-effort OS launch — the printed URL stays the contract (vos open). */
async function launchDefaultBrowser(url: string): Promise<void> {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open'
  const { exec } = await import('node:child_process')
  exec(`${opener} ${JSON.stringify(url)}`, () => {})
}

/**
 * Run the device flow to completion. Returns the credential path and the
 * signed-in display name; throws on deny/expiry/timeout with the next step
 * in words.
 */
export async function browserLogin(
  origin: string,
  r: Reporter,
  opts: BrowserLoginOptions,
): Promise<{ path: string; user: string }> {
  const create = await apiJson(origin, '/api/cli/login', {
    method: 'POST',
    body: {
      hostname: hostname().slice(0, 64),
      ...(opts.label ? { label: opts.label.slice(0, 64) } : {}),
    },
  })
  if (create.status === 404) throw new LoginUnsupportedError()
  if (create.status !== 201) throw new Error(apiError('start login', create))
  const code = create.body.code as string
  const secret = create.body.secret as string
  const verifyUrl = create.body.verifyUrl as string
  const expiresAt = Date.parse(String(create.body.expiresAt ?? ''))
  const baseIntervalMs =
    (typeof create.body.interval === 'number' ? create.body.interval : 3) * 1000
  if (!code || !secret || !verifyUrl || Number.isNaN(expiresAt)) {
    throw new Error('start login → malformed response from the platform')
  }

  // The agent relay: everything the human needs, nothing secret.
  r.event({ event: 'login_await', url: verifyUrl, code, expiresAt })
  r.log(`Confirm this code in the browser: ${code}`)
  r.log(`Sign in at ${verifyUrl}`)
  if (opts.openBrowser) void launchDefaultBrowser(verifyUrl)
  r.log('Waiting for approval… (Ctrl-C to cancel)')

  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((res) => setTimeout(res, ms)))
  let intervalMs = baseIntervalMs
  let failures = 0
  let capNoted = false
  while (Date.now() < expiresAt) {
    await sleep(intervalMs)
    let res
    try {
      res = await apiJson(origin, '/api/cli/login/poll', {
        method: 'POST',
        body: { secret },
      })
      failures = 0
    } catch (e) {
      if (++failures >= MAX_TRANSIENT_FAILURES) {
        throw new Error(
          `lost the connection while waiting (${e instanceof Error ? e.message : String(e)}) — run \`vos login\` again`,
        )
      }
      continue
    }
    const status = res.body.status as string | undefined
    if (res.status === 200 && status === 'pending') {
      intervalMs = baseIntervalMs
      continue
    }
    if (res.status === 200 && status === 'ok') {
      // The one delivery — straight to disk, never through any output path.
      const path = (opts.store ?? writeCredential)(res.body.key as string)
      const user =
        typeof res.body.user === 'object' && res.body.user !== null
          ? ((res.body.user as { name?: string }).name ?? '')
          : ''
      return { path, user }
    }
    if (res.status === 429) {
      // key_limit carries the fix in words and keeps the approval alive —
      // say it once, keep polling so a revoke over on /app/api resumes us.
      if (status === 'key_limit' && !capNoted) {
        capNoted = true
        r.log(`${res.body.error as string} — ${res.body.hint as string}`)
      }
      intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL_MS)
      continue
    }
    if (res.status === 403 && status === 'denied') {
      throw new Error('the sign-in was denied in the browser')
    }
    throw new Error(
      typeof res.body.error === 'string'
        ? res.body.error
        : apiError('poll login', res),
    )
  }
  throw new Error(
    'no approval within 15 minutes — run `vos login` again, or mint a key at https://vos.so/app/api and pass --key',
  )
}
