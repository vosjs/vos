/**
 * Program-path platform verbs — fetch / push / pull for config.json programs,
 * plus `vos login`. Moved here from @vosjs/cli under the CLI boundary (the MIT
 * host owns engine verbs only; every vos.so verb lives in this package).
 *
 * Full local validation stays the host's `vos check` (the one home of the
 * check pipeline); push runs a preflight (migrate → schema → function syntax,
 * all MIT @vosjs/core) so an obviously broken config never burns a request.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { basename, dirname, join } from 'node:path'
import {
  CURRENT_CONFIG_VERSION,
  migrateConfig,
  vosConfigJsonSchema,
} from '@vosjs/core'
import { migrateHostedDoc } from '@vosjs/studio-core'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_OK, createReporter } from './output'
import { LoginUnsupportedError, browserLogin } from './login'
import {
  apiError,
  apiJson,
  clientId,
  deriveSlug,
  formatChanges,
  parseVosId,
  platformOrigin,
  readSyncState,
  requireCredential,
  resolveCredential,
  writeCredential,
  writeSyncState,
} from './platform'
import { listFolders, resolveFolder } from './folder'
import { pullMedia } from './media'
import { lintDoc } from './validateDoc'
import type { ProjectDoc } from '@vosjs/studio-core'
import type { VersionChange } from './platform'
import type { Reporter } from './output'

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'media',
  'check',
  'yes',
  'claimable',
  'no-browser',
])
const MULTI_FLAGS = new Set(['override'])

interface Preflight {
  ok: boolean
  issues: string[]
  /** The migrated config (params/presets untouched) — what a push sends. */
  config: Record<string, unknown> | null
}

