/**
 * The credential STORE (MA1): several stored credentials, one active.
 *
 * `~/.config/vos/credentials` keeps its contract, the ACTIVE key on line 1
 * and `origin=` on line 2 (every contract tells an agent to read line 1,
 * and an older CLI reads nothing else); line 3, `account=<id> <kind>
 * <handle>`, names the account the key belongs to. Every other stored
 * credential is one file of the same shape under
 * `~/.config/vos/accounts/<host>/<account id>`, and `vos switch` copies
 * the chosen one over the active file. A key is bound to exactly one
 * account on the server, so switching is choosing a key, never changing
 * what a key may do.
 *
 * Nothing here prints a key; the words come from `accountLabel`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CREDENTIALS_PATH = join(homedir(), '.config', 'vos', 'credentials')
export const ACCOUNTS_DIR = join(homedir(), '.config', 'vos', 'accounts')
/** The origin a credential stored with none was minted for. */
export const DEFAULT_ORIGIN = 'https://vos.so'
/** The environment variable that picks a stored account by name (AWS_PROFILE's shape). */
export const ACCOUNT_ENV = 'VOS_ACCOUNT'

export interface StoredAccount {
  id: string
  kind: 'person' | 'org'
  /** The handle, when the account has one; what a person types to `vos switch`. */
  handle: string | null
}

export interface StoredCredential {
  key: string
  origin: string
  /** Null for a file written before the account line (an older `vos login`). */
  account: StoredAccount | null
}

/** Where the store lives; tests hand in a scratch pair. */
export interface Store {
  credentialsPath: string
  accountsDir: string
}

export const DEFAULT_STORE: Store = {
  credentialsPath: CREDENTIALS_PATH,
  accountsDir: ACCOUNTS_DIR,
}

/** An address's origin (`https://vos.so` for `https://vos.so/api/x`). */
export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url.replace(/\/+$/, '')
  }
}

/** The account an answer names (`user: {id, username, kind}`), or null. */
export function accountFrom(value: unknown): StoredAccount | null {
  if (!value || typeof value !== 'object') return null
  const u = value as { id?: unknown; username?: unknown; kind?: unknown }
  if (typeof u.id !== 'string' || !u.id) return null
  return {
    id: u.id,
    kind: u.kind === 'org' ? 'org' : 'person',
    handle: typeof u.username === 'string' && u.username ? u.username : null,
  }
}

/** The one shape every stored file has. */
export function formatCredential(c: StoredCredential): string {
  const account = c.account
    ? `account=${c.account.id} ${c.account.kind}${c.account.handle ? ` ${c.account.handle}` : ''}\n`
    : ''
  return `${c.key.trim()}\norigin=${originOf(c.origin)}\n${account}`
}

/** The key is the first line; `origin=` and `account=` follow in any order. */
export function parseCredential(text: string): StoredCredential | null {
  const [first, ...rest] = text.split('\n')
  const key = first.trim()
  if (!key) return null
  let origin = ''
  let account: StoredAccount | null = null
  for (const raw of rest) {
    const line = raw.trim()
    if (line.startsWith('origin=')) origin = originOf(line.slice(7).trim())
    else if (line.startsWith('account=')) {
      const [id, kind, handle] = line.slice(8).trim().split(/\s+/)
      if (id)
        account = {
          id,
          kind: kind === 'org' ? 'org' : 'person',
          handle: handle || null,
        }
    }
  }
  return { key, origin: origin || DEFAULT_ORIGIN, account }
}

