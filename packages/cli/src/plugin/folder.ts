/**
 * `vos folder` — the shelf verbs: list your folders, create one, move
 * work into one, PULL one (the folder contract on disk). The additive half
 * of the shelf rule: an agent may ADD organization
 * (create a folder, file voses and assets into it) but never reshape or
 * destroy what the human made — rename/delete/reorder have no CLI verb on
 * purpose; those stay session gestures on vos.so.
 *
 *   vos folder list [--json]
 *   vos folder create <name> [--parent <folderId|slug>] [--desc <text>] [--json]
 *   vos folder move <vosId|assetId|watch-url>... --to <folderId|slug|none> [--json]
 *   vos folder pull <folderId|slug> [--out dir] [--media] [--json]
 *
 * pull writes the folder's whole context package to disk — the one step of
 * the "create in my style" flow the CLI could not do: recipes (own and
 * inherited, bodies inline) and every member's config.json (+ doc.json for
 * takes) each in a directory that TRACKS its vos, so `vos push` from any of
 * them lands as a version. One line per recipe prints what it governs and
 * where it says to start, read from the optional hints.
 *
 * move accepts vos ids AND asset ids (recipes, uploads): it tries the vos
 * first and falls back to the asset route on 404, so the caller never has
 * to say which kind an id is.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { recipeHints } from '@vosjs/shared/frontmatter'
import { migrateHostedDoc } from '@vosjs/studio-core'
import { UsageError, parseArgs, strFlag } from './args'
import { pullMedia } from './media'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'
import {
  apiError,
  apiJson,
  parseVosId,
  platformOrigin,
  requireCredential,
  writeSyncState,
} from './platform'
import type { ProjectDoc } from '@vosjs/studio-core'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'media'])

export interface FolderRow {
  id: string
  name: string
  slug: string
  parentId: string | null
  counts?: { voses?: number; recipes?: number; assets?: number }
}

export async function listFolders(
  origin: string,
  key: string,
): Promise<FolderRow[]> {
  const r = await apiJson(origin, '/api/folders', { key })
  if (r.status !== 200) throw new Error(apiError('list folders', r))
  return (r.body.folders ?? []) as FolderRow[]
}

/** Resolve a folder reference (id or slug) against the caller's own shelf. */
export function resolveFolder(rows: FolderRow[], ref: string): FolderRow {
  const hit = rows.find((f) => f.id === ref) ?? rows.find((f) => f.slug === ref)
  if (!hit) {
    const shelf = rows.map((f) => f.slug).join(', ') || '(no folders yet)'
    throw new UsageError(`no folder "${ref}" on your shelf — have: ${shelf}`)
  }
  return hit
}

function printTree(rows: FolderRow[]): void {
  const children = new Map<string | null, FolderRow[]>()
  for (const f of rows) {
    const list = children.get(f.parentId) ?? []
    list.push(f)
    children.set(f.parentId, list)
  }
  const walk = (parentId: string | null, depth: number) => {
    for (const f of children.get(parentId) ?? []) {
      const c = f.counts ?? {}
      const held = [
        c.voses ? `${c.voses} vos${c.voses === 1 ? '' : 'es'}` : '',
        c.recipes ? `${c.recipes} recipe${c.recipes === 1 ? '' : 's'}` : '',
        c.assets ? `${c.assets} asset${c.assets === 1 ? '' : 's'}` : '',
      ]
        .filter(Boolean)
        .join(', ')
      process.stdout.write(
        `${'  '.repeat(depth)}${f.name}  (${f.slug})${held ? ` — ${held}` : ''}\n`,
      )
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
}

async function cmdList(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))
  const rows = await listFolders(origin, key)
  if (r.json) {
    r.done({ folders: rows }, '')
    return EXIT_OK
  }
  if (rows.length === 0) {
    r.done({}, 'no folders yet — vos folder create <name>')
    return EXIT_OK
  }
  printTree(rows)
  return EXIT_OK
}