/** Envelope unwrap → migrate → schema → function-string syntax. */
export function preflightConfig(parsed: unknown): Preflight {
  const issues: string[] = []
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, issues: ['not a JSON object'], config: null }
  }
  let obj = parsed as Record<string, unknown>
  if (
    typeof obj.config === 'object' &&
    obj.config !== null &&
    !('createTimeline' in obj)
  ) {
    obj = obj.config as Record<string, unknown>
  }
  // A push makes a config DURABLE, so it must say which schema era it was
  // written against. Migrating an absent version would stamp a guess about
  // WHEN the file was authored: a config.json can sit in a repository for
  // years, and reading it as the current schema is silent and unrecoverable.
  // Refuse here rather than send a config the server would refuse anyway.
  if (obj.version === undefined) {
    return {
      ok: false,
      issues: [
        `missing "version": a config that is pushed must say which schema it was written against. Add "version": ${CURRENT_CONFIG_VERSION}.`,
      ],
      config: null,
    }
  }
  let migrated: Record<string, unknown>
  try {
    migrated = migrateConfig(obj as never) as unknown as Record<string, unknown>
  } catch (e) {
    return {
      ok: false,
      issues: [
        `migration failed: ${e instanceof Error ? e.message : String(e)}`,
      ],
      config: null,
    }
  }
  const schema = vosConfigJsonSchema.safeParse(migrated)
  if (!schema.success) {
    for (const i of schema.error.issues.slice(0, 10)) {
      issues.push(`schema ${i.path.join('.') || '(root)'}: ${i.message}`)
    }
    return { ok: false, issues, config: null }
  }
  for (const key of [
    'setup',
    'createContent',
    'createTimeline',
    'onFrame',
  ] as const) {
    const src = migrated[key]
    if (typeof src !== 'string' || !src.length) continue
    try {
      new Function(`"use strict"; return (${src}\n)`)
    } catch (e) {
      issues.push(
        `syntax ${key}: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    config: issues.length ? null : migrated,
  }
}

/** `vos push <target>`: a .json file, or a dir holding config.json. */
export function resolveConfigPath(target: string): string {
  if (target.endsWith('.json')) return target
  const inDir = join(target, 'config.json')
  if (existsSync(inDir)) return inDir
  throw new UsageError(
    `${target} has no config.json (and is not a take — no doc.json)`,
  )
}

export async function cmdFetch(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source)
    throw new UsageError('vos fetch <vosId|watch-url> [--out dir] [--media]')
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const id = parseVosId(source)
  // Attached when present so your own private programs fetch too; public and
  // unlisted programs need no credential at all.
  const key = resolveCredential(strFlag(flags, 'key'))

  const meta = await apiJson(origin, `/api/vos/${id}`, { key })
  if (meta.status !== 200) throw new Error(apiError(`fetch vos ${id}`, meta))
  const vosMeta = (meta.body.vos ?? {}) as Record<string, unknown>
  // The metadata route resolves slugs; byte routes want the canonical id.
  const vosId = typeof vosMeta.id === 'string' && vosMeta.id ? vosMeta.id : id
  const cfg = await apiJson(origin, `/api/vos/${vosId}/config`, { key })
  if (cfg.status !== 200)
    throw new Error(apiError(`fetch config for ${vosId}`, cfg))

  const slug =
    typeof vosMeta.slug === 'string' && vosMeta.slug ? vosMeta.slug : vosId
  const out = strFlag(flags, 'out') ?? slug
  await mkdir(out, { recursive: true })
  // The config is written EXACTLY as stored (params/presets included) — this
  // file round-trips back through `vos push`.
  await writeFile(
    join(out, 'config.json'),
    JSON.stringify(cfg.body.config, null, 2),
  )
  const title = typeof vosMeta.title === 'string' ? vosMeta.title : ''
  const head =
    typeof vosMeta.currentVersionId === 'string'
      ? vosMeta.currentVersionId
      : null
  writeSyncState(out, {
    vosId,
    versionId: head,
    ...(title ? { title } : {}),
    slug,
  })

  // A TAKE vos carries a doc beside its program: write it (and, with
  // --media, bring the footage home) so the directory is a take directory.
  let take = false
  let mediaLine = ''
  if (head) {
    const doc = await apiJson(
      origin,
      `/api/vos/${vosId}/versions/${head}/doc`,
      {
        key,
      },
    )
    if (doc.status === 200 && !('source' in doc.body)) {
      // A PROGRAM document: the user's config is the doc's own; the
      // stored config is the composed one (what plays), so config.json is
      // written from the doc and doc.json omits it.
      const hosted = migrateHostedDoc(doc.body)
      const { config: own } = await writeProgramDoc(out, hosted)
      if (own) {
        await writeFile(join(out, 'config.json'), JSON.stringify(own, null, 2))
      }
    } else if (doc.status === 200) {
      take = true
      const hosted = migrateHostedDoc(doc.body) as unknown as ProjectDoc
      await writeFile(join(out, 'doc.json'), JSON.stringify(hosted, null, 2))
      if (flags.media === true) {
        const media = await pullMedia({ origin, key }, out, hosted, r.log)
        mediaLine = media.downloaded.length
          ? ` + ${media.downloaded.map((m) => m.file).join(', ')}`
          : ''
      }
    }
  }

  r.done(
    {
      out,
      id: vosId,
      slug,
      title,
      currentVersionId: head,
      take,
    },
    take
      ? `Wrote ${out}/doc.json + config.json + vos.json${mediaLine} (${title || id}, a take)\n` +
          (flags.media === true
            ? `Then: vos digest ${out} — look before you cut; edit doc.json; vos validate ${out}; vos push ${out}`
            : `Add --media to bring the recording home (digest/frames/render need it); then edit doc.json and vos push ${out}`)
      : `Wrote ${out}/config.json + vos.json (${title || id})\n` +
          `Edit config.json, then: vos check ${out}/config.json && vos push ${out}/config.json`,
  )
  return EXIT_OK
}

/**
 * `vos duplicate <vosId|watch-url>` — a private sibling of YOUR OWN vos.
 * Head only, same folder, named "Copy of <title>" by the SERVER so
 * the shelf and the CLI can never disagree about what a copy is called.
 *
 * Someone else's work is REMIXED, not duplicated: fetch it and push with
 * `--remix-of`. The route answers 403 saying exactly that.
 */
export async function cmdDuplicate(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const source = positionals[0]
  if (!source) throw new UsageError('vos duplicate <vosId|watch-url> [--json]')
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const id = parseVosId(source)
  const key = resolveCredential(strFlag(flags, 'key'))

  const res = await apiJson(origin, `/api/vos/${id}/duplicate`, {
    method: 'POST',
    key,
  })
  if (res.status !== 201) throw new Error(apiError(`duplicate ${id}`, res))
  const created = (res.body.vos ?? {}) as Record<string, unknown>
  const newId = String(created.id ?? '')
  const title = typeof created.title === 'string' ? created.title : ''
  const slug = typeof created.slug === 'string' ? created.slug : newId

  r.done(
    {
      id: newId,
      title,
      slug,
      remixedFromId: id,
      currentVersionId: created.currentVersionId ?? null,
    },
    `Duplicated as "${title}" (private, beside the original)\n` +
      `  edit  ${origin}/studio?vos=${newId}\n` +
      `  fetch vos fetch ${newId}`,
  )
  return EXIT_OK
}

/**
 * THE program-create call — the one implementation behind `vos push` for a
 * new vos (and any in-repo script that creates programs). Creates a PRIVATE
 * vos, retrying the slug on collision (unless the caller chose it). No
 * sync-state side effects: tracking is the CLI verb's concern, not the
 * create's.
 */
export interface CreateProgramOptions {
  origin: string
  key: string
  config: Record<string, unknown>
  title: string
  /** Caller-chosen slug (no retry on collision); absent = derived + retried. */
  slug?: string
  description?: string
  tags?: string[]
  folderId?: string
  remixOfId?: string
  /** Attribution on v1: what you did and why — the first turn. */
  label?: string
  note?: string
  log?: (msg: string) => void
}

export interface CreateProgramResult {
  id: string
  slug: string
  currentVersionId: string | null
}

export async function createProgramVos(
  opts: CreateProgramOptions,
): Promise<CreateProgramResult> {
  const title = opts.title.slice(0, 100)
  const slugGiven = opts.slug !== undefined
  const baseSlug = opts.slug ?? deriveSlug(title)
  for (let attempt = 0; ; attempt++) {
    const slug =
      attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`.slice(0, 50)
    const body: Record<string, unknown> = {
      title,
      slug,
      visibility: 'private',
      config: opts.config,
      client: clientId(),
    }
    if (opts.description) body.description = opts.description
    if (opts.tags?.length) body.tags = opts.tags
    if (opts.folderId) body.folderId = opts.folderId
    if (opts.remixOfId) body.remixOfId = opts.remixOfId
    if (opts.label) body.label = opts.label
    if (opts.note) body.note = opts.note
    const res = await apiJson(opts.origin, '/api/vos', {
      method: 'POST',
      key: opts.key,
      body,
    })
    if (res.status === 409 && !slugGiven && attempt < 3) {
      opts.log?.(`slug "${slug}" is taken — retrying`)
      continue
    }
    if (res.status !== 201) throw new Error(apiError('push vos', res))
    const created = (res.body.vos ?? {}) as Record<string, unknown>
    return {
      id: String(created.id ?? ''),
      slug: typeof created.slug === 'string' ? created.slug : slug,
      currentVersionId:
        typeof created.currentVersionId === 'string'
          ? created.currentVersionId
          : null,
    }
  }
}

export async function cmdPushProgram(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const target = positionals[0]
  if (!target) {
    throw new UsageError(
      'vos push <config.json|take> [--vos id] [--title t] [--slug s] [--desc d] [--tags a,b] [--folder <id|slug>] [--remix-of id] [--note n] [--label l] [--base versionId] [--override id]...',
    )
  }
  const source = resolveConfigPath(target)
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const dir = dirname(source)

  const parsed = JSON.parse(await readFile(source, 'utf8')) as unknown
  const pre = preflightConfig(parsed)
  if (!pre.ok || !pre.config) {
    for (const issue of pre.issues) r.log(`error ${issue}`)
    throw new Error(
      `config does not validate — full report: vos check ${source}`,
    )
  }
  const config = pre.config
  const state = readSyncState(dir)
  const vosFlag = strFlag(flags, 'vos')
  const vosId = vosFlag ? parseVosId(vosFlag) : null
  // A program document beside the config: the shared layers, the tween
  // overlay, the anchor's own length. Lint-gated like a take's doc.
  const programDoc = await readProgramDoc(dir, config)
  if (programDoc) {
    const lint = lintDoc(programDoc as never)
    if (lint.problems.length) {
      throw new Error(`doc.json fails lint:\n  ${lint.problems.join('\n  ')}`)
    }
    for (const w of lint.warnings) r.log(`warning doc.json: ${w}`)
  }

  // --claimable: the credential-free rung. Creates a NEW claimable vos (72h
  // claim link, programs only) — no key resolved, no vos.json written (the
  // agent cannot iterate an unclaimed vos; after the human claims it, the
  // loop rides THEIR key). One-shot by design.
  if (flags.claimable === true) {
    if (vosId) {
      throw new UsageError(
        '--claimable creates a NEW claimable vos and cannot iterate (--vos). After the human claims it, iterate with their key: vos push --vos <id>',
      )
    }
    const fallback = state?.title
      ? `${state.title} remix`
      : basename(source).replace(/\.json$/i, '') || 'vos program'
    const title = (strFlag(flags, 'title') ?? fallback).slice(0, 100)
    const body: Record<string, unknown> = { title, config }
    const slug = strFlag(flags, 'slug')
    if (slug) body.slug = slug
    const res = await apiJson(origin, '/api/claim', { method: 'POST', body })
    if (res.status !== 201) throw new Error(apiError('claimable push', res))
    const claimUrl = String(res.body.claimUrl ?? '')
    const expiresAt = String(res.body.expiresAt ?? '')
    const created = (res.body.vos ?? {}) as Record<string, unknown>
    r.done(
      { id: created.id ?? null, title, claimUrl, expiresAt },
      `Claimable push created (${title})\n` +
        `  claim:   ${claimUrl}\n` +
        `  expires: ${expiresAt} — unclaimed work is deleted after 72h\n` +
        `Hand the claim link to the user and NOWHERE else — it is the only\n` +
        `reference and the only credential. After they claim it, iterate\n` +
        `with their key: vos push ${source} --vos ${String(created.id ?? '<id>')}`,
    )
    return EXIT_OK
  }

  const key = requireCredential(strFlag(flags, 'key'))
  // Accept both the repeatable --override id and the legacy --overrides id,id.
  // multi's index access is typed present but runtime-optional — hence the cast.
  const overrides = [
    ...((multi.override as string[] | undefined) ?? []),
    ...(strFlag(flags, 'overrides')?.split(',') ?? []),
  ]
    .map((s) => s.trim())
    .filter(Boolean)

  const desc = strFlag(flags, 'desc')
  const tagsFlag = strFlag(flags, 'tags')
  const folderRef = strFlag(flags, 'folder')
  if (vosId && (desc || tagsFlag || folderRef)) {
    throw new UsageError(
      '--desc/--tags/--folder apply when CREATING a vos. On an existing one: vos folder move <id> --to <folder> for filing; edit title/description/tags on vos.so',
    )
  }

  if (vosId) {
    // Iterate an existing vos: add a version. --base names the version this
    // edit was made FROM (defaulting to the tracked base in vos.json, so a
    // fetch→edit→push loop gets stale detection for free); --overrides
    // consents to touching protected (human-edited) nodes — ONLY when the
    // user asked for that change.
    const trackedBase =
      state && state.vosId === vosId && state.versionId
        ? state.versionId
        : undefined
    const body: Record<string, unknown> = { config, client: clientId() }
    if (programDoc) body.doc = programDoc
    const base = strFlag(flags, 'base') ?? trackedBase
    if (base) body.baseVersionId = base
    const note = strFlag(flags, 'note')
    if (note) body.note = note
    const label = strFlag(flags, 'label')
    if (label) body.label = label
    if (overrides.length) body.overrides = overrides
    const res = await apiJson(origin, `/api/vos/${vosId}/versions`, {
      method: 'POST',
      key,
      body,
    })
    if (res.status === 409) {
      // The correction path is the data path: both 409 shapes carry what to
      // read. stale_base embeds the changes made on the platform since your
      // base; protected_conflict lists the human-touched nodes you'd clobber.
      const changes = Array.isArray(res.body.changes)
        ? (res.body.changes as VersionChange[])
        : []
      for (const line of formatChanges(changes)) r.log(`platform: ${line}`)
      const protectedIds = Array.isArray(res.body.protected)
        ? res.body.protected
        : []
      const nodes = Array.isArray(res.body.nodes) ? res.body.nodes : []
      r.event({
        event: 'conflict',
        reason: res.body.error ?? 'conflict',
        changes,
        protected: protectedIds,
        nodes,
      })
      if (res.body.error === 'protected_conflict') {
        throw new Error(
          `push touches human-edited nodes: ${nodes.join(', ')} — keep the human's values, ` +
            `or re-push with --overrides ${nodes.join(',')} ONLY if the user asked for this change`,
        )
      }
      throw new Error(
        `version base is stale — the platform copy changed (${changes.length} edit${changes.length === 1 ? 's' : ''} above). ` +
          `Run: vos pull ${dir} — then re-apply your edit and push again`,
      )
    }
    if (res.status !== 201)
      throw new Error(apiError(`push version to ${vosId}`, res))
    const version = (res.body.version ?? {}) as Record<string, unknown>
    // Track what we just made: the new version is the next push's base.
    if (typeof version.id === 'string') {
      writeSyncState(dir, { vosId, versionId: version.id })
    }
    const watchUrl = `${origin}/vos/${vosId}`
    const studioUrl = `${origin}/studio?vos=${vosId}`
    r.done(
      {
        id: vosId,
        versionId: version.id ?? null,
        versionNumber: version.versionNumber ?? null,
        base: base ?? null,
        watchUrl,
        studioUrl,
      },
      `Pushed version ${String(version.versionNumber ?? '?')} of ${vosId}\n` +
        `  watch:  ${watchUrl}\n  studio: ${studioUrl}`,
    )
    return EXIT_OK
  }

  // Create a new PRIVATE vos. Lineage comes from vos.json (written by
  // `vos fetch` beside the config) or --remix-of; the platform validates it.
  const remixOfId = strFlag(flags, 'remix-of') ?? state?.vosId
  const fallbackTitle = state?.title
    ? `${state.title} remix`
    : basename(source).replace(/\.json$/i, '') || 'vos remix'
  const title = (strFlag(flags, 'title') ?? fallbackTitle).slice(0, 100)
  const folderId = folderRef
    ? resolveFolder(await listFolders(origin, key), folderRef).id
    : undefined

  const created = await createProgramVos({
    origin,
    key,
    config,
    title,
    slug: strFlag(flags, 'slug'),
    description: desc,
    tags: tagsFlag
      ?.split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    folderId,
    remixOfId,
    label: strFlag(flags, 'label'),
    note: strFlag(flags, 'note'),
    log: (msg) => r.log(msg),
  })
  // The directory now TRACKS the created vos (its source stays as
  // remixOfId) — the next push/pull needs no flags.
  writeSyncState(dir, {
    vosId: created.id,
    versionId: created.currentVersionId,
    title,
    slug: created.slug,
    ...(remixOfId ? { remixOfId } : {}),
  })
  const watchUrl = `${origin}/vos/${created.id}`
  const studioUrl = `${origin}/studio?vos=${created.id}`
  r.done(
    {
      id: created.id,
      slug: created.slug,
      title,
      visibility: 'private',
      remixOfId: remixOfId ?? null,
      currentVersionId: created.currentVersionId,
      watchUrl,
      studioUrl,
    },
    `Created private vos ${created.id} (${title})\n` +
      `  watch:  ${watchUrl}\n  studio: ${studioUrl}\n` +
      `Iterate with: vos push ${source} --vos ${created.id}`,
  )
  return EXIT_OK
}

export async function cmdPullProgram(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  // Positional: the tracked directory or its config.json (default cwd).
  const target = positionals[0] ?? '.'
  const dir = target.endsWith('.json') ? dirname(target) : target
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })

  const state = readSyncState(dir)
  const vosFlag = strFlag(flags, 'vos')
  const vosId = vosFlag ? parseVosId(vosFlag) : (state?.vosId ?? null)
  if (!vosId) {
    throw new UsageError(
      `no tracked vos in ${dir}/vos.json — pass --vos <id>, or fetch/push first`,
    )
  }
  const since = strFlag(flags, 'since') ?? state?.versionId ?? null
  if (!since) {
    throw new UsageError(
      `no base version in ${dir}/vos.json — pass --since <versionId>`,
    )
  }
  // The changelog walk is owner-only (edits on private work).
  const key = requireCredential(strFlag(flags, 'key'))

  const res = await apiJson(
    origin,
    `/api/vos/${vosId}/changes?since=${encodeURIComponent(since)}`,
    { key },
  )
  if (res.status !== 200)
    throw new Error(apiError(`pull changes for ${vosId}`, res))

  const head = (res.body.head ?? {}) as Record<string, unknown>
  const changes = Array.isArray(res.body.changes)
    ? (res.body.changes as VersionChange[])
    : []
  const protectedIds = Array.isArray(res.body.protected)
    ? (res.body.protected as string[])
    : []

  if (changes.length === 0) {
    r.done(
      { id: vosId, upToDate: true, head: head.id ?? since },
      `${vosId}: up to date (base ${since.slice(0, 8)}… is the head)`,
    )
    return EXIT_OK
  }

  for (const line of formatChanges(changes)) r.log(line)
  if (protectedIds.length) {
    r.log(
      `protected (human-edited — keep their values unless asked): ${protectedIds.join(', ')}`,
    )
  }
  if (res.body.truncated === true) {
    r.log('walk truncated — more versions exist; pull again after syncing')
  }

  if (flags.check === true) {
    r.done(
      {
        id: vosId,
        upToDate: false,
        versions: changes.length,
        head: head.id ?? null,
        protected: protectedIds,
        changes,
      },
      `${changes.length} version${changes.length === 1 ? '' : 's'} behind — run without --check to sync`,
    )
    return EXIT_OK
  }

  // Sync: the head config replaces config.json (the old file is kept as
  // config.backup.json), and vos.json repoints so the next push has the fresh
  // base. Your uncommitted local edits live in the backup — re-apply on top.
  const cfg = await apiJson(origin, `/api/vos/${vosId}/config`, { key })
  if (cfg.status !== 200)
    throw new Error(apiError(`fetch head config for ${vosId}`, cfg))
  const configPath = join(dir, 'config.json')
  let backedUp = false
  if (existsSync(configPath)) {
    await writeFile(join(dir, 'config.backup.json'), await readFile(configPath))
    backedUp = true
  }
  // A program DOCUMENT on the head: the user's config is the doc's
  // own (the stored config is the composed one), and doc.json comes home
  // beside it without that config.
  let headConfig = cfg.body.config as Record<string, unknown>
  const headId = typeof head.id === 'string' ? head.id : null
  if (headId) {
    const docRes = await apiJson(
      origin,
      `/api/vos/${vosId}/versions/${headId}/doc`,
      { key },
    )
    if (docRes.status === 200 && !('source' in docRes.body)) {
      const { config: own } = await writeProgramDoc(
        dir,
        migrateHostedDoc(docRes.body),
      )
      if (own) headConfig = own
    }
  }
  await writeFile(configPath, JSON.stringify(headConfig, null, 2))
  writeSyncState(dir, {
    vosId,
    versionId: typeof head.id === 'string' ? head.id : since,
  })

  r.done(
    {
      id: vosId,
      upToDate: false,
      versions: changes.length,
      head: head.id ?? null,
      protected: protectedIds,
      changes,
      out: configPath,
      backup: backedUp ? join(dir, 'config.backup.json') : null,
    },
    `Pulled ${changes.length} version${changes.length === 1 ? '' : 's'} → ${configPath}` +
      (backedUp ? ` (previous copy: config.backup.json)` : '') +
      `\nRe-apply your edit on the new head, then: vos push ${configPath} --vos ${vosId}`,
  )
  return EXIT_OK
}

