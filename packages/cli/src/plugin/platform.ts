/**
 * vos.so platform client — THE one HTTP surface of the vos CLI.
 * Every platform verb (fetch/push/pull for programs AND takes, login) goes
 * through here: one origin resolution, one credential ladder, one sync-state
 * file, one 409 conflict shape.
 *
 * Contract notes (mirrored at https://vos.so/llms.txt):
 * - public/unlisted programs read with no auth; writes ride a bearer key
 * - credentials resolve --key → VOS_API_KEY → ~/.config/vos/credentials
 *   (first line; `vos login` writes it) and are NEVER printed — not in
 *   logs, not in errors, not in NDJSON events
 * - pushed configs travel as the MIGRATED object with params/presets
 *   untouched; the platform validates and compiles server-side
 */
import { readFileSync } from 'node:fs'
import { writeFileSafeSync } from './safeWrite'
import { join } from 'node:path'
import { UsageError } from './args'
import { detectHostAgent } from './hostAgent'
import type { Env } from './hostAgent'

/**
 * Origin resolution: --origin (or legacy --api) → VOS_ORIGIN → legacy
 * VOS_API_BASE (which historically carried a trailing /api) → https://vos.so.
 * Every shape converges on a bare origin; paths below carry the /api prefix.
 */
export function platformOrigin(
  flags: { origin?: string; api?: string } = {},
): string {
  const legacyEnv = process.env.VOS_API_BASE?.trim()
  const raw =
    flags.origin ??
    flags.api ??
    process.env.VOS_ORIGIN?.trim() ??
    legacyEnv ??
    'https://vos.so'
  if (!flags.origin && !flags.api && !process.env.VOS_ORIGIN && legacyEnv) {
    process.stderr.write(
      'note: VOS_API_BASE is deprecated — set VOS_ORIGIN (an origin, no /api suffix)\n',
    )
  }
  return raw.replace(/\/+$/, '').replace(/\/api$/, '')
}

/**
 * Accepts a bare vos id, a watch URL (vos.so/vos/{id}), an embed URL
 * (/embed/vos/{id}), or a studio/stage URL (?vos={id}).
 */
export function parseVosId(input: string): string {
  if (!/^https?:\/\//.test(input)) {
    if (/^[A-Za-z0-9_-]+$/.test(input)) return input
    throw new UsageError(`"${input}" is not a vos id or URL`)
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new UsageError(`"${input}" is not a valid URL`)
  }
  const query = url.searchParams.get('vos')
  if (query) return query
  const path = url.pathname.match(/\/vos\/([A-Za-z0-9_-]+)/)
  if (path) return path[1]
  throw new UsageError(
    `could not find a vos id in ${input} — expected /vos/{id} or ?vos={id}`,
  )
}

export function deriveSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '') || 'remix'
  )
}

/**
 * The credential store (MA1) lives in `accounts.ts`; these are the ladder
 * and the file every older reader knows, kept under their old names.
 */
export {
  ACCOUNTS_DIR,
  ACCOUNT_ENV,
  CREDENTIALS_PATH,
  DEFAULT_ORIGIN,
  DEFAULT_STORE,
  accountLabel,
  originOf,
} from './accounts'
import {
  ACCOUNT_ENV,
  CREDENTIALS_PATH,
  DEFAULT_ORIGIN,
  DEFAULT_STORE,
  accountFrom,
  accountLabel,
  findStored,
  listStored,
  originOf,
  parseCredential,
  readActive,
  storeCredential,
} from './accounts'
import type { Store, StoredAccount, StoredCredential } from './accounts'

/**
 * The ACTIVE credential: the key on the first line (every reader of the
 * file reads that line), `origin=<the origin it was minted for>`, and since
 * MA1 `account=<id> <kind> <handle>`. A file written before the origin line
 * is the default origin's.
 */
export function readStoredCredential(
  path = CREDENTIALS_PATH,
): StoredCredential | null {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  return parseCredential(text)
}

