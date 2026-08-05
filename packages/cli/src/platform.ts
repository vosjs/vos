/**
 * vos.so platform client — the pieces of fetch/push that talk HTTP.
 *
 * Contract notes (mirrored at https://vos.so/llms-remix.txt):
 * - public/unlisted programs read with no auth; writes ride a bearer key
 * - credentials resolve env → ~/.config/vos/credentials, and are NEVER
 *   printed — not in logs, not in errors, not in NDJSON events
 * - pushed configs travel as the RAW object (params/presets preserved);
 *   the platform validates and compiles server-side
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { UsageError } from './args'

export const PLATFORM_ORIGIN = process.env.VOS_ORIGIN ?? 'https://vos.so'

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
  throw new UsageError(`could not find a vos id in ${input} — expected /vos/{id} or ?vos={id}`)
}

/**
 * Resolution order (llms-remix.txt): VOS_API_KEY env, then the first line of
 * ~/.config/vos/credentials. Returns null when neither exists — callers
 * decide whether the operation needs auth.
 */
export function resolveCredential(): string | null {
  const env = process.env.VOS_API_KEY?.trim()
  if (env) return env
  try {
    const first = readFileSync(join(homedir(), '.config', 'vos', 'credentials'), 'utf8')
      .split('\n')[0]
      .trim()
    return first || null
  } catch {
    return null
  }
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

export interface ApiResult {
  status: number
  body: Record<string, unknown>
}

export async function apiJson(
  path: string,
  init: { method?: string; key?: string | null; body?: unknown } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (init.key) headers.authorization = `Bearer ${init.key}`
  if (init.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${PLATFORM_ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
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
      ? ' (set VOS_API_KEY or write ~/.config/vos/credentials — mint a key at https://vos.so/app/api)'
      : ''
  return `${what} → ${r.status}${detail ? `: ${detail}` : ''}${hint}`
}

// ---------------------------------------------------------------------------
// Local tracking state (meta.json) + the pull-contract payload
// ---------------------------------------------------------------------------

/**
 * meta.json beside a config.json makes the directory TRACK a vos, like a
 * remote: `id` + `currentVersionId` are the pull/push base. `vos fetch`
 * seeds it from the source; `vos push` repoints it at what it created.
 */
export function readMeta(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

export function writeMeta(dir: string, patch: Record<string, unknown>): void {
  const merged = { ...(readMeta(dir) ?? {}), ...patch }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(merged, null, 2))
}

/** One version of the /changes walk (shape mirrored from the platform). */
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
    lines.push(
      `v${String(ch.versionNumber ?? '?')} (${ch.origin ?? 'unknown'}${label}): ${ch.summary ?? ''}`,
    )
    if (ch.note) lines.push(`    note: ${ch.note}`)
  }
  return lines
}
