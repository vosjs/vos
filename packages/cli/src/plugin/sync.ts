/**
 * Push/pull — the take side of the versioned human↔agent loop.
 *
 * `vos push <take>` uploads the recording (content-addressed: same bytes
 * upload once), lowers doc.json through the real studio pipeline, and
 * creates a hosted vos/version carrying BOTH the compiled program and the
 * doc — always against the base recorded in vos.json, so a stale push
 * 409s with the human's typed changelog instead of clobbering it.
 *
 * `vos pull <take>` fetches what the human changed (the semantic diff per
 * intervening version) and writes the head's doc.json back into the take
 * dir — the local edit loop continues exactly where the human left off.
 *
 * Local-first doctrine: the first push of a take asks (TTY) or
 * requires --yes (headless). vos.json records the consent, the vos id and
 * the base version (legacy push.json still reads); delete it to unlink.
 *
 * All HTTP + credentials + state ride the ONE platform client (platform.ts).
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { basename, join } from 'node:path'
import { lowerToComposition, migrateHostedDoc } from '@vosjs/studio-core'
import { RECORDING_NAME, loadTake, takeMediaFile, writeJson } from './take'
import { lintDoc } from './validateDoc'
import { docMediaRefs, pullMedia, takeRelativeFile } from './media'
import { MEDIA_HEAD_BYTES, nameForType, resolveMediaType } from './container'
import { listFolders, resolveFolder } from './folder'
import { uploadAsset } from './uploadAsset'
import {
  apiJson,
  clientId,
  platformOrigin,
  readSyncState,
  requireCredential,
  writeSyncState,
} from './platform'
import type { UploadedAsset } from './uploadAsset'
import type { MediaPullResult } from './media'
import type { ProjectDoc } from '@vosjs/studio-core'
import type { Reporter } from './output'

export interface ApiContext {
  origin: string
  key: string
}

/** Auth + origin: flags win, then the documented ladder (platform.ts). */
export function apiContext(flags: {
  key?: string
  api?: string
  origin?: string
}): ApiContext {
  return {
    origin: platformOrigin(flags),
    key: requireCredential(flags.key),
  }
}

async function api(
  ctx: ApiContext,
  path: string,
  init?: {
    method?: string
    body?: unknown
    raw?: Uint8Array
    headers?: Record<string, string>
  },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await apiJson(ctx.origin, `/api${path}`, { ...init, key: ctx.key })
  return { status: r.status, json: r.body }
}

/**
 * A 400's zod issues, in words an agent can act on (`label: String must
 * contain at most 60 character(s)`). A bare "Invalid input" cost a real push
 * a round trip (DF1, 2026-08-25).
 */
function detailLine(body: Record<string, unknown>): string {
  const details = body.details
  if (!Array.isArray(details) || !details.length) return ''
  const lines = (details as Record<string, unknown>[]).map((d) => {
    const path = Array.isArray(d.path) ? d.path.join('.') : ''
    return `${path ? `${path}: ` : ''}${String(d.message ?? JSON.stringify(d))}`
  })
  return `\n  ${lines.join('\n  ')}`
}

/** Print a /changes payload's summaries — the human's half of the loop. */
function printChanges(
  r: Reporter,
  changes: unknown,
  protectedIds: unknown,
): void {
  if (Array.isArray(changes)) {
    for (const entry of changes as Record<string, unknown>[]) {
      const who = entry.origin === 'studio' ? 'human' : String(entry.origin)
      r.log(`  v${entry.versionNumber} (${who}): ${entry.summary}`)
      if (entry.note) r.log(`    note: ${String(entry.note)}`)
      r.event({ event: 'change', ...entry })
    }
  }
  if (Array.isArray(protectedIds) && protectedIds.length) {
    r.log(
      `  protected (human-touched, keep their values): ${(protectedIds as string[]).join(', ')}`,
    )
    r.event({ event: 'protected', nodes: protectedIds })
  }
}

/**
 * Why a take push must not start, or null. Asked BEFORE any upload: a push
 * is not something to report on afterwards.
 *
 * `--vos <id>` on a directory with no `vos.json` is ADOPTION, not a refusal
 * (see `pushTake`): the only other way to tie a directory to a vos is
 * `vos pull`, which writes the hosted doc over the local one, and the take
 * that needs `--vos` is exactly the one re-recorded from scratch.
 */
