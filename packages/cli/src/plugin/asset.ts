/**
 * `vos asset` — the work verbs on individual assets. Deliberately
 * NOT a folder verb: folders are shelf structure (the human's, add-only),
 * assets are WORK — and renaming your own work is an ordinary edit.
 *
 *   vos asset rename <assetId> <newname.ext> [--json]
 *   vos asset push <file...> [--folder <folderId|slug>] [--json]
 *
 * rename is the CLI face of `PATCH /assets/:id { filename }`: a
 * one-column update, bytes and fileUrl untouched. The server holds the
 * extension to the asset's category (a recipe stays .md).
 *
 * push is `POST /assets/upload` per file (SKQ: the launch-kit loop files
 * its posters and store stills into the release's project). A content key
 * uploads models (.glb/.gltf), recipes (.md — though `vos recipe push` is
 * the recipe verb, with replace-in-place) and images (.png/.jpg/.jpeg/
 * .webp/.gif, 40/24h); the server refuses anything else in words. Files
 * upload one by one and a refusal names the file it stopped on, so a
 * partial push is legible, never silent.
 */
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
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

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.md': 'text/markdown',
}

async function cmdRename(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const [assetId, filename] = positionals
  if (!assetId || !filename) {
    throw new UsageError('vos asset rename <assetId> <newname.ext>')
  }
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))

  const res = await apiJson(origin, `/api/assets/${assetId}`, {
    method: 'PATCH',
    key,
    body: { filename },
  })
  if (res.status !== 200) throw new Error(apiError(`rename ${assetId}`, res))
  r.done(
    { id: assetId, filename: res.body.filename },
    `renamed asset ${assetId} → ${String(res.body.filename)}`,
  )
  return EXIT_OK
}

async function cmdPush(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  if (positionals.length === 0) {
    throw new UsageError('vos asset push <file...> [--folder <folderId|slug>]')
  }
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))
  const folderRef = strFlag(flags, 'folder')
  const folder = folderRef
    ? resolveFolder(await listFolders(origin, key), folderRef)
    : null

  const uploaded: { id: unknown; filename: unknown }[] = []
  for (const file of positionals) {
    const name = basename(file)
    const mime =
      MIME_BY_EXT[extname(name).toLowerCase()] ?? 'application/octet-stream'
    const body = readFileSync(file)
    const form = new FormData()
    form.set('file', new Blob([body], { type: mime }), name)
    if (folder) form.set('folderId', folder.id)
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
      const landed = uploaded.length
        ? ` (${uploaded.length} of ${positionals.length} landed before it)`
        : ''
      throw new Error(
        apiError(`push ${name}${landed}`, {
          status: res.status,
          body: payload,
        }),
      )
    }
    uploaded.push({ id: payload.id, filename: payload.filename })
    r.log(
      `uploaded ${String(payload.filename ?? name)} (${String(payload.id)})`,
    )
  }
  r.done(
    {
      uploaded,
      count: uploaded.length,
      folder: folder?.slug ?? null,
    },
    `pushed ${uploaded.length} asset${uploaded.length === 1 ? '' : 's'}${
      folder ? ` into ${folder.slug}` : ''
    }`,
  )
  return EXIT_OK
}

export async function cmdAsset(argv: string[]): Promise<number> {
  const sub = argv[0]
  const rest = argv.slice(1)
  switch (sub) {
    case 'rename':
      return cmdRename(rest)
    case 'push':
      return cmdPush(rest)
    default:
      throw new UsageError(
        'vos asset <rename|push> — rename one of your assets, or push files onto the shelf (vos asset push <file...> [--folder <slug>])',
      )
  }
}