/** Keys read from the store, and the origin each belongs to. */
const storedFor = new Map<string, string>()
const warned = new Set<string>()

/** How the last `resolveCredential` found its key, for `vos whoami`. */
export type CredentialVia =
  | 'flag'
  | 'account-flag'
  | 'env'
  | 'account-env'
  | 'directory'
  | 'stored'
export interface Resolved {
  key: string
  via: CredentialVia
  /** The stored account the key belongs to, when it came from the store. */
  account: StoredAccount | null
  origin: string | null
}
let lastResolved: Resolved | null = null
export function lastCredential(): Resolved | null {
  return lastResolved
}

export interface CredentialAsk {
  /** `--key`: goes where the command goes. */
  key?: string
  /** `--account <handle|id>`: a stored credential for the origin, by name. */
  account?: string
  /** The origin in use; the store is read for it. Default: the platform origin. */
  origin?: string
  /**
   * The linked directory (MA2): when its vos.json names an account and no
   * key or name was handed in, the stored credential FOR THAT ACCOUNT is
   * the one used, before the active one.
   */
  dir?: string
  /** Tests hand in a scratch store. */
  store?: Store
}

/** What a linked directory asks of the ladder, pure: use, refuse, or ignore. */
export function directoryVerdict(
  state: Pick<SyncState, 'origin' | 'account'> | null,
  origin: string,
  stored: StoredCredential | null,
  dir: string,
):
  | { kind: 'none' }
  | { kind: 'use'; credential: StoredCredential }
  | { kind: 'other-origin'; note: string }
  | { kind: 'missing'; error: string } {
  if (!state?.account) return { kind: 'none' }
  if (state.origin && originOf(state.origin) !== originOf(origin)) {
    return {
      kind: 'other-origin',
      note: `note: ${dir} was last pushed to ${state.origin}, and this command goes to ${originOf(origin)}`,
    }
  }
  if (stored) return { kind: 'use', credential: stored }
  const name = state.account.handle
    ? `@${state.account.handle}`
    : state.account.id
  const ref = state.account.handle ?? state.account.id
  return {
    kind: 'missing',
    error: `${dir} belongs to ${name}, and no credential for it is stored for ${originOf(origin)}. Run vos login and approve as ${name}, or vos switch ${ref} if it is stored under another name, or pass --account or --key.`,
  }
}

/** The credential flags every platform verb reads, in one place. */
export function credentialFlags(
  flags: Record<string, string | true>,
): CredentialAsk {
  const str = (name: string) =>
    typeof flags[name] === 'string' ? (flags[name] as string) : undefined
  return {
    key: str('key'),
    account: str('account'),
    origin: platformOrigin({ origin: str('origin'), api: str('api') }),
  }
}

function fromStore(
  c: StoredCredential | null,
  via: CredentialVia,
): string | null {
  if (!c) return null
  storedFor.set(c.key, c.origin)
  lastResolved = { key: c.key, via, account: c.account, origin: c.origin }
  return c.key
}

/**
 * The full documented ladder: `--key` → `--account` → VOS_API_KEY →
 * VOS_ACCOUNT → the active credential `vos login` stored. A vos_rg_ remix
 * grant is just a key here. Returns null when nothing resolves — callers
 * decide whether auth is needed. A stored key is remembered with its
 * origin: it is only ever SENT there (`bearerFor`). A name that names no
 * stored credential is an error in words, never a silent fall-through,
 * because the person said which account and must not get another.
 */
