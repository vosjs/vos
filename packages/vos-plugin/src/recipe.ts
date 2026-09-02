/**
 * `vos recipe` — put a recipe document on the shelf. A recipe is a plain
 * markdown ASSET (category `recipe`), the one asset an agent is expected to
 * WRITE: the write-back prompt line and the kept-prior-body history exist
 * for exactly this act, and until now the CLI had no verb for it.
 *
 *   vos recipe push <file.md> --folder <folderId|slug> [--json]   create
 *   vos recipe push <file.md> --asset <assetId> [--json]           replace
 *
 * Create is `POST /assets/upload` (multipart, filed into the folder you
 * pulled); replace is `PUT /assets/:id/file` (raw markdown, same id and
 * fileUrl, the displaced body kept as the one prior version). ONE verb for
 * both because from the agent's side they are the same act: put this
 * document where the collection reads it. Reading is `vos folder pull`
 * (every recipe, inherited ones included); restore stays a human gesture
 * on the recipe page — a verb that undoes the owner's edit is not one to
 * hand an agent.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { UsageError, parseArgs, strFlag } from './args'
import { listFolders, resolveFolder } from './folder'
import { EXIT_OK, createReporter } from './output'
import {
  apiError,
  apiJson,
  platformOrigin,
  requireCredential,
} from './platform'

const BOOLEAN_FLAGS = new Set(['json', 'help'])
const USAGE =
  'vos recipe push <file.md> (--folder <folderId|slug> | --asset <assetId>)'

/** The server holds recipes to .md; refuse locally so the error names the file. */
export function recipeFilename(file: string): string {
  const name = basename(file)
  if (!/\.md$/i.test(name)) {
    throw new UsageError(`a recipe is a markdown file — ${name} is not .md`)
  }
  return name
}

async function cmdPush(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const [file] = positionals
  const folderRef = strFlag(flags, 'folder')
  const assetId = strFlag(flags, 'asset')
  if (!file || (!folderRef && !assetId) || (folderRef && assetId)) {
    throw new UsageError(USAGE)
  }
  const filename = recipeFilename(file)
  const body = readFileSync(file)
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))

  if (assetId) {
    const res = await apiJson(origin, `/api/assets/${assetId}/file`, {
      method: 'PUT',
      key,
      raw: new Uint8Array(body),
      headers: { 'content-type': 'text/markdown' },
    })
    if (res.status !== 200) {
      throw new Error(apiError(`replace recipe ${assetId}`, res))
    }
    r.done(
      { id: assetId, filename: res.body.filename, replaced: true },
      `replaced recipe ${assetId} (${String(res.body.filename)}) in place — the prior body is kept, restore it from the recipe page`,
    )
    return EXIT_OK
  }

  const folder = resolveFolder(await listFolders(origin, key), folderRef!)
  const form = new FormData()
  form.set('file', new Blob([body], { type: 'text/markdown' }), filename)
  form.set('folderId', folder.id)
  const res = await fetch(`${origin}/api/assets/upload`, {
    method: 'POST',
    headers: { accept: 'application/json', authorization: `Bearer ${key}` },
    body: form,
  })
  let payload: Record<string, unknown> = {}
  try {
    payload = (await res.json()) as Record<string, unknown>
  } catch {
    // non-JSON error bodies stay {}
  }
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      apiError(`push recipe ${filename}`, {
        status: res.status,
        body: payload,
      }),
    )
  }
  const meta = (payload.metadata ?? {}) as Record<string, unknown>
  // The SERVER names the file (a recipe a key files takes the CAPS
  // convention, CUT.md), so report what landed — never the local basename,
  // or the terminal and the shelf describe the same recipe differently.
  const stored =
    typeof payload.filename === 'string' ? payload.filename : filename
  r.done(
    {
      id: payload.id,
      filename: payload.filename,
      folder: folder.slug,
      name: meta.name,
      description: meta.description,
    },
    `pushed ${stored} into ${folder.slug} (${String(payload.id)})${
      typeof meta.name === 'string' ? ` — ${meta.name}` : ''
    }\nReplace it later with: vos recipe push ${file} --asset ${String(payload.id)}`,
  )
  return EXIT_OK
}

export async function cmdRecipe(argv: string[]): Promise<number> {
  const sub = argv[0]
  const rest = argv.slice(1)
  switch (sub) {
    case 'push':
      return cmdPush(rest)
    default:
      throw new UsageError(`vos recipe <push> — ${USAGE}`)
  }
}
