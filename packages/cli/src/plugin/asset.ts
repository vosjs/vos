/**
 * `vos asset` — the work verbs on individual assets. Deliberately
 * NOT a folder verb: folders are shelf structure (the human's, add-only),
 * assets are WORK — and renaming your own work is an ordinary edit.
 *
 *   vos asset rename <assetId> <newname.ext> [--json]
 *   vos asset push <file...> [--folder <folderId|slug>] [--json]
 *   vos asset import <url> [--name <file>] [--folder <slug>]
 *                          [--license <text>] [--attribution <text>] [--json]
 *   vos assets ls [--kind <kind>] [--folder <slug>] [--q <text>]
 *                 [--sort recent|size|name] [--limit <n>] [--json]
 *   vos assets usage [--json]
 *   vos assets why <assetId> [--json]
 *
 * `vos assets` and `vos asset` are one verb: the plural reads better for
 * the three that look at the collection.
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
import {
  alignRows,
  bytesWords,
  listRow,
  manifestLine,
  nameFromUrl,
  probeLine,
} from './assetWords'
import { hostedFile } from './assetWords'
import type { HostedFile } from './assetWords'
import { uploadAsset } from './uploadAsset'
import { UsageError, numFlag, parseArgs, strFlag } from './args'
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
    ref: string
    size: number
    duration?: number
    metadata?: Record<string, unknown>
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
      ref: put.ref,
      size: put.size,
      ...(put.duration ? { duration: put.duration } : {}),
      ...(put.metadata ? { metadata: put.metadata } : {}),
      ...(put.reused ? { reused: true as const } : {}),
      ...(put.notes.length ? { notes: put.notes } : {}),
    })
    const hosted = {
      id: put.id,
      kind: put.kind,
      filename: stored,
      size: put.size,
      duration: put.duration,
      metadata: put.metadata,
    }
    r.log(
      `uploaded ${stored}${put.reused ? ' — already yours, nothing sent' : ''}`,
    )
    // What the platform read, the two ways to name the file, and the line
    // that declares it in a program's "assets".
    r.log(`  ${probeLine(hosted)}, ${bytesWords(put.size)}`)
    r.log(`  ${put.ref}   ${put.url}`)
    r.log(`  ${manifestLine(hosted)}`)
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

/** A bytes cap for one imported file: it is held in memory to be sent. */
const IMPORT_MAX_BYTES = 512 * 1024 * 1024

/**
 * Bring a file in from an address, with where it came from kept beside it.
 * The CLI fetches it (so it is this machine's network, never the
 * platform's, that reaches the address) and sends it through the upload
 * door like any other file.
 */