export function resolveCredential(
  explicit?: string | CredentialAsk,
  path = CREDENTIALS_PATH,
): string | null {
  const ask: CredentialAsk =
    typeof explicit === 'string' || explicit === undefined
      ? { key: explicit }
      : explicit
  const store: Store = ask.store ?? {
    ...DEFAULT_STORE,
    ...(path !== CREDENTIALS_PATH ? { credentialsPath: path } : {}),
  }
  const origin = ask.origin ?? platformOrigin()
  const flag = ask.key?.trim()
  if (flag) {
    lastResolved = { key: flag, via: 'flag', account: null, origin: null }
    return flag
  }
  const named = ask.account?.trim()
  if (named) {
    const found = findStored(store, origin, named)
    if (!found)
      throw new Error(noSuchAccount(store, origin, named, '--account'))
    return fromStore(found, 'account-flag')
  }
  const env = process.env.VOS_API_KEY?.trim()
  if (env) {
    lastResolved = { key: env, via: 'env', account: null, origin: null }
    return env
  }
  const envName = process.env[ACCOUNT_ENV]?.trim()
  if (envName) {
    const found = findStored(store, origin, envName)
    if (!found)
      throw new Error(noSuchAccount(store, origin, envName, ACCOUNT_ENV))
    return fromStore(found, 'account-env')
  }
  if (ask.dir) {
    const state = readSyncState(ask.dir)
    const verdict = directoryVerdict(
      state,
      origin,
      state?.account ? findStored(store, origin, state.account.id) : null,
      ask.dir,
    )
    if (verdict.kind === 'use')
      return fromStore(verdict.credential, 'directory')
    if (verdict.kind === 'missing') throw new Error(verdict.error)
    if (verdict.kind === 'other-origin' && !warned.has(verdict.note)) {
      warned.add(verdict.note)
      process.stderr.write(`${verdict.note}\n`)
    }
  }
  return fromStore(readActive(store), 'stored')
}

/** The account a key belongs to, asked of the platform once per key. */
const accountOfKey = new Map<string, Promise<StoredAccount | null>>()

/**
 * The account behind the credential a verb is using (MA2): the store's
 * answer when the key came from it, else one `whoami`, remembered for the
 * process. Null when the platform cannot say (an older origin, a refused
 * key); the sync state then names no account.
 */
export function credentialAccount(
  origin: string,
  key: string,
): Promise<StoredAccount | null> {
  const last = lastResolved
  if (last && last.key === key && last.account)
    return Promise.resolve(last.account)
  const id = `${originOf(origin)} ${key}`
  let pending = accountOfKey.get(id)
  if (!pending) {
    pending = apiJson(origin, '/api/user/whoami', { key })
      .then((res) => (res.status === 200 ? accountFrom(res.body.user) : null))
      .catch(() => null)
    accountOfKey.set(id, pending)
  }
  return pending
}

/**
 * What a push or fetch writes into vos.json beside the vos (MA2): the
 * origin, and the account the credential belongs to.
 */
export async function syncIdentity(
  origin: string,
  key: string | null | undefined,
): Promise<Pick<SyncState, 'origin' | 'account'>> {
  const account = key ? await credentialAccount(origin, key) : null
  return {
    origin: originOf(origin),
    ...(account ? { account: { id: account.id, handle: account.handle } } : {}),
  }
}

function noSuchAccount(
  store: Store,
  origin: string,
  ref: string,
  how: string,
): string {
  const have = listStored(store, origin).map((c) => accountLabel(c.account))
  const name = ref.startsWith('@') ? ref : `@${ref}`
  return (
    `${how} names ${name}, and no credential for it is stored for ${origin}: run vos login and approve as ${name}` +
    (have.length ? ` (stored: ${have.join(', ')})` : '')
  )
}

/**
 * The authorization header for a request to `url`, or none. A key the
 * person handed this command (--key, VOS_API_KEY) goes where the command
 * goes; the stored key goes only to the origin it was minted for, and a
 * request anywhere else is sent without it, once said.
 */
export function bearerFor(
  key: string | null | undefined,
  url: string,
): Record<string, string> {
  if (!key) return {}
  const bound = storedFor.get(key)
  const to = originOf(url)
  if (bound && bound !== to) {
    if (!warned.has(to)) {
      warned.add(to)
      process.stderr.write(
        `note: the credential vos login stored is for ${bound}, so it is not sent to ${to}; for ${to}, run vos login --origin ${to}, or pass --key or VOS_API_KEY\n`,
      )
    }
    return {}
  }
  return { authorization: `Bearer ${key}` }
}