async function cmdCreate(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const name = positionals.join(' ').trim()
  if (!name)
    throw new UsageError(
      'vos folder create <name> [--parent <folderId|slug>] [--desc <text>]',
    )
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))

  const parentRef = strFlag(flags, 'parent')
  let parentId: string | undefined
  if (parentRef) {
    parentId = resolveFolder(await listFolders(origin, key), parentRef).id
  }

  const res = await apiJson(origin, '/api/folders', {
    method: 'POST',
    key,
    body: {
      name,
      ...(strFlag(flags, 'desc')
        ? { description: strFlag(flags, 'desc') }
        : {}),
      ...(parentId ? { parentId } : {}),
    },
  })
  if (res.status !== 201) throw new Error(apiError('create folder', res))
  const created = res.body.folder as FolderRow
  r.done(
    { id: created.id, slug: created.slug, parentId: created.parentId },
    `created ${created.name}  (${created.slug}, ${created.id})${parentRef ? ` inside ${parentRef}` : ''}`,
  )
  return EXIT_OK
}

async function cmdMove(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const toRef = strFlag(flags, 'to')
  if (positionals.length === 0 || !toRef)
    throw new UsageError(
      'vos folder move <vosId|assetId|watch-url>... --to <folderId|slug|none>',
    )
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))

  const folderId =
    toRef === 'none'
      ? null
      : resolveFolder(await listFolders(origin, key), toRef).id

  let failed = 0
  const moved: { id: string; kind: string }[] = []
  for (const raw of positionals) {
    const id = parseVosId(raw)
    // A move target is a vos or an asset; ids don't say which, so try the
    // vos first and fall back to the asset route on its 404.
    const asVos = await apiJson(origin, `/api/vos/${id}`, {
      method: 'PATCH',
      key,
      body: { folderId },
    })
    if (asVos.status === 200) {
      moved.push({ id, kind: 'vos' })
      r.log(`moved vos ${id}`)
      continue
    }
    if (asVos.status === 404) {
      const asAsset = await apiJson(origin, `/api/assets/${id}`, {
        method: 'PATCH',
        key,
        body: { folderId },
      })
      if (asAsset.status === 200) {
        moved.push({ id, kind: 'asset' })
        r.log(`moved asset ${id}`)
        continue
      }
      failed++
      r.log(apiError(`move ${id}`, asAsset))
      continue
    }
    failed++
    r.log(apiError(`move ${id}`, asVos))
  }
  r.done(
    { moved, failed, folderId },
    `moved ${moved.length}/${positionals.length} into ${toRef === 'none' ? 'the top level' : toRef}${failed ? ` — ${failed} failed` : ''}`,
  )
  return failed ? EXIT_ERROR : EXIT_OK
}

interface PullPayload {
  folder: { id: string; name: string; slug: string; description?: string }
  subfolders: { id: string; name: string; slug: string }[]
  recipes: { id: string; filename: string; body?: string }[]
  inheritedRecipes: {
    id: string
    filename: string
    body?: string
    folderSlug?: string
    folderName?: string
  }[]
  voses: {
    id: string
    title: string
    slug?: string | null
    currentVersionId?: string | null
    hasDoc?: boolean
    contentUrls?: { config?: string }
  }[]
  assets: { id: string; filename: string; category: string; fileUrl: string }[]
}

/** The one line a recipe earns in the pull summary, from its hints. */
export function recipeLine(filename: string, body: string): string {
  const h = recipeHints(body)
  const facts = [
    h.applies
      ? `applies to ${h.applies === 'any' ? 'everything' : `${h.applies}s`}`
      : '',
    h.seed ? `starts from ${h.seed}` : '',
  ].filter(Boolean)
  return `${filename}${facts.length ? `  (${facts.join(' · ')})` : ''}`
}

const safeName = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file'