export async function cmdLogin(argv: string[]): Promise<number> {
  const { flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })

  // The paste ladder keeps its lanes: an explicit --key (or a VOS_API_KEY
  // already in the env) validates and stores without any browser.
  const explicit = strFlag(flags, 'key') ?? process.env.VOS_API_KEY?.trim()
  if (explicit) return storeKey(explicit, origin, r)

  // Default: the browser device flow. Works TTY-less by design — that is
  // the agent path (print URL + code, the human approves, the poll lands).
  try {
    const openBrowser =
      process.stdout.isTTY === true &&
      !process.env.SSH_CONNECTION &&
      !process.env.SSH_TTY &&
      flags.json !== true &&
      flags['no-browser'] !== true
    const { path, user } = await browserLogin(origin, r, {
      label: strFlag(flags, 'label'),
      openBrowser,
    })
    r.done(
      { path, origin, user },
      `Signed in${user ? ` as ${user}` : ''} — key stored at ${path} (used by every vos platform verb)`,
    )
    return EXIT_OK
  } catch (e) {
    if (!(e instanceof LoginUnsupportedError)) throw e
  }

  // Older origin without the device flow — the pre-device-flow paste prompt.
  if (!process.stdin.isTTY) {
    throw new UsageError(
      'vos login --key <vos_sk_…> (headless), or run interactively — mint a key at https://vos.so/app/api',
    )
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const key = (
    await rl.question(`Paste a content key from ${origin}/app/api: `)
  ).trim()
  rl.close()
  if (!key) throw new UsageError('no key given')
  return storeKey(key, origin, r)
}

