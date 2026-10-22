/**
 * `vos join <take> <take|file.mp4>… --out <dir> [--force] [--captions]`:
 * several takes (and plain video files) as ONE film, cut in argument
 * order, editable as one document.
 *
 * The first input is the PRIMARY: its frame, cursor style, export, audio
 * and its own cut come along as they are. Each next input becomes a media
 * of the document (`m1`, `m2`, …): its footage is copied under `<id>/` in
 * the new take, its segments are appended in order (so the output plays
 * the inputs one after the other), every source-anchored span it carries
 * is tagged with its media and renamed `<id>-…`, and its layers move to
 * where its footage now starts (a layer about one of its steps is anchored
 * to that step instead, so it keeps its moment whatever the cut does). A
 * plain video file becomes a media with no cursor, a probed meta, a
 * full-bleed card of its own and one segment over its whole length.
 *
 * The document is assembled in memory (`joinDocs`, pure) and must pass
 * `vos validate` before anything is written; `--out` is refused when it
 * exists, unless `--force` names a take directory to replace.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  mediaKey,
  mediaRefId,
  migrateMotion,
  projectFromArtifact,
  ratedSegments,
  resolveAnchor,
  segmentOutputExtents,
} from '@vosjs/studio-core'
import { localFile } from '../programAssets'
import { UsageError, parseArgs, strFlag } from './args'
import { copyRecording, probeVideoFile } from './ingest'
import {
  docMediaRefs,
  docObjectRefs,
  docOverlayRefs,
  isTakeRelativeKey,
  sourceSidecarRefs,
  takeRelativeFile,
} from './media'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'
import { landStepCaptions } from './stepCaptions'
import { loadTake, writeJson } from './take'
import { lintDoc } from './validateDoc'
import type {
  Media,
  MediaFrame,
  ProjectDoc,
  RecordingMeta,
} from '@vosjs/studio-core'
import type { ActionsFile } from './actions'
import type { ProbedVideo } from './ingest'
import type { DocMediaRef } from './media'
import type { StepCaptionReport } from './stepCaptions'

/** The card a plain video file wears: the whole frame, no corners, no shadow. */
export const FULL_BLEED_FRAME: MediaFrame = {
  inset: { top: 0, right: 0, bottom: 0, left: 0 },
  radius: 0,
  shadow: 0,
  shadowContact: 0,
  border: 0,
  fit: 'cover',
}

/** One input to a join, read. */
export interface JoinPart {
  /** How the input was named, for messages. */
  label: string
  kind: 'take' | 'file'
  /** The input's document (a take's doc.json, or one built for the file). */
  doc: ProjectDoc
  /** Where the document's take-relative keys resolve (a take's directory). */
  dir: string
  /** The actions.json that recorded it, when there is one. */
  actions: ActionsFile | null
  /** A plain file: the video itself and its container. */
  file?: { path: string; ext: ProbedVideo['ext'] }
}

/** A file the joined take needs: its source on disk and its key in the new take. */
export interface JoinCopy {
  from: string
  to: string
  /** A plain video file, stream-copied into an indexed container. */
  remux?: ProbedVideo['ext']
  /** The input directory `from` must sit in (a document names files beside it). */
  base?: string
}

