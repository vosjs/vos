/**
 * Trash on vos.so, from the command line.
 *
 *   vos trash                              what is in Trash, by whom, until when
 *   vos restore <id|watch-url> [...]       bring those back, as they were
 *   vos trash restore --since <1h|ISO>     undo everything a key trashed
 *
 * Deleting on vos.so moves a thing to Trash; these are the verbs that see
 * it and undo it. There is deliberately no `vos trash empty`: making a
 * delete final is the person's act, on the web, and no key, flag or verb
 * here can do it.
 */
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_OK, createReporter } from './output'
import {
  apiError,
  apiJson,
  parseVosId,
  platformOrigin,
  requireCredential,
} from './platform'

const BOOLEAN_FLAGS = new Set(['json', 'help'])

export interface TrashEntry {
  kind: 'vos' | 'folder' | 'asset'
  id: string
  title: string
  deletedAt: string
  restoreUntil: string
  deletedVia: string | null
  deletedKeyId: string | null
  deletedKeyName: string | null
  deletedClient: string | null
  members: { voses: number; assets: number; folders: number } | null
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** `14 Oct`, with the year when it is not this one. A date, never a duration. */
export function restoreDate(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  return d.getUTCFullYear() === now.getUTCFullYear()
    ? day
    : `${day} ${d.getUTCFullYear()}`
}

/** Who moved it, in words: a tool, a key by name, or the person. */
export function trashedBy(entry: {
  deletedVia: string | null
  deletedKeyName: string | null
  deletedClient: string | null
}): string {
  if (entry.deletedVia === 'key') {
    return entry.deletedClient ?? entry.deletedKeyName ?? 'a key'
  }
  if (entry.deletedVia === 'admin') return 'an admin'
  if (entry.deletedVia === 'service') return 'vos.so'
  return 'you'
}

/**
 * `--since` as a moment: `90s`, `30m`, `1h`, `2d`, or an ISO timestamp.
 * Null when it is none of those.
 */
export function sinceMoment(value: string, now = new Date()): Date | null {
  const rel = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(value.trim())
  if (rel) {
    const unit = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[
      rel[2] as 's' | 'm' | 'h' | 'd'
    ]
    return new Date(now.getTime() - Number(rel[1]) * unit)
  }
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at
}

function words(kind: TrashEntry['kind']): string {
  return kind === 'vos' ? 'vos' : kind === 'folder' ? 'project' : 'file'
}

function context(flags: Record<string, string | true>) {
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  }).replace(/\/+$/, '')
  return { origin, key: requireCredential(strFlag(flags, 'key')) }
}

async function readTrash(ctx: {
  origin: string
  key: string
}): Promise<TrashEntry[]> {
  const res = await apiJson(ctx.origin, '/api/trash', { key: ctx.key })
  if (res.status !== 200) throw new Error(apiError('read Trash', res))
  return (res.body.entries ?? []) as TrashEntry[]
}

/** POST a restore until the platform says it is done (bounded). */
async function restore(
  ctx: { origin: string; key: string },
  body: Record<string, unknown>,
): Promise<{ restored: { kind: string; id: string }[]; missing: unknown[] }> {
  let restored: { kind: string; id: string }[] = []
  let missing: unknown[] = []
  for (let pass = 0; pass < 100; pass++) {
    const res = await apiJson(ctx.origin, '/api/trash/restore', {
      method: 'POST',
      key: ctx.key,
      body,
    })
    if (res.status !== 200) throw new Error(apiError('restore', res))
    if (pass === 0) {
      restored = (res.body.restored ?? []) as { kind: string; id: string }[]
      missing = (res.body.missing ?? []) as unknown[]
    }
    if (res.body.done !== false) break
  }
  return { restored, missing }
}

/** `vos trash` and `vos trash restore --since …`. */
export async function cmdTrash(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const ctx = context(flags)

  if (positionals[0] === 'restore') {
    const raw = strFlag(flags, 'since')
    const since = raw ? sinceMoment(raw) : null
    if (!since)
      throw new UsageError(
        'vos trash restore --since <30m|1h|2d|ISO time> [--by <key name>] [--json]',
      )
    const by = strFlag(flags, 'by')
    let keyId: string | null = null
    if (by) {
      const match = (await readTrash(ctx)).find(
        (e) => e.deletedKeyName === by || e.deletedKeyId?.startsWith(by),
      )
      keyId = match?.deletedKeyId ?? null
      if (!keyId)
        throw new Error(`nothing in Trash was moved there by a key named ${by}`)
    } else {
      // The key this CLI is signed in with: undoing your own deletes.
      const me = await apiJson(ctx.origin, '/api/user/whoami', {
        key: ctx.key,
      })
      keyId = ((me.body.key ?? null) as { id?: string } | null)?.id ?? null
      if (me.status !== 200 || !keyId)
        throw new Error(
          'could not tell which key this is: pass --by <key name> (vos trash lists them)',
        )
    }
    const done = await restore(ctx, { keyId, since: since.toISOString() })
    r.done(
      { restored: done.restored, count: done.restored.length },
      done.restored.length
        ? `restored ${done.restored.length} item${done.restored.length === 1 ? '' : 's'} moved to Trash since ${since.toISOString()}`
        : `nothing was moved to Trash by that key since ${since.toISOString()}`,
    )
    return EXIT_OK
  }
  if (positionals[0])
    throw new UsageError(
      `vos trash has no "${positionals[0]}": vos trash, or vos trash restore --since <time>. Trash is emptied by a person, at vos.so/app/trash`,
    )

  const entries = await readTrash(ctx)
  if (flags.json === true) {
    r.done({ entries, count: entries.length }, '')
    return EXIT_OK
  }
  if (entries.length === 0) {
    r.done({ entries, count: 0 }, 'Trash is empty')
    return EXIT_OK
  }
  const lines = entries.map((e) => {
    const inside = e.members
      ? ` (${e.members.voses} vos, ${e.members.assets} files)`
      : ''
    return `  ${words(e.kind).padEnd(7)} ${e.id}  "${e.title}"${inside}: moved by ${trashedBy(e)}, restorable until ${restoreDate(e.restoreUntil)}`
  })
  r.done(
    { entries, count: entries.length },
    `${entries.length} in Trash\n${lines.join('\n')}\nrestore one: vos restore <id>   (emptying Trash is the person's act, at vos.so/app/trash)`,
  )
  return EXIT_OK
}

/** `vos restore <id|watch-url> […]`. */
export async function cmdRestore(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  if (positionals.length === 0)
    throw new UsageError('vos restore <id|watch-url> [...] [--json]')
  const r = createReporter(flags.json === true)
  const ctx = context(flags)

  // An id says nothing about its kind: Trash does.
  const entries = await readTrash(ctx)
  const wanted = positionals.map((p) => parseVosId(p) ?? p)
  const units = wanted.map((id) => {
    const entry = entries.find((e) => e.id === id)
    if (!entry)
      throw new Error(
        `${id} is not in Trash (vos trash lists what is; something inside a trashed project comes back with the project)`,
      )
    return { kind: entry.kind, id: entry.id, title: entry.title }
  })
  const done = await restore(ctx, {
    ids: units.map(({ kind, id }) => ({ kind, id })),
  })
  const names = units.map((u) => `"${u.title}"`).join(', ')
  r.done(
    { restored: done.restored, count: done.restored.length },
    `restored ${names}`,
  )
  return EXIT_OK
}