async function cmdImport(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const [url] = positionals
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new UsageError(
      'vos asset import <http(s) url> [--name <file>] [--folder <slug>] [--license <text>] [--attribution <text>]',
    )
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

  r.log(`fetching ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok)
    throw new Error(`import ${url}: the address answered ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > IMPORT_MAX_BYTES) {
    throw new Error(
      `import ${url}: ${bytesWords(declared)} is over the ${bytesWords(IMPORT_MAX_BYTES)} an import carries. Download it and use vos asset push`,
    )
  }
  const body = new Uint8Array(await res.arrayBuffer())
  if (body.length > IMPORT_MAX_BYTES) {
    throw new Error(
      `import ${url}: ${bytesWords(body.length)} is over the ${bytesWords(IMPORT_MAX_BYTES)} an import carries. Download it and use vos asset push`,
    )
  }
  const name = strFlag(flags, 'name') ?? nameFromUrl(res.url || url)
  const license = strFlag(flags, 'license')
  const attribution = strFlag(flags, 'attribution')
  let put
  try {
    put = await uploadAsset({ origin, key }, body, {
      filename: name,
      contentHash: createHash('sha256').update(body).digest('hex'),
      intent: 'library',
      ...(folder ? { folderId: folder.id } : {}),
      provenance: {
        sourceUrl: res.url || url,
        ...(license ? { license } : {}),
        ...(attribution ? { attribution } : {}),
      },
    })
  } catch (e) {
    throw new Error(
      `import ${name}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const hosted = {
    id: put.id,
    kind: put.kind,
    filename: put.filename || name,
    size: put.size,
    duration: put.duration,
    metadata: put.metadata,
  }
  if (!license) {
    r.log(
      'note: no --license was given. Say what lets you use this file, so the next person can tell',
    )
  }
  r.done(
    {
      id: put.id,
      filename: hosted.filename,
      kind: put.kind,
      url: put.url,
      ref: put.ref,
      size: put.size,
      sourceUrl: res.url || url,
      ...(license ? { license } : {}),
      ...(attribution ? { attribution } : {}),
      ...(put.reused ? { reused: true } : {}),
      ...(put.notes.length ? { notes: put.notes } : {}),
      folder: folder?.slug ?? null,
    },
    `imported ${hosted.filename}${put.reused ? ' — already yours, nothing sent' : ''}\n  ${probeLine(hosted)}, ${bytesWords(put.size)}\n  ${put.ref}   ${put.url}\n  ${manifestLine(hosted)}`,
  )
  return EXIT_OK
}

async function cmdList(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))
  const params = new URLSearchParams({
    limit: String(Math.min(200, Math.max(1, numFlag(flags, 'limit', 50)))),
  })
  for (const name of ['kind', 'q', 'sort', 'scope']) {
    const value = strFlag(flags, name)
    if (value) params.set(name, value)
  }
  const folderRef = strFlag(flags, 'folder')
  if (folderRef) {
    params.set(
      'folder',
      folderRef === 'none'
        ? 'none'
        : resolveFolder(await listFolders(origin, key), folderRef).id,
    )
  }
  const res = await apiJson(origin, `/api/assets?${params}`, { key })
  if (res.status !== 200) throw new Error(apiError('list assets', res))
  const assets = ((res.body.assets ?? []) as unknown[]).map(hostedFile)
  const total =
    typeof res.body.total === 'number' ? res.body.total : assets.length
  r.done(
    { assets, total, kinds: res.body.kinds ?? {} },
    assets.length === 0
      ? 'no files'
      : `${alignRows(assets.map(listRow)).join('\n')}\n${assets.length} of ${total} file${total === 1 ? '' : 's'}${
          total > assets.length ? ' (--limit for more, --q to search)' : ''
        }`,
  )
  return EXIT_OK
}

async function cmdUsage(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))
  const res = await apiJson(origin, '/api/user/usage', { key })
  if (res.status !== 200) throw new Error(apiError('read usage', res))
  const usage = (res.body.usage ?? {}) as Record<string, unknown>
  const limits = (res.body.limits ?? {}) as Record<string, unknown>
  const held = Number(usage.assetBytes ?? 0)
  const trash = Number(usage.trashBytes ?? 0)
  const limit = Number(limits.storageBytes ?? 0)
  const today = (usage.uploadsToday ?? {}) as Record<string, number>
  const perKind = (limits.uploadKinds ?? {}) as Record<
    string,
    { perDay?: number }
  >
  const rates = Object.entries(today)
    .filter(([kind]) => perKind[kind]?.perDay)
    .map(([kind, n]) => `${kind} ${n} of ${perKind[kind].perDay}`)
  r.done(
    { plan: res.body.plan, usage, limits },
    `${bytesWords(held)} of ${bytesWords(limit)} used` +
      (trash > 0
        ? `, ${bytesWords(trash)} of it in Trash (a person empties Trash at vos.so/app/trash; deleting more frees nothing)`
        : '') +
      (rates.length ? `\nuploaded in the last 24 h: ${rates.join(', ')}` : ''),
  )
  return EXIT_OK
}

async function cmdWhy(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const [assetId] = positionals
  if (!assetId) throw new UsageError('vos assets why <assetId>')
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))
  const res = await apiJson(origin, `/api/assets/${assetId}`, { key })
  if (res.status !== 200) throw new Error(apiError(`read ${assetId}`, res))
  const asset = hostedFile(res.body.asset) as HostedFile & {
    removedAt?: string
    removedReason?: string
  }
  const usedIn = (res.body.usedIn ?? []) as {
    vosId: string
    title: string
    head?: boolean
    versions?: number
    draft?: boolean
    trashed?: boolean
  }[]
  const how = (u: (typeof usedIn)[number]) =>
    [
      u.head ? 'in what plays now' : '',
      u.versions ? `${u.versions} version${u.versions === 1 ? '' : 's'}` : '',
      u.draft ? 'an unsaved draft' : '',
      u.trashed ? 'in Trash' : '',
    ]
      .filter(Boolean)
      .join(', ')
  const lines = [
    `${asset.filename}  ${probeLine(asset)}, ${bytesWords(asset.size)}`,
    asset.removedAt
      ? `removed from vos.so: ${asset.removedReason ?? 'no reason given'}`
      : usedIn.length === 0
        ? asset.intent === 'attached'
          ? 'nothing uses it: an attached file that stays unused is collected after 7 days'
          : 'nothing uses it: it stays because it is in your library'
        : `used by ${usedIn.length}:`,
    ...usedIn.map((u) => `  ${u.vosId}  ${u.title || 'Untitled'}  (${how(u)})`),
  ]
  r.done({ asset, usedIn }, lines.join('\n'))
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
    case 'import':
      return cmdImport(rest)
    case 'ls':
    case 'list':
      return cmdList(rest)
    case 'usage':
      return cmdUsage(rest)
    case 'why':
      return cmdWhy(rest)
    default:
      throw new UsageError(
        'vos asset <push|import|rename> | vos assets <ls|usage|why> — add files to your library, or see what is in it (vos asset push <file...> [--folder <slug>])',
      )
  }
}