/** Validate (cheapest key-readable read) and store a pasted/env key. */
async function storeKey(
  key: string,
  origin: string,
  r: Reporter,
): Promise<number> {
  const probe = await apiJson(origin, '/api/folders', { key })
  if (probe.status === 401 || probe.status === 403) {
    throw new Error(apiError('validate key', probe))
  }
  const path = writeCredential(key)
  r.done(
    { path, origin },
    `Signed in — key stored at ${path} (used by every vos platform verb)`,
  )
  return EXIT_OK
}

/**
 * A directory is a TAKE when its doc.json is a RECORDING document (it carries
 * `source`) — the deterministic sniff. A program directory may carry a
 * doc.json too (a program document, `program` + the shared layers,
 * with config.json as its config); that is a program push.
 */
export function isTakeDir(target: string): boolean {
  try {
    if (!statSync(target).isDirectory()) return false
    const docPath = join(target, 'doc.json')
    if (!existsSync(docPath)) return false
    try {
      const doc: unknown = JSON.parse(readFileSync(docPath, 'utf8'))
      return typeof doc === 'object' && doc !== null && 'source' in doc
    } catch {
      return true // unparsable: leave it to the take path's own error
    }
  } catch {
    return false
  }
}

/**
 * The program document beside a config.json, if any: doc.json without
 * `source`. On disk it omits `program.config` (config.json IS the config);
 * on the wire it carries it. Returns the doc as pushed (config attached) or
 * null when the directory has none.
 */
export async function readProgramDoc(
  dir: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const docPath = join(dir, 'doc.json')
  if (!existsSync(docPath)) return null
  const parsed: unknown = JSON.parse(await readFile(docPath, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || 'source' in parsed)
    return null
  const raw = parsed as Record<string, unknown>
  const program =
    raw.program && typeof raw.program === 'object'
      ? (raw.program as Record<string, unknown>)
      : {}
  return { ...raw, program: { ...program, config } }
}

/** Write a hosted program document to disk: config.json + doc.json sans config. */
export async function writeProgramDoc(
  dir: string,
  hosted: Record<string, unknown>,
): Promise<{ config: Record<string, unknown> | null }> {
  const program =
    hosted.program && typeof hosted.program === 'object'
      ? (hosted.program as Record<string, unknown>)
      : {}
  const { config, ...rest } = program
  const onDisk = { ...hosted, program: rest }
  await writeFile(join(dir, 'doc.json'), JSON.stringify(onDisk, null, 2))
  return {
    config:
      config && typeof config === 'object'
        ? (config as Record<string, unknown>)
        : null,
  }
}
