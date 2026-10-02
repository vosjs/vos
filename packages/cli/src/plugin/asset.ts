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
 * push sends each file through the platform's one upload door (declare,
 * parts, seal), filed as a library file: models, pictures and SVGs, fonts,
 * HDR maps, sound, video, captions and recipes (though `vos recipe push`
 * is the recipe verb, with replace-in-place). The platform reads what it
 * stores, so the kind and the stored name come back from it, and a file it
 * has no use for is refused in words before anything is sent
 * (`GET /api/limits` lists the kinds and their caps). The same bytes pushed
 * twice are the same file. Files upload one by one and a refusal names the
 * file it stopped on, so a partial push is legible, never silent.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { MEDIA_HEAD_BYTES, nameForType, resolveMediaType } from './container'
import { uploadAsset } from './uploadAsset'
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

  // What the platform answered per file, in the result as well as the log:
  // a caller reading JSON (an agent) must not lose the note that an SVG's
  // scripts were removed, or that the file was already there.
  const uploaded: {
    id: string
    filename: string
    kind: string
    url: string
    reused?: true
    notes?: string[]
  }[] = []
  for (const file of positionals) {
    const name = basename(file)
    const body = readFileSync(file)
    // Sound and video are typed by their bytes here too, so a clip is sent
    // under the name its container earns. Everything else goes as it is
    // named, and the platform answers what it turned out to be.
    const media = resolveMediaType({
      head: body.subarray(0, MEDIA_HEAD_BYTES),
      filename: name,
    })
    const isMedia = /^(audio|video)\//.test(media.type)
    const sent = isMedia ? nameForType(name, media.type) : name
    let put
    try {
      put = await uploadAsset({ origin, key }, new Uint8Array(body), {
        filename: sent,
        ...(isMedia ? { contentType: media.type } : {}),
        contentHash: createHash('sha256').update(body).digest('hex'),
        intent: 'library',
        ...(folder ? { folderId: folder.id } : {}),
      })
    } catch (e) {
      const landed = uploaded.length
        ? ` (${uploaded.length} of ${positionals.length} landed before it)`
        : ''
      throw new Error(
        `push ${name}${landed}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    const stored = put.filename || sent
    uploaded.push({
      id: put.id,
      filename: stored,
      kind: put.kind,
      url: put.url,
      ...(put.reused ? { reused: true as const } : {}),
      ...(put.notes.length ? { notes: put.notes } : {}),
    })
    r.log(
      `uploaded ${stored} (${put.id})${put.reused ? ' — already on your shelf' : ''}  ${put.url}`,
    )
    for (const note of put.notes) r.log(`  note: ${note}`)
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