async function cmdPull(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const ref = positionals[0]
  if (!ref)
    throw new UsageError(
      'vos folder pull <folderId|slug> [--out dir] [--media]',
    )
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const key = requireCredential(strFlag(flags, 'key'))
  const folder = resolveFolder(await listFolders(origin, key), ref)
  const res = await apiJson(origin, `/api/folders/${folder.id}`, { key })
  if (res.status !== 200)
    throw new Error(apiError(`pull folder ${folder.slug}`, res))
  const payload = res.body as unknown as PullPayload
  const out = strFlag(flags, 'out') ?? folder.slug
  await mkdir(join(out, 'recipes'), { recursive: true })

  const lines: string[] = []
  const recipes: { path: string; line: string }[] = []
  for (const rec of payload.recipes) {
    const path = join(out, 'recipes', safeName(rec.filename))
    await writeFile(path, rec.body ?? '')
    recipes.push({ path, line: recipeLine(rec.filename, rec.body ?? '') })
  }
  for (const rec of payload.inheritedRecipes) {
    const from = safeName(rec.folderSlug ?? 'inherited')
    await mkdir(join(out, 'recipes', '_inherited', from), { recursive: true })
    const path = join(
      out,
      'recipes',
      '_inherited',
      from,
      safeName(rec.filename),
    )
    await writeFile(path, rec.body ?? '')
    recipes.push({
      path,
      line: `${recipeLine(rec.filename, rec.body ?? '')}  [inherited from ${rec.folderName ?? from}]`,
    })
  }

  const members: { dir: string; id: string; title: string; take: boolean }[] =
    []
  for (const v of payload.voses) {
    const dir = join(out, 'members', safeName(v.slug || v.title || v.id))
    await mkdir(dir, { recursive: true })
    const cfg = await apiJson(origin, `/api/vos/${v.id}/config`, { key })
    if (cfg.status !== 200) {
      lines.push(`skipped ${v.title}: ${apiError('fetch config', cfg)}`)
      continue
    }
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify(cfg.body.config, null, 2),
    )
    let take = false
    if (v.hasDoc && v.currentVersionId) {
      const doc = await apiJson(
        origin,
        `/api/vos/${v.id}/versions/${v.currentVersionId}/doc`,
        { key },
      )
      if (doc.status === 200) {
        await writeFile(
          join(dir, 'doc.json'),
          JSON.stringify(doc.body, null, 2),
        )
        take = true
        // --media: the footage comes home beside the doc.
        if (flags.media === true) {
          const hosted = migrateHostedDoc(doc.body) as unknown as ProjectDoc
          await pullMedia({ origin, key }, dir, hosted, r.log)
        }
      }
    }
    writeSyncState(dir, {
      vosId: v.id,
      versionId: v.currentVersionId ?? null,
      title: v.title,
      ...(v.slug ? { slug: v.slug } : {}),
    })
    members.push({ dir, id: v.id, title: v.title, take })
  }

  const assets = payload.assets.filter((a) => a.category !== 'recipe')
  const summary = [
    `Pulled ${folder.name} (${folder.slug}) → ${out}/`,
    ...(folder.id && payload.folder.description
      ? [`  ${payload.folder.description}`]
      : []),
    `  recipes (${recipes.length}) — read EVERY one:`,
    ...recipes.map((x) => `    ${x.line}`),
    `  members (${members.length}):`,
    ...members.map(
      (m) => `    ${m.title}${m.take ? '  [take]' : ''}  → ${m.dir}/`,
    ),
    ...(assets.length
      ? [
          `  assets (${assets.length}): ${assets.map((a) => a.filename).join(', ')}`,
        ]
      : []),
    ...(payload.subfolders.length
      ? [
          `  subfolders (not inlined): ${payload.subfolders.map((s) => s.slug).join(', ')}`,
        ]
      : []),
    ...lines,
    `Then: vos push <file> --folder ${folder.slug} --label "…" --note "…"`,
  ].join('\n')
  r.done(
    {
      out,
      folder: payload.folder,
      recipes: recipes.map((x) => x.path),
      members,
      assets,
      subfolders: payload.subfolders,
    },
    summary,
  )
  return EXIT_OK
}

export async function cmdFolder(argv: string[]): Promise<number> {
  const sub = argv[0]
  const rest = argv.slice(1)
  switch (sub) {
    case 'list':
    case 'ls':
      return cmdList(rest)
    case 'create':
      return cmdCreate(rest)
    case 'move':
      return cmdMove(rest)
    case 'pull':
      return cmdPull(rest)
    default:
      throw new UsageError(
        'vos folder <list|create|move|pull> — list your shelf, create a folder, move voses/assets into one, pull a folder to disk',
      )
  }
}