/** Where a key for `origin` is minted. */
export const mintAt = (origin: string = DEFAULT_ORIGIN): string =>
  `${originOf(origin)}/app/api`

export function requireCredential(
  explicit?: string | CredentialAsk,
  origin?: string,
): string {
  const key = resolveCredential(explicit)
  if (!key) {
    const at =
      origin ??
      (typeof explicit === 'object' ? explicit.origin : undefined) ??
      platformOrigin()
    throw new Error(
      'no credential found — pass --key, set VOS_API_KEY, or run `vos login` ' +
        `(mint a content key at ${mintAt(at)}; a vos_rg_ remix grant works too)`,
    )
  }
  return key
}

/**
 * `vos login` stores here: the credential's own file under
 * `~/.config/vos/accounts/<host>/<id>` when its account is known, and the
 * active file (0700 dir, 0600 file, the key on the first line, the origin
 * and the account on the next lines). The credential that was active stays
 * stored, so a second sign-in never discards the first.
 */
export function writeCredential(
  key: string,
  origin: string = DEFAULT_ORIGIN,
  path = CREDENTIALS_PATH,
  account: StoredAccount | null = null,
): string {
  return storeLogin(key, origin, account, {
    ...DEFAULT_STORE,
    ...(path !== CREDENTIALS_PATH ? { credentialsPath: path } : {}),
  }).path
}

export function storeLogin(
  key: string,
  origin: string,
  account: StoredAccount | null,
  store: Store = DEFAULT_STORE,
): { path: string; setAside: StoredCredential | null } {
  return storeCredential(store, {
    key: key.trim(),
    origin: originOf(origin),
    account,
  })
}

/**
 * The self-reported client string stamped onto pushed versions (User-Agent
 * grammar). Display-only on the platform — attribution trust
 * stays with the credential. The ladder: an explicit VOS_CLIENT (e.g.
 * VOS_CLIENT=claude-code/2.1), else the coding agent this CLI was spawned by
 * (`claude-code vos-cli`, read from the environment by `detectHostAgent`),
 * else the transport alone, so history rows name the tool that pushed.
 */
export function clientId(
  env: Env = process.env,
  exists?: (path: string) => boolean,
): string {
  const explicit = env.VOS_CLIENT?.trim()
  if (explicit && explicit.length <= 60 && !/[\r\n]/.test(explicit))
    return explicit
  const host = detectHostAgent(env, exists)
  return host ? `${host} vos-cli` : 'vos-cli'
}

/** A request that never got an answer, in words that name where it went. */
export function unreachable(origin: string, e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string } }
  const why = [err?.message, err?.cause?.code].filter(Boolean).join(': ')
  return `could not reach ${origin}${why ? ` (${why})` : ''}; is it the origin you meant? (--origin, or VOS_ORIGIN)`
}

export interface ApiResult {
  status: number
  body: Record<string, unknown>
  /** The origin that answered. */
  origin?: string
}