export function takePushRefusal(ask: {
  /** `--vos`, when given. */
  vos?: string
  /** The vos this directory tracks (vos.json), or null. */
  trackedVosId: string | null
  /** Flags given that only a PROGRAM push reads. */
  programOnly: string[]
}): string | null {
  if (ask.programOnly.length) {
    const list = ask.programOnly.map((f) => `--${f}`).join(', ')
    return `${list} ${ask.programOnly.length > 1 ? 'belong' : 'belongs'} to a PROGRAM push (a config.json); a take push reads --vos, --title, --label, --note, --folder, --override and --yes`
  }
  if (
    ask.vos !== undefined &&
    ask.trackedVosId !== null &&
    ask.trackedVosId !== ask.vos
  )
    return `this take tracks vos ${ask.trackedVosId} (its vos.json), not ${ask.vos}. Drop --vos to push there, or remove vos.json to adopt ${ask.vos} instead`
  return null
}

/** Where a program push lands, or why it must not start. */
export type ProgramPushTarget =
  | { kind: 'version'; vosId: string; tracked: boolean }
  | { kind: 'create'; remixOfId?: string }
  | { kind: 'refuse'; why: string }

/**
 * Where `vos push <config.json>` lands.
 *
 * A directory that TRACKS a vos ITERATES it. That is the contract's loop —
 * fetch, edit, check, push, pull, with no flags — and `vos.json` is what
 * makes the flags unnecessary. Making something NEW from the same config is
 * the explicit `--remix-of` door, which is also the one the README names for
 * remixing someone else's work.
 *
 * Reading the tracked id as LINEAGE instead is what made a bare re-push
 * create a fresh vos remixed from the last one: pushing twice in a directory
 * left a chain of "... remix remix" siblings on the shelf and edited none of
 * them.
 */
export function programPushTarget(ask: {
  /** `--vos`, when given (already parsed to an id). */
  vos?: string | null
  /** `--remix-of`, when given. */
  remixOf?: string | null
  /** The vos this directory tracks (vos.json), or null. */
  trackedVosId: string | null
  /** Create-only flags given, by name (`title`, `slug`, ...). */
  createOnly?: string[]
}): ProgramPushTarget {
  if (ask.vos) return { kind: 'version', vosId: ask.vos, tracked: false }
  // An explicit remix always creates, even in a tracked directory: saying
  // --remix-of IS the ask for a new vos.
  if (ask.remixOf) return { kind: 'create', remixOfId: ask.remixOf }
  const tracked = ask.trackedVosId
  if (!tracked) return { kind: 'create' }
  // Create-only flags against a tracked directory are ambiguous: they read
  // as "make a new one" while the directory says "iterate this one". Name
  // both doors rather than silently dropping the flag or the edit.
  const extra = ask.createOnly ?? []
  if (extra.length) {
    const list = extra.map((f) => `--${f}`).join(', ')
    return {
      kind: 'refuse',
      why:
        `this directory tracks vos ${tracked} (vos.json), so a bare push adds a VERSION to it, ` +
        `and ${list} ${extra.length > 1 ? 'apply' : 'applies'} only when creating. ` +
        `To make a separate vos from this config: vos push <config.json> --remix-of ${tracked} ${list}. ` +
        `To change the tracked vos's title or slug, edit it on vos.so`,
    }
  }
  return { kind: 'version', vosId: tracked, tracked: true }
}

