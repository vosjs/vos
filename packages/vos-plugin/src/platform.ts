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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { UsageError } from './args'

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

export const CREDENTIALS_PATH = join(homedir(), '.config', 'vos', 'credentials')

/**
 * The full documented ladder: explicit --key → VOS_API_KEY → the first line
 * of ~/.config/vos/credentials. A vos_rg_ remix grant is just a key here.
 * Returns null when nothing resolves — callers decide whether auth is needed.
 */
export function resolveCredential(explicit?: string): string | null {
  const flag = explicit?.trim()
  if (flag) return flag
  const env = process.env.VOS_API_KEY?.trim()
  if (env) return env
  try {
    const first = readFileSync(CREDENTIALS_PATH, 'utf8').split('\n')[0].trim()
    return first || null
  } catch {
    return null
  }
}

export function requireCredential(explicit?: string): string {
  const key = resolveCredential(explicit)
  if (!key) {
    throw new Error(
      'no credential found — pass --key, set VOS_API_KEY, or run `vos login` ' +
        '(mint a content key at https://vos.so/app/api; a vos_rg_ remix grant works too)',
    )
  }
  return key
}

/** `vos login` writes here: 0700 dir, 0600 file, first line is the key. */
export function writeCredential(key: string): string {
  mkdirSync(join(homedir(), '.config', 'vos'), { recursive: true, mode: 0o700 })
  writeFileSync(CREDENTIALS_PATH, `${key.trim()}\n`, { mode: 0o600 })
  return CREDENTIALS_PATH
}

/**
 * The self-reported client string stamped onto pushed versions (User-Agent
 * grammar). Display-only on the platform — attribution trust
 * stays with the credential. Agents driving this CLI override it with
 * VOS_CLIENT (e.g. VOS_CLIENT=claude-code/2.1) so history rows name the
 * tool, not just the transport.
 */
export function clientId(): string {
  const env = process.env.VOS_CLIENT?.trim()
  if (env && env.length <= 60 && !/[\r\n]/.test(env)) return env
  return 'vos-cli'
}

export interface ApiResult {
  status: number
  body: Record<string, unknown>
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
  if (init.key) headers.authorization = `Bearer ${init.key}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const reqBody: BodyInit | undefined =
    init.raw !== undefined
      ? (init.raw as unknown as BodyInit)
      : init.body === undefined
        ? undefined
        : JSON.stringify(init.body)
  const res = await fetch(`${origin}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: reqBody,
  })
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    // non-JSON error bodies stay {}
  }
  return { status: res.status, body }
}

/** Human-readable error line for a failed platform response. Never echoes credentials. */
export function apiError(what: string, r: ApiResult): string {
  const detail =
    typeof r.body.error === 'string'
      ? r.body.error
      : r.body.details !== undefined
        ? JSON.stringify(r.body.details)
        : ''
  const hint =
    r.status === 401
      ? ' (run `vos login`, or set VOS_API_KEY — mint a key at https://vos.so/app/api)'
      : ''
  return `${what} → ${r.status}${detail ? `: ${detail}` : ''}${hint}`
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
  writeFileSync(
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