export async function apiJson(
  origin: string,
  path: string,
  init: {
    method?: string
    key?: string | null
    body?: unknown
    /** Raw request body (uploads) — used verbatim, with `headers`. */
    raw?: Uint8Array
    headers?: Record<string, string>
  } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...init.headers,
  }
  Object.assign(headers, bearerFor(init.key, origin))
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const reqBody: BodyInit | undefined =
    init.raw !== undefined
      ? (init.raw as unknown as BodyInit)
      : init.body === undefined
        ? undefined
        : JSON.stringify(init.body)
  let res: Response
  try {
    res = await fetch(`${origin}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: reqBody,
    })
  } catch (e) {
    throw new Error(unreachable(origin, e))
  }
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    // non-JSON error bodies stay {}
  }
  return { status: res.status, body, origin }
}

/**
 * A refusal's issue list (`details: [{ path, message }]`, the shape every
 * vos.so route answers a failed schema with), one indented line per issue.
 * Empty when the body carries none.
 */
export function detailLine(body: Record<string, unknown>): string {
  const details = body.details
  if (!Array.isArray(details) || !details.length) return ''
  const lines = (details as Record<string, unknown>[]).map((d) => {
    const path = Array.isArray(d.path) ? d.path.join('.') : ''
    return `${path ? `${path}: ` : ''}${String(d.message ?? JSON.stringify(d))}`
  })
  return `\n  ${lines.join('\n  ')}`
}

/**
 * Human-readable error line for a failed platform response, with the
 * issues behind a generic `error` ("Invalid input") on the lines below it,
 * because the generic word alone names nothing to fix. Never echoes
 * credentials.
 */
export function apiError(what: string, r: ApiResult): string {
  const detail =
    typeof r.body.error === 'string'
      ? r.body.error + detailLine(r.body)
      : r.body.details !== undefined
        ? JSON.stringify(r.body.details)
        : ''
  const hint =
    r.status === 401
      ? ` (run \`vos login\`, or set VOS_API_KEY — mint a key at ${mintAt(r.origin)})`
      : ''
  return `${what} → ${r.status}${detail ? `: ${detail}` : ''}${hint}`
}

/**
 * The next step a push without `--prompt` prints: the prompt that made a
 * vos is shown on its watch page by default, in the person's own words.
 * An agent reads a command's output and acts on it, so the push says the
 * command outright. The vos lands private, so its owner sees the prompt
 * before anyone else can.
 */
export function promptHint(target: string, vosId: string): string {
  return `vos push ${target} --vos ${vosId} --prompt "<the person's prompt, as they wrote it>"`
}

// ---------------------------------------------------------------------------
// Sync state — ONE file (vos.json) for both artifact kinds, legacy-read
// compatible with the two files it replaces: push.json (take dirs) and
// meta.json (fetched program dirs).
// ---------------------------------------------------------------------------

export const SYNC_STATE_NAME = 'vos.json'

export interface SyncState {
  vosId: string
  /** The hosted version this directory is based on — the next push's base. */
  versionId: string | null
  pushedAt?: string
  title?: string
  slug?: string
  remixOfId?: string
  /**
   * The files `vos fetch --media` brought home, by their path in the
   * directory: the hosted address each came from and its sha256 then. A
   * claimable push of the take names these originals instead of uploading,
   * and only while the bytes are unchanged.
   */
  hostedMedia?: Record<string, { ref: string; sha256: string }>
  /** The origin this directory was pushed to or fetched from (MA2). */
  origin?: string
  /**
   * The ACCOUNT this directory's work belongs to (MA2): the credential's
   * account at the last push or fetch. Every verb on the directory resolves
   * a stored credential for it before the active one, so a take fetched as
   * an organization pushes as it from any terminal that has it stored.
   */
  account?: { id: string; handle: string | null }
}

/** The `account` an answer or a file names, read defensively. */
function syncAccountOf(
  value: unknown,
): { id: string; handle: string | null } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const a = value as { id?: unknown; handle?: unknown }
  if (typeof a.id !== 'string' || !a.id) return undefined
  return { id: a.id, handle: typeof a.handle === 'string' ? a.handle : null }
}

/** The `hostedMedia` map, read defensively (a hand-edited vos.json). */
function hostedMediaOf(
  value: unknown,
): Record<string, { ref: string; sha256: string }> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, { ref: string; sha256: string }> = {}
  for (const [file, entry] of Object.entries(value)) {
    const e = entry as { ref?: unknown; sha256?: unknown } | null
    if (e && typeof e.ref === 'string' && typeof e.sha256 === 'string')
      out[file] = { ref: e.ref, sha256: e.sha256 }
  }
  return Object.keys(out).length ? out : undefined
}

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * vos.json → legacy push.json ({vosId, versionId}) → legacy meta.json
 * ({id, currentVersionId} — guarded on a string `id` so a take dir's
 * RecordingMeta meta.json is never misread as sync state).
 */
