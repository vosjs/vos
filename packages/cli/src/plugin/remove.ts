/**
 * `vos delete <vosId|watch-url|dir> [--yes]` — take a vos off vos.so.
 *
 * `DELETE /api/vos/:id` has always answered a content key for its owner (a
 * refused hosted take leaves an empty vos to take down), but no verb said so,
 * so an agent cleaning up after itself had to guess the route. Deleting is
 * the one push that cannot be undone, so it asks: on a terminal it names the
 * vos and waits for a yes, and headless it needs `--yes` said out loud. A
 * directory that tracked the vos is unlinked (its vos.json removed), or the
 * next push would iterate a vos that no longer exists.
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
  parseVosId,
  platformOrigin,
  readSyncState,
  requireCredential,
} from './platform'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'yes'])

export async function cmdDelete(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const target = positionals[0]
  if (!target)
    throw new UsageError('vos delete <vosId|watch-url|dir> [--yes] [--json]')
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

  if (flags.yes !== true) {
    if (!process.stdin.isTTY)
      throw new UsageError(
        `deleting "${title}" (${vosId}) cannot be undone: re-run with --yes to confirm`,
      )
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await rl.question(
      `Delete "${title}" (${vosId}) and every version of it? This cannot be undone. [y/N] `,
    )
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      r.done({ id: vosId, deleted: false }, 'kept — nothing was deleted')
      return EXIT_OK
    }
  }

  const res = await apiJson(origin, `/api/vos/${vosId}`, {
    method: 'DELETE',
    key,
  })
  if (res.status !== 200 && res.status !== 204)
    throw new Error(apiError(`delete ${vosId}`, res))
  let unlinked = false
  if (dir) {
    rmSync(join(dir, SYNC_STATE_NAME), { force: true })
    unlinked = true
  }
  r.done(
    { id: vosId, title, deleted: true, unlinked },
    `deleted "${title}" (${vosId})${unlinked ? `; ${dir} no longer tracks it` : ''}`,
  )
  return EXIT_OK
}