function readFile(path: string): StoredCredential | null {
  try {
    return parseCredential(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function writeFile(path: string, c: StoredCredential): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, formatCredential(c), { mode: 0o600 })
}

/** The directory an origin's credentials live under: its host, port kept, `:` as `_`. */
export function hostDir(origin: string): string {
  let host: string
  try {
    host = new URL(origin).host
  } catch {
    host = origin.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
  return host.replace(/[^A-Za-z0-9.-]/g, '_') || 'unknown'
}

export function accountPath(
  store: Store,
  origin: string,
  accountId: string,
): string {
  return join(store.accountsDir, hostDir(origin), accountId)
}

/** The active credential, whatever `vos login` or `vos switch` left there. */
export function readActive(
  store: Store = DEFAULT_STORE,
): StoredCredential | null {
  return readFile(store.credentialsPath)
}

/** Every stored credential for `origin` (every origin when absent), the active one first. */
export function listStored(
  store: Store = DEFAULT_STORE,
  origin?: string,
): StoredCredential[] {
  const active = readActive(store)
  const want = origin ? originOf(origin) : null
  const out: StoredCredential[] = []
  const seen = new Set<string>()
  const push = (c: StoredCredential | null) => {
    if (!c || (want && c.origin !== want) || seen.has(c.key)) return
    seen.add(c.key)
    out.push(c)
  }
  push(active)
  let hosts: string[] = []
  try {
    hosts = readdirSync(store.accountsDir)
  } catch {
    return out
  }
  for (const host of hosts.sort()) {
    let files: string[] = []
    try {
      files = readdirSync(join(store.accountsDir, host))
    } catch {
      continue
    }
    for (const file of files.sort()) {
      push(readFile(join(store.accountsDir, host, file)))
    }
  }
  return out
}

/** Is this the credential in the active file? Compared by key, never by name. */
export function isActive(
  c: StoredCredential,
  store: Store = DEFAULT_STORE,
): boolean {
  return readActive(store)?.key === c.key
}

/** The way an account is named in words: `@handle`, else its id. Never the key. */
export function accountLabel(a: StoredAccount | null): string {
  if (!a) return 'an unnamed account'
  return a.handle ? `@${a.handle}` : a.id
}

/** A reference a person types: `@handle`, `handle` or an id, case-insensitive on the handle. */
export function matchesAccount(a: StoredAccount | null, ref: string): boolean {
  if (!a) return false
  const want = ref.trim().replace(/^@/, '')
  if (!want) return false
  if (a.id === want) return true
  return !!a.handle && a.handle.toLowerCase() === want.toLowerCase()
}

/** The stored credential `ref` names on `origin`, or null. */
export function findStored(
  store: Store,
  origin: string,
  ref: string,
): StoredCredential | null {
  return (
    listStored(store, origin).find((c) => matchesAccount(c.account, ref)) ??
    null
  )
}

/** Make `c` the active credential (the file every older reader reads). */
export function activate(store: Store, c: StoredCredential): string {
  writeFile(store.credentialsPath, c)
  return store.credentialsPath
}

/**
 * Store a credential and make it active: its own file when its account is
 * known, then the active file. The credential that WAS active is kept
 * (written to its own file if it had none) and handed back so the verb can
 * say it stays stored; an unnamed one cannot be filed and is replaced.
 */
export function storeCredential(
  store: Store,
  c: StoredCredential,
): { path: string; setAside: StoredCredential | null } {
  const previous = readActive(store)
  let setAside: StoredCredential | null = null
  if (previous && previous.key !== c.key) {
    if (previous.account) {
      writeFile(
        accountPath(store, previous.origin, previous.account.id),
        previous,
      )
      setAside = previous
    }
  }
  if (c.account) writeFile(accountPath(store, c.origin, c.account.id), c)
  return { path: activate(store, c), setAside }
}

/**
 * Forget a stored credential: its own file, and the active file when it is
 * the active one. Returns what was removed, or null when nothing matched.
 */
export function removeStored(
  store: Store,
  c: StoredCredential,
): { wasActive: boolean } {
  const wasActive = isActive(c, store)
  if (c.account) {
    rmSync(accountPath(store, c.origin, c.account.id), { force: true })
  }
  if (wasActive) rmSync(store.credentialsPath, { force: true })
  return { wasActive }
}

/** Forget every stored credential, every origin. */
export function removeAll(store: Store): { had: boolean } {
  const had = existsSync(store.credentialsPath) || existsSync(store.accountsDir)
  rmSync(store.credentialsPath, { force: true })
  rmSync(store.accountsDir, { recursive: true, force: true })
  return { had }
}

/**
 * Which stored credential `vos switch` moves to, pure: a named one; with no
 * name, the OTHER of exactly two (gh's rule); otherwise the reason in words.
 */
export function switchTarget(
  stored: readonly StoredCredential[],
  activeKey: string | null,
  ref: string | undefined,
  origin: string,
): { ok: true; to: StoredCredential } | { ok: false; error: string } {
  if (ref) {
    const to = stored.find((c) => matchesAccount(c.account, ref))
    if (!to)
      return {
        ok: false,
        error: `no credential stored for ${ref.startsWith('@') ? ref : `@${ref.replace(/^@/, '')}`} on ${origin}; run vos login and approve as it${
          stored.length
            ? `, or vos switch ${stored.map((c) => accountLabel(c.account)).join(' | ')}`
            : ''
        }`,
      }
    return { ok: true, to }
  }
  const others = stored.filter((c) => c.key !== activeKey)
  if (stored.length === 0)
    return {
      ok: false,
      error: `nothing is stored for ${origin}; run vos login`,
    }
  if (stored.length === 1)
    return {
      ok: false,
      error: `only ${accountLabel(stored[0].account)} is stored for ${origin}; run vos login and approve as another account to add one`,
    }
  if (others.length === 1) return { ok: true, to: others[0] }
  return {
    ok: false,
    error: `say which: vos switch ${stored.map((c) => accountLabel(c.account)).join(' | ')}`,
  }
}