export function readSyncState(dir: string): SyncState | null {
  const own = readJsonFile(join(dir, SYNC_STATE_NAME))
  if (own && typeof own.vosId === 'string') {
    return {
      vosId: own.vosId,
      versionId: typeof own.versionId === 'string' ? own.versionId : null,
      ...(typeof own.pushedAt === 'string' ? { pushedAt: own.pushedAt } : {}),
      ...(typeof own.title === 'string' ? { title: own.title } : {}),
      ...(typeof own.slug === 'string' ? { slug: own.slug } : {}),
      ...(typeof own.remixOfId === 'string'
        ? { remixOfId: own.remixOfId }
        : {}),
      ...(hostedMediaOf(own.hostedMedia)
        ? { hostedMedia: hostedMediaOf(own.hostedMedia) }
        : {}),
      ...(typeof own.origin === 'string' && own.origin
        ? { origin: originOf(own.origin) }
        : {}),
      ...(syncAccountOf(own.account)
        ? { account: syncAccountOf(own.account) }
        : {}),
    }
  }
  const push = readJsonFile(join(dir, 'push.json'))
  if (push && typeof push.vosId === 'string') {
    return {
      vosId: push.vosId,
      versionId: typeof push.versionId === 'string' ? push.versionId : null,
      ...(typeof push.pushedAt === 'string' ? { pushedAt: push.pushedAt } : {}),
    }
  }
  const meta = readJsonFile(join(dir, 'meta.json'))
  if (meta && typeof meta.id === 'string') {
    return {
      vosId: meta.id,
      versionId:
        typeof meta.currentVersionId === 'string'
          ? meta.currentVersionId
          : null,
      ...(typeof meta.title === 'string' ? { title: meta.title } : {}),
      ...(typeof meta.slug === 'string' ? { slug: meta.slug } : {}),
      ...(typeof meta.remixOfId === 'string'
        ? { remixOfId: meta.remixOfId }
        : {}),
    }
  }
  return null
}

/** Merge-writes vos.json; the legacy files are left alone (read-only compat). */
export function writeSyncState(
  dir: string,
  patch: Partial<SyncState> & { vosId: string },
): SyncState {
  const merged = {
    ...(readSyncState(dir) ?? { versionId: null }),
    ...patch,
  } as SyncState
  writeFileSafeSync(
    join(dir, SYNC_STATE_NAME),
    `${JSON.stringify(merged, null, 2)}\n`,
  )
  return merged
}

// ---------------------------------------------------------------------------
// The /changes payload (shape mirrored from the platform)
// ---------------------------------------------------------------------------

export interface VersionChange {
  versionId?: string
  versionNumber?: number
  origin?: string
  label?: string | null
  note?: string | null
  summary?: string
}

/** Human lines for a changes walk — origin/label attributed, note indented. */
export function formatChanges(changes: readonly VersionChange[]): string[] {
  const lines: string[] = []
  for (const ch of changes) {
    const label = ch.label ? ` · ${ch.label}` : ''
    const who = ch.origin === 'studio' ? 'human' : (ch.origin ?? 'unknown')
    lines.push(
      `v${String(ch.versionNumber ?? '?')} (${who}${label}): ${ch.summary ?? ''}`,
    )
    if (ch.note) lines.push(`    note: ${ch.note}`)
  }
  return lines
}

/**
 * The warnings a write came back with (a knob or Look the platform dropped),
 * one line each. A push that saved is not a push that kept everything.
 */
export function serverWarnings(
  body: Record<string, unknown>,
  log: (line: string) => void,
): void {
  const warnings = Array.isArray(body.warnings) ? body.warnings : []
  for (const w of warnings) if (typeof w === 'string') log(`warning ${w}`)
}
