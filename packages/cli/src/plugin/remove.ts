/**
 * `vos delete <vosId|watch-url|dir> [--yes] [--dry-run]`: move a vos to
 * Trash on vos.so.
 *
 * Deleting used to be the one push that could not be undone, and the verb
 * said so. It no longer is: vos.so moves a deleted vos to Trash, where it
 * stays restorable until the date the delete prints (`vos restore <id>`
 * brings it back as it was). Nothing a key can do is final; only the person
 * can empty Trash, on the web.
 *
 * It still asks, because consent is not the same thing as an undo: on a
 * terminal it names the vos and waits for a yes, and headless it needs
 * `--yes` said out loud. `--dry-run` names what would move and moves
 * nothing, so an agent asked to clean up can show the list first. A
 * directory that tracked the vos is unlinked (its vos.json removed), or the
 * next push would iterate a vos that is in Trash.
 */
import { existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_OK, createReporter } from './output'
import {
  SYNC_STATE_NAME,
  apiError,
  apiJson,
  clientId,
  parseVosId,
  platformOrigin,
  readSyncState,
  requireCredential,
} from './platform'
import { restoreDate } from './trash'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'yes', 'dry-run'])

export async function cmdDelete(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const target = positionals[0]
  if (!target)
    throw new UsageError(
      'vos delete <vosId|watch-url|dir> [--yes] [--dry-run] [--json]',
    )
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  }).replace(/\/+$/, '')
  const key = requireCredential(strFlag(flags, 'key'))

  const dir =
    existsSync(target) && statSync(target).isDirectory() ? target : null
  const vosId = dir ? readSyncState(dir)?.vosId : parseVosId(target)
  if (!vosId)
    throw new UsageError(
      `${target} tracks no vos (no ${SYNC_STATE_NAME}): pass the vos id or its watch URL`,
    )

  const meta = await apiJson(origin, `/api/vos/${vosId}`, { key })
  if (meta.status !== 200) throw new Error(apiError(`read ${vosId}`, meta))
  const vos = (meta.body.vos ?? {}) as Record<string, unknown>
  const title = typeof vos.title === 'string' ? vos.title : vosId

  if (flags['dry-run'] === true) {
    r.done(
      { id: vosId, title, deleted: false, dryRun: true },
      `would move "${title}" (${vosId}) to Trash; nothing was changed`,
    )
    return EXIT_OK
  }

  if (flags.yes !== true) {
    if (!process.stdin.isTTY)
      throw new UsageError(
        `"${title}" (${vosId}) would move to Trash: re-run with --yes to confirm, or --dry-run to only look`,
      )
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await rl.question(
      `Move "${title}" (${vosId}) to Trash? It stays restorable there for a while (vos restore ${vosId}). [y/N] `,
    )
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      r.done({ id: vosId, deleted: false }, 'kept: nothing was deleted')
      return EXIT_OK
    }
  }

  const res = await apiJson(origin, `/api/vos/${vosId}`, {
    method: 'DELETE',
    key,
    // Who did it, for the person reading Trash later (display only).
    headers: { 'x-vos-client': clientId() },
  })
  if (res.status !== 200 && res.status !== 204)
    throw new Error(apiError(`delete ${vosId}`, res))
  let unlinked = false
  if (dir) {
    rmSync(join(dir, SYNC_STATE_NAME), { force: true })
    unlinked = true
  }
  const trashed = res.body.trashed === true
  const restoreUntil =
    typeof res.body.restoreUntil === 'string' ? res.body.restoreUntil : null
  const tail = unlinked ? `; ${dir} no longer tracks it` : ''
  r.done(
    {
      id: vosId,
      title,
      deleted: true,
      trashed,
      ...(restoreUntil ? { restoreUntil } : {}),
      unlinked,
    },
    trashed
      ? `moved "${title}" (${vosId}) to Trash${
          restoreUntil ? `, restorable until ${restoreDate(restoreUntil)}` : ''
        }: vos restore ${vosId}${tail}`
      : // A vos with no version (a refused hosted take's empty shell) has
        // nothing to restore, so the platform erases it.
        `deleted "${title}" (${vosId})${tail}`,
  )
  return EXIT_OK
}