export async function pushTake(
  dir: string,
  flags: {
    key?: string
    api?: string
    origin?: string
    yes?: boolean
    /** `--vos`: on an untracked take, the vos to ADOPT. */
    vos?: string
    title?: string
    label?: string
    note?: string
    folder?: string
    overrides?: string[]
  },
  r: Reporter,
): Promise<{ vosId: string; versionId: string; versionNumber: number }> {
  const take = await loadTake(dir)
  if (!take.doc) {
    throw new Error('no doc.json in this take — run `vos plan` first')
  }
  const lint = lintDoc(take.doc)
  if (lint.problems.length) {
    throw new Error(`doc.json fails lint:\n  ${lint.problems.join('\n  ')}`)
  }
  if (!existsSync(take.paths.recording)) {
    throw new Error(
      'no recording in this take — record it, or `vos pull --media` to bring it home',
    )
  }

  const ctx = apiContext(flags)
  const tracked = readSyncState(dir)
  // The first push of this DIRECTORY uploads its recording either way, so
  // consent is asked of the directory, not of the vos it lands on.
  const firstPush = tracked === null

  // ADOPTION: `--vos <id>` on a directory with no vos.json. It used to be
  // ignored, and a second vos appeared on the shelf every time a take was
  // re-recorded from scratch. Now the take becomes the NEXT VERSION of that
  // vos: its head is read here and named as the base, which is the person
  // saying "I know what is there". The platform's own guards still hold: a
  // key push touching studio-modified nodes 409s unless --override names them.
  let state = tracked
  if (!state && flags.vos) {
    const meta = await api(ctx, `/vos/${flags.vos}`)
    const head = (meta.json.vos as { currentVersionId?: string } | undefined)
      ?.currentVersionId
    if (meta.status !== 200 || !head) {
      throw new Error(
        `--vos ${flags.vos}: cannot adopt it (${meta.status}${meta.json.error ? `: ${String(meta.json.error)}` : ''}) — it must be a vos this credential can read, with a version to build on`,
      )
    }
    r.log(
      `adopting vos ${flags.vos}: this take becomes the next version after its head (${head})`,
    )
    state = { vosId: flags.vos, versionId: head }
  }

  // --folder files the CREATED vos into a project (keys add
  // organization). Refused in words on an already-pushed take, and resolved
  // BEFORE any upload so a bad slug costs nothing — the flag used to parse
  // and silently drop, which is worse than either.
  let folderId: string | undefined
  if (flags.folder) {
    if (state) {
      throw new Error(
        '--folder applies when CREATING a vos — this take is already pushed; file it with: vos folder move <vosId> --to <folder>',
      )
    }
    folderId = resolveFolder(
      await listFolders(ctx.origin, ctx.key),
      flags.folder,
    ).id
  }

  // Never upload unprompted: explicit consent on the first push.
  if (firstPush && !flags.yes) {
    if (!process.stdin.isTTY) {
      throw new Error(
        'first push of this take uploads its recording — pass --yes to consent headlessly',
      )
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    const answer = await rl.question(
      `Push this take (recording + doc.json) to ${ctx.origin}? [y/N] `,
    )
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      throw new Error('push cancelled')
    }
  }

  // 1. The recording, content-addressed — re-pushes reuse the same asset.
  //    A take of any real length is past the single-request ceiling, so
  //    this goes in parts; `uploadAsset` picks the transport by size.
  const bytes = await readFile(take.paths.recording)
  const hash = createHash('sha256').update(bytes).digest('hex')
  // What the file IS, never what it is called. A take remuxed to mp4 keeps the
  // name `recording.webm`, and an asset declared `video/webm` holding mp4 bytes
  // fails every render of that version inside the video element — a format
  // error a day and a machine away from the mislabelling that caused it.
  const { type: contentType } = resolveMediaType({
    head: bytes.subarray(0, MEDIA_HEAD_BYTES),
    filename: take.paths.recordingName,
  })
  const filename = nameForType(take.paths.recordingName, contentType)
  if (filename !== take.paths.recordingName) {
    r.log(
      `  ${take.paths.recordingName} holds ${contentType} — uploading it as ${filename}`,
    )
  }
  r.log(`uploading recording (${Math.round(bytes.length / 1024)} kB)…`)
  let upload: UploadedAsset
  try {
    upload = await uploadAsset(ctx, new Uint8Array(bytes), {
      filename,
      contentType,
      contentHash: hash,
      // The take's length so the server holds it to the plan's cap.
      ...(take.meta.durationMs > 0
        ? { durationSeconds: take.meta.durationMs / 1000 }
        : {}),
      onPart: (done, total) => r.log(`  part ${done}/${total}`),
    })
  } catch (e) {
    throw new Error(
      `recording upload failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const assetId = upload.id
  const assetUrl = upload.url
  r.event({ event: 'recording', assetId, reused: upload.reused })
  if (upload.reused) r.log('  recording already hosted — reused')

  // 2. The doc, keys rewritten to hosted URLs; lower through the real
  //    pipeline so the hosted program is exactly what renders locally.
  const docForPush: ProjectDoc = structuredClone(take.doc)
  docForPush.source.videoKey = assetUrl
  if (
    docForPush.source.camKey &&
    !/^(https?:)?\//.test(docForPush.source.camKey)
  ) {
    r.log('  cam track is local-only — dropped from the push')
    delete docForPush.source.camKey
  }
  if (
    docForPush.source.micKey &&
    !/^(https?:)?\//.test(docForPush.source.micKey)
  ) {
    r.log('  mic track is local-only — dropped from the push')
    delete docForPush.source.micKey
  }
  // The document's other media, keyed beside the recording (a poster's
  // mark in brand/, a pasted ground): each file rides the same
  // content-addressed door, so a re-push reuses it, and the hosted
  // document keys the asset. A key whose file is missing is said and
  // left as it is (the hosted render will 404 on it, honestly).
  for (const ref of docMediaRefs(docForPush)) {
    const file = join(dir, takeRelativeFile(ref.key))
    if (!existsSync(file)) {
      r.log(`  ${ref.where}: ${ref.key} is not in the take — left as is`)
      continue
    }
    const media = await readFile(file)
    const mediaHash = createHash('sha256').update(media).digest('hex')
    // Same rule as the recording: the bytes name the type, and the uploaded
    // filename is corrected to match so the asset is never self-contradictory.
    const { type } = resolveMediaType({
      head: media.subarray(0, MEDIA_HEAD_BYTES),
      filename: file,
    })
    const name = nameForType(basename(file), type)
    if (name !== basename(file)) {
      r.log(`  ${ref.where}: ${basename(file)} holds ${type} — sent as ${name}`)
    }
    let put: UploadedAsset
    try {
      put = await uploadAsset(ctx, new Uint8Array(media), {
        filename: name,
        contentType: type,
        contentHash: mediaHash,
      })
    } catch (e) {
      throw new Error(
        `${ref.where} upload failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    ref.set(put.url)
    r.log(
      `  ${ref.where}: ${ref.key} → asset ${put.id}${put.reused ? ' (reused)' : ''}`,
    )
  }
  const lowered = lowerToComposition(docForPush)
  const config = { ...lowered.config, data: lowered.data }

  // 3. Create or iterate — always against the recorded base.
  if (!state) {
    const title =
      flags.title ??
      `Take ${basename(dir)} ${new Date().toISOString().slice(0, 10)}`
    const slug = `${
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'take'
    }-${Date.now().toString(36)}`
    const created = await api(ctx, '/vos', {
      method: 'POST',
      body: {
        title,
        slug,
        visibility: 'private',
        config,
        doc: docForPush,
        assetIds: [assetId],
        client: clientId(),
        ...(folderId ? { folderId } : {}),
        ...(flags.label ? { label: flags.label } : {}),
        ...(flags.note ? { note: flags.note } : {}),
      },
    })
    if (created.status !== 201) {
      throw new Error(
        `push failed (${created.status}): ${String(created.json.error ?? '')}${detailLine(created.json)}`,
      )
    }
    const vos = created.json.vos as { id: string; currentVersionId?: string }
    const meta = await api(ctx, `/vos/${vos.id}`)
    const versionId = String(
      (meta.json.vos as { currentVersionId?: string } | undefined)
        ?.currentVersionId ?? '',
    )
    writeSyncState(dir, {
      vosId: vos.id,
      versionId,
      pushedAt: new Date().toISOString(),
      title,
      slug,
    })
    return { vosId: vos.id, versionId, versionNumber: 1 }
  }

  const pushed = await api(ctx, `/vos/${state.vosId}/versions`, {
    method: 'POST',
    body: {
      config,
      doc: docForPush,
      client: clientId(),
      ...(state.versionId ? { baseVersionId: state.versionId } : {}),
      ...(flags.label ? { label: flags.label } : {}),
      ...(flags.note ? { note: flags.note } : {}),
      ...(flags.overrides?.length ? { overrides: flags.overrides } : {}),
    },
  })
  if (pushed.status === 409) {
    r.log(
      pushed.json.error === 'stale_base'
        ? 'HEAD moved while you worked — what changed:'
        : `protected nodes (${String((pushed.json.nodes as string[] | undefined)?.join(', '))}) — the human touched these since your last push:`,
    )
    printChanges(r, pushed.json.changes, pushed.json.protected)
    r.event({ event: 'conflict', ...pushed.json })
    throw new Error(
      pushed.json.error === 'stale_base'
        ? 'stale base — run `vos pull` to take the human’s changes, re-apply yours on top, then push again'
        : 'protected conflict — keep the human’s values, or push with --override <id> ONLY if the user asked for that exact change',
    )
  }
  if (pushed.status !== 201) {
    throw new Error(
      `push failed (${pushed.status}): ${String(pushed.json.error ?? '')}${detailLine(pushed.json)}`,
    )
  }
  const version = pushed.json.version as { id: string; versionNumber: number }
  writeSyncState(dir, {
    vosId: state.vosId,
    versionId: version.id,
    pushedAt: new Date().toISOString(),
  })
  return {
    vosId: state.vosId,
    versionId: version.id,
    versionNumber: version.versionNumber,
  }
}

export async function pullTake(
  dir: string,
  flags: {
    key?: string
    api?: string
    origin?: string
    vos?: string
    /** Also download the recording + sidecars and re-anchor the doc. */
    media?: boolean
    /** The base to walk the changelog from; default the tracked version. */
    since?: string
    /** Report what changed and stop: no doc.json, no media, no repoint. */
    check?: boolean
  },
  r: Reporter,
): Promise<{
  vosId: string
  versionId: string
  versionNumber: number | null
  changed: boolean
  media?: MediaPullResult
  /** --check: the report, nothing written. */
  checked?: boolean
  /** --check: versions between the base and head (null when there is no base to walk from). */
  behind?: number | null
  changes?: unknown[]
  protected?: string[]
}> {
  const ctx = apiContext(flags)
  const state = readSyncState(dir)
  const vosId = flags.vos ?? state?.vosId
  if (!vosId) {
    throw new Error('this take was never pushed — pass --vos <id> to link it')
  }
  const base = flags.since ?? state?.versionId ?? null

  const meta = await api(ctx, `/vos/${vosId}`)
  if (meta.status !== 200) {
    throw new Error(
      `fetch failed (${meta.status}): ${String(meta.json.error ?? '')}`,
    )
  }
  const head = String(
    (meta.json.vos as { currentVersionId?: string } | undefined)
      ?.currentVersionId ?? '',
  )
  if (!head) throw new Error('this vos has no versions')

  if (base === head) {
    r.log(
      flags.since
        ? 'up to date — --since names the head'
        : 'up to date — HEAD is your last push',
    )
    if (flags.check) {
      return {
        vosId,
        versionId: head,
        versionNumber: null,
        changed: false,
        checked: true,
        behind: 0,
        changes: [],
        protected: [],
      }
    }
    let media: MediaPullResult | undefined
    if (flags.media && existsSync(join(dir, 'doc.json'))) {
      const local = JSON.parse(
        await readFile(join(dir, 'doc.json'), 'utf8'),
      ) as ProjectDoc
      media = await pullMedia(ctx, dir, local, r.log)
    }
    return {
      vosId,
      versionId: head,
      versionNumber: null,
      changed: false,
      media,
    }
  }

  // The typed changelog: what the human did since this take's base (the
  // tracked version, or --since).
  let walked: { changes: unknown[]; protected: string[] } | null = null
  if (base) {
    const changes = await api(
      ctx,
      `/vos/${vosId}/changes?since=${encodeURIComponent(base)}`,
    )
    if (changes.status === 200) {
      r.log(
        flags.since
          ? `changes since ${base.slice(0, 8)}…:`
          : 'changes since your last push:',
      )
      printChanges(r, changes.json.changes, changes.json.protected)
      walked = {
        changes: Array.isArray(changes.json.changes)
          ? (changes.json.changes as unknown[])
          : [],
        protected: Array.isArray(changes.json.protected)
          ? (changes.json.protected as string[])
          : [],
      }
      if (changes.json.truncated === true) {
        r.log('walk truncated — more versions exist; pull again after syncing')
      }
    } else {
      r.log(
        `changelog unavailable (${changes.status}) — the head is v?; pass --since <versionId> you can read, or pull to sync`,
      )
    }
  } else {
    r.log(
      'no base to compare from (this take was linked with --vos) — pass --since <versionId> for the changelog',
    )
  }

  // --check: the report is the result. Nothing on disk moves.
  if (flags.check) {
    return {
      vosId,
      versionId: head,
      versionNumber: null,
      changed: false,
      checked: true,
      behind: walked ? walked.changes.length : null,
      changes: walked?.changes ?? [],
      protected: walked?.protected ?? [],
    }
  }

  // The head doc, migrated on read, re-anchored to the local recording —
  // same bytes by construction (content-addressed upload).
  const docRes = await api(ctx, `/vos/${vosId}/versions/${head}/doc`)
  if (docRes.status !== 200) {
    throw new Error(
      docRes.status === 404
        ? 'the head version carries no doc — is this a take vos?'
        : `doc fetch failed (${docRes.status})`,
    )
  }
  const hostedDoc = migrateHostedDoc(docRes.json)
  const doc = hostedDoc as unknown as ProjectDoc
  const localRecording = takeMediaFile(dir, 'recording', RECORDING_NAME)
  if (existsSync(localRecording)) {
    doc.source.videoKey = basename(localRecording)
  }
  await writeJson(join(dir, 'doc.json'), doc, true)
  // --media: the footage (and sidecars) come home beside the doc, so digest,
  // frames and render work on this directory as on a local take.
  const media = flags.media ? await pullMedia(ctx, dir, doc, r.log) : undefined

  const versions = await api(ctx, `/vos/${vosId}/versions`)
  const headRow = (
    (versions.json.versions ?? []) as { id: string; versionNumber: number }[]
  ).find((v) => v.id === head)

  writeSyncState(dir, {
    vosId,
    versionId: head,
    pushedAt: state?.pushedAt ?? new Date().toISOString(),
  })
  return {
    vosId,
    versionId: head,
    versionNumber: headRow?.versionNumber ?? null,
    changed: true,
    media,
  }
}