export interface JoinPlan {
  doc: ProjectDoc
  copies: JoinCopy[]
  /** Each input after the first, and the media id it became. */
  media: { label: string; id: string }[]
  /** actions.json per media key (`''` = the primary), for step captions. */
  actions: Map<string, ActionsFile | null>
  notes: string[]
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** The take-relative key a later input's file lands under. */
const prefixed = (id: string, key: string): string =>
  `${id}/${takeRelativeFile(key)}`

/** A document for a plain video file: its footage, bare, one segment. */
export function fileDoc(
  key: string,
  probed: Pick<
    ProbedVideo,
    'width' | 'height' | 'durationMs' | 'fps' | 'hasAudio'
  >,
  t0 = 0,
): ProjectDoc {
  const meta: RecordingMeta = {
    dpr: 1,
    zoom: 1,
    t0,
    durationMs: probed.durationMs,
    width: probed.width,
    height: probed.height,
    captureWidth: probed.width,
    captureHeight: probed.height,
    fps: probed.fps > 0 ? probed.fps : 30,
    hasAudio: probed.hasAudio,
    producer: 'ingest',
  }
  const doc = projectFromArtifact({ videoKey: key, cursor: [], meta }, key, {
    footage: true,
  }).doc
  doc.segments = [{ in: 0, out: round3(probed.durationMs / 1000) }]
  return doc
}

/**
 * Assemble the joined document. Pure: no file is read or written; the
 * plan names every file to copy.
 */
export function joinDocs(parts: readonly JoinPart[]): JoinPlan {
  if (parts.length < 2)
    throw new UsageError('vos join needs two inputs or more')
  const [first, ...rest] = parts
  const doc = structuredClone(first.doc)
  const notes: string[] = []
  const copies = new Map<string, JoinCopy>()
  const copy = (c: JoinCopy) => {
    if (!copies.has(c.to)) copies.set(c.to, c)
  }
  const actions = new Map<string, ActionsFile | null>([['', first.actions]])

  // The primary's files keep their keys.
  if (first.file) {
    copy({
      from: first.file.path,
      to: takeRelativeFile(doc.source.videoKey),
      remux: first.file.ext,
    })
  } else {
    const refs: DocMediaRef[] = [
      ...(isTakeRelativeKey(doc.source.videoKey)
        ? [{ where: 'recording', key: doc.source.videoKey, set: () => {} }]
        : []),
      ...sourceSidecarRefs(doc),
      ...docMediaRefs(doc),
    ]
    for (const ref of refs)
      copy({
        from: join(first.dir, takeRelativeFile(ref.key)),
        to: takeRelativeFile(ref.key),
        base: first.dir,
      })
  }
  // An empty list means "untrimmed"; once other footage follows, the
  // primary's whole length has to be said.
  if (!doc.segments.length)
    doc.segments = [{ in: 0, out: round3(doc.source.meta.durationMs / 1000) }]

  const taken = new Set((doc.media ?? []).map((m) => m.id))
  const allocate = (): string => {
    let n = 1
    while (taken.has(`m${n}`)) n++
    taken.add(`m${n}`)
    return `m${n}`
  }
  const media: Media[] = [...(doc.media ?? [])]
  const joined: JoinPlan['media'] = []
  /** Each later input's first segment index and its own document, for the layers. */
  const placed: {
    part: JoinPart
    d: ProjectDoc
    pid: string
    firstSegment: number
    mapMedia: (k: string | undefined) => string
  }[] = []

  for (const part of rest) {
    // One vocabulary first: a legacy end card is clips, a hold a freeze.
    const d = structuredClone(migrateMotion(part.doc))
    const pid = allocate()
    const idMap = new Map<string, string>([['', pid]])
    for (const m of d.media ?? []) idMap.set(m.id, allocate())
    const mapMedia = (k: string | undefined): string =>
      idMap.get(mediaKey(k)) ?? pid
    joined.push({ label: part.label, id: pid })
    actions.set(pid, part.actions)

    // Its files, under `<id>/`: the footage and its sidecars, its other
    // media, and the files its layers and props name. Its frame and its
    // sound are the primary's business and are not brought.
    if (part.file) {
      const to = `${pid}/recording.${part.file.ext}`
      copy({ from: part.file.path, to, remux: part.file.ext })
      d.source.videoKey = to
    } else {
      const refs: DocMediaRef[] = [
        ...(isTakeRelativeKey(d.source.videoKey)
          ? [
              {
                where: 'recording',
                key: d.source.videoKey,
                set: (next: string) => {
                  d.source.videoKey = next
                },
              },
            ]
          : []),
        ...sourceSidecarRefs(d),
        ...(d.media ?? []).flatMap((m) =>
          [
            ['videoKey', m.videoKey],
            ['micKey', m.micKey],
            ['camKey', m.camKey],
          ]
            .filter(([, k]) => isTakeRelativeKey(k))
            .map(([field, k]) => ({
              where: `media ${m.id}`,
              key: k as string,
              set: (next: string) => {
                ;(m as unknown as Record<string, string>)[field as string] =
                  next
              },
            })),
        ),
        ...docOverlayRefs(d),
        ...docObjectRefs(d),
      ]
      for (const ref of refs) {
        const to = prefixed(pid, ref.key)
        copy({
          from: join(part.dir, takeRelativeFile(ref.key)),
          to,
          base: part.dir,
        })
        ref.set(to)
      }
    }

    media.push({
      ...d.source,
      id: pid,
      ...(part.kind === 'file' ? { frame: { ...FULL_BLEED_FRAME } } : {}),
    } as Media)
    for (const m of d.media ?? []) media.push({ ...m, id: idMap.get(m.id)! })

    // Its cut, appended: output order is argument order.
    const segs = d.segments.length
      ? d.segments
      : [{ in: 0, out: round3(d.source.meta.durationMs / 1000) }]
    const at = doc.segments.length
    doc.segments.push(...segs.map((s) => ({ ...s, media: mapMedia(s.media) })))

    // Its source-anchored spans, tagged with their media and renamed.
    const ns = (id: string) => `${pid}-${id}`
    const tag = <T extends { id: string; media?: string }>(s: T): T => ({
      ...s,
      id: ns(s.id),
      media: mapMedia(s.media),
    })
    doc.zoom = [...doc.zoom, ...d.zoom.map(tag)]
    if (d.speed?.length) doc.speed = [...(doc.speed ?? []), ...d.speed.map(tag)]
    if (d.tilt?.length) doc.tilt = [...(doc.tilt ?? []), ...d.tilt.map(tag)]
    if (d.camMotion?.length)
      doc.camMotion = [...(doc.camMotion ?? []), ...d.camMotion.map(tag)]
    if (d.freeze?.length)
      doc.freeze = [...(doc.freeze ?? []), ...d.freeze.map(tag)]
    if (d.rejected?.length)
      doc.rejected = [...(doc.rejected ?? []), ...d.rejected.map(tag)]
    if (d.audio.length)
      notes.push(
        `${part.label}: its ${d.audio.length} sound clip${d.audio.length === 1 ? '' : 's'} stay behind (the film's sound is the first input's; add a score with vos score)`,
      )
    placed.push({ part, d, pid, firstSegment: at, mapMedia })
  }
  if (media.length) doc.media = media

  // The layers: each later input's move to where its footage now starts,
  // or keep their step through an anchor.
  const extents = segmentOutputExtents(doc)
  for (const { part, d, pid, firstSegment, mapMedia } of placed) {
    const offset = extents[firstSegment]?.start ?? 0
    const ownPieces = ratedSegments(d)
    const ns = (id: string) => `${pid}-${id}`
    let dropped = 0
    for (const o of d.overlays ?? []) {
      const next = { ...o, id: ns(o.id) }
      if (next.kind !== 'text' && next.kind !== 'html') {
        const ref = mediaRefId(next.key)
        if (ref !== null) next.key = `media:${mapMedia(ref)}`
      }
      if (o.anchor) {
        next.anchor = { ...o.anchor, media: mapMedia(o.anchor.media) }
      } else if (o.pin?.step !== undefined) {
        // A pin reads the PRIMARY's steps and card, so on another media it
        // would point at the wrong thing; its time survives as an anchor.
        const r = resolveAnchor(d, { step: o.pin.step }, ownPieces)
        if (r.start !== null) {
          next.anchor = {
            step: o.pin.step,
            media: pid,
            offset: round3(o.start - r.start),
          }
        } else {
          next.start = round3(o.start + offset)
        }
        delete next.pin
        dropped++
      } else {
        if (o.pin) {
          delete next.pin
          dropped++
        }
        next.start = round3(o.start + offset)
      }
      ;(doc.overlays ??= []).push(next)
    }
    if (dropped)
      notes.push(
        `${part.label}: ${dropped} pinned layer${dropped === 1 ? '' : 's'} kept ${dropped === 1 ? 'its' : 'their'} time and lost the pin (a pin places a layer on the first input's footage only)`,
      )
    for (const ob of d.objects ?? []) {
      ;(doc.objects ??= []).push({
        ...ob,
        id: ns(ob.id),
        ...(ob.span
          ? { span: { ...ob.span, start: round3(ob.span.start + offset) } }
          : {}),
      })
    }
  }
  // Every anchored layer's fallback start is where it plays now.
  const pieces = ratedSegments(doc)
  for (const o of doc.overlays ?? []) {
    if (!o.anchor) continue
    const r = resolveAnchor(doc, o.anchor, pieces)
    if (r.start !== null) o.start = r.start
  }
  return { doc, copies: [...copies.values()], media: joined, actions, notes }
}

const BOOLEAN_FLAGS = new Set(['json', 'help', 'force', 'captions'])

const USAGE =
  'vos join <take> <take|file.mp4>… --out <dir> [--force] [--captions] [--json]'

/** Is `inner` the same path as `outer`, or inside it? */
const within = (inner: string, outer: string): boolean => {
  const rel = relative(outer, inner)
  return (
    rel === '' ||
    (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
  )
}

/** Read one input: a take directory, or a plain video file. */
async function readPart(arg: string): Promise<JoinPart> {
  const path = resolve(arg)
  if (!existsSync(path)) throw new UsageError(`${arg}: no such take or file`)
  if (statSync(path).isDirectory()) {
    if (!existsSync(join(path, 'meta.json')))
      throw new UsageError(
        `${arg}: not a take directory (no meta.json); a video file is joined by its path`,
      )
    const take = await loadTake(path)
    const doc =
      take.doc ??
      projectFromArtifact(
        {
          videoKey: take.paths.recordingName,
          cursor: take.cursor,
          meta: take.meta,
        },
        take.paths.recordingName,
      ).doc
    return { label: arg, kind: 'take', doc, dir: path, actions: take.actions }
  }
  const probed = await probeVideoFile(path)
  if (!(probed.durationMs > 0))
    throw new UsageError(`${arg}: the file reports no duration`)
  const doc = fileDoc(
    `recording.${probed.ext}`,
    probed,
    Math.round(statSync(path).mtimeMs),
  )
  return {
    label: arg,
    kind: 'file',
    doc,
    dir: dirname(path),
    actions: null,
    file: { path, ext: probed.ext },
  }
}

export async function cmdJoin(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const r = createReporter(flags.json === true)
  const outArg = strFlag(flags, 'out')
  if (positionals.length < 2 || !outArg) throw new UsageError(USAGE)
  const out = resolve(outArg)
  const inputs = positionals.map((p) => resolve(p))
  for (const [i, input] of inputs.entries()) {
    if (within(out, input) || within(input, out))
      throw new UsageError(
        `--out ${outArg} overlaps the input ${positionals[i]}; write the joined take somewhere of its own`,
      )
  }
  if (existsSync(out)) {
    if (flags.force !== true)
      throw new UsageError(
        `--out ${outArg} exists; pass --force to replace it, or name a new directory`,
      )
    const isTake =
      existsSync(join(out, 'doc.json')) || existsSync(join(out, 'meta.json'))
    if (!isTake && readdirSync(out).length > 0)
      throw new UsageError(
        `--force replaces a take directory, and ${outArg} holds other files; name a new directory`,
      )
    if (within(process.cwd(), out))
      throw new UsageError(
        `--out ${outArg} is the working directory or above it; name a new directory`,
      )
  }

  const parts: JoinPart[] = []
  for (const p of positionals) {
    r.log(`reading ${p}…`)
    parts.push(await readPart(p))
  }
  const plan = joinDocs(parts)
  let captions: StepCaptionReport | null = null
  if (flags.captions === true)
    captions = landStepCaptions(plan.doc, plan.actions)

  // The result must validate before a byte is written.
  const lint = lintDoc(plan.doc)
  if (lint.problems.length) {
    r.log(
      `the joined document does not validate:\n  ${lint.problems.join('\n  ')}`,
    )
    return EXIT_ERROR
  }
  // Every file a document names sits in its own take directory or below
  // (a fetched document is not trusted with the disk), and is there.
  for (const c of plan.copies) {
    if (!c.base) continue
    const found = localFile(relative(c.base, c.from), c.base)
    if ('refused' in found)
      throw new Error(
        `${relative(process.cwd(), c.from) || c.from}, which an input's doc.json names, ${found.refused}; bring its media home first (vos fetch --media) or fix the key`,
      )
    c.from = found.file
  }

  if (existsSync(out)) await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  for (const c of plan.copies) {
    const to = join(out, c.to)
    await mkdir(dirname(to), { recursive: true })
    if (c.remux) await copyRecording(c.from, to, c.remux)
    else await copyFile(c.from, to)
  }
  const doc = plan.doc
  await writeJson(join(out, 'meta.json'), doc.source.meta, true)
  if (doc.source.cursor.length)
    await writeJson(join(out, 'cursor.json'), doc.source.cursor)
  if (parts[0].actions)
    await writeJson(join(out, 'actions.json'), parts[0].actions, true)
  await writeJson(join(out, 'doc.json'), doc, true)

  const extents = segmentOutputExtents(doc)
  const length = extents.length ? extents[extents.length - 1].end : 0
  for (const n of plan.notes) r.log(`note: ${n}`)
  for (const w of lint.warnings) r.log(`warning: ${w}`)
  const captionLine = captions
    ? `\n  ${captions.landed.length} step caption${captions.landed.length === 1 ? '' : 's'} landed` +
      (captions.skipped.length
        ? `; not landed: ${captions.skipped.join('; ')}`
        : '')
    : ''
  r.done(
    {
      out,
      primary: positionals[0],
      media: plan.media,
      segments: doc.segments.length,
      seconds: round3(length),
      files: plan.copies.map((c) => c.to),
      notes: plan.notes,
      warnings: lint.warnings,
      ...(captions ? { captions } : {}),
    },
    `Joined ${parts.length} inputs → ${out} (${length.toFixed(1)}s, ${doc.segments.length} segments)\n  ${positionals[0]} is the primary; ${plan.media.map((m) => `${m.label} → ${m.id}`).join(', ')}${captionLine}\n  Next: vos frames ${outArg} --times 0,25%,50%,75%,100%; vos render ${outArg}`,
  )
  return EXIT_OK
}
