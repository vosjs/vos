/**
 * `vos join <take> <take|file.mp4>… --out <dir> [--keep-edits|--force]
 * [--captions] [--zooms per-beat]`:
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
 * to that step instead, so it keeps its moment whatever the cut does).
 * Only the last input keeps its ENDING (the layers that start after its
 * footage); anyone else's would land over the next clip, so it is dropped
 * and named. A
 * plain video file becomes a media with no cursor, a probed meta, a
 * full-bleed card of its own and one segment over its whole length.
 *
 * The document is assembled in memory (`joinDocs`, pure) and must pass
 * `vos validate` before anything is written; `--out` is refused when it
 * exists, unless `--force` names a take directory to replace or
 * `--keep-edits` joins again over it and keeps the edits made since
 * (rejoin.ts). Every join writes `join.json`, the record a re-join matches
 * its inputs against.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  mediaKey,
  mediaRefId,
  migrateMotion,
  projectFromArtifact,
  ratedSegments,
  layerStart,
  resolveAnchor,
  segmentOutputExtents,
} from '@vosjs/studio-core'
import { totalDuration } from '@vosjs/timeline'
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
import { loudnessFact, measureTrack } from './score'
import { landStepCaptions } from './stepCaptions'
import { publicScript } from './takeScript'
import { scriptDrift, scriptDriftLine } from './scriptStep'
import { oneZoomPerBeat, perBeatLine, zoomModeOf } from './beats'
import {
  JOIN_RECORD_NAME,
  joinRecordOf,
  partFootage,
  readJoinRecord,
  recordFromFootage,
  rejoinDocs,
  rejoinLines,
} from './rejoin'
import type { PerBeatReport } from './beats'
import type { RejoinInput } from './rejoin'
import { loadTake, writeJson } from './take'
import { lintDoc } from './validateDoc'
import type {
  OverlayClip,
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
  /** A plain file: the video itself, its container, and whether it carries sound. */
  file?: { path: string; ext: ProbedVideo['ext']; hasAudio?: boolean }
  /** Leave a plain file's own sound out (`--mute`). */
  mute?: boolean
  /**
   * The media id this input keeps (a re-join that keeps the edits); absent
   * = the next free one. Never set on the first input, which is the primary.
   */
  id?: string
  /** Its own media's ids in the joined take, by their id in its document (a re-join). */
  subIds?: Record<string, string>
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
  /** Each input in argument order: its media id (`''` = the primary) and its own media's. */
  ids: { id: string; sub: Record<string, string> }[]
  /** The layers, props and sound clips placed for a later input, by their id: that input's media id. */
  owners: Map<string, string>
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** The fade at each end of a plain file's own sound, seconds. */
export const FILE_SOUND_FADE = 0.15

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
 * The layers of one input that START after its footage ends: an ending
 * (an end card's words, a closing title) that plays over the held frame or
 * the ground once the footage is over. In a join only the last input's
 * ending is still an ending; anyone else's would land over the next clip.
 * An anchored layer is judged where its anchor places it.
 */
export function endingLayers(doc: ProjectDoc): OverlayClip[] {
  const pieces = ratedSegments(doc)
  const end = totalDuration(pieces)
  if (!(end > 0)) return []
  return (doc.overlays ?? []).filter((o) => {
    // A layer placed nowhere (an anchor that resolves to no step, and no
    // start) plays nowhere, so it ends nothing.
    const start = layerStart(o, doc, pieces)
    return start !== null && start >= end - 1e-3
  })
}

/** Drop an input's ending, saying what went. In place. */
function dropEnding(d: ProjectDoc, label: string, notes: string[]): void {
  const ending = endingLayers(d)
  const legacy = d.endCard !== undefined
  if (!ending.length && !legacy) return
  const gone = new Set(ending)
  d.overlays = (d.overlays ?? []).filter((o) => !gone.has(o))
  if (!d.overlays.length) delete d.overlays
  if (legacy) delete d.endCard
  const named = [
    ...ending.map((o) => o.id),
    ...(legacy ? ['its endCard'] : []),
  ].join(', ')
  notes.push(
    `${label}: dropped ${named}, which played after its footage and would land over the next input (only the last input's ending stays, at the end of the film)`,
  )
}

/** An input's first clip (its cut, or its whole length). */
function segs0(d: ProjectDoc): { in: number; out: number } | undefined {
  return d.segments.length
    ? d.segments[0]
    : { in: 0, out: round3(d.source.meta.durationMs / 1000) }
}

/**
 * Assemble the joined document. Pure: no file is read or written; the
 * plan names every file to copy.
 */
export function joinDocs(
  parts: readonly JoinPart[],
  opts: { reserved?: Iterable<string> } = {},
): JoinPlan {
  if (parts.length < 2)
    throw new UsageError('vos join needs two inputs or more')
  const [first, ...rest] = parts
  const doc = structuredClone(first.doc)
  const notes: string[] = []
  // Every input but the last loses its ending before anything is copied.
  dropEnding(doc, first.label, notes)
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

  // A fresh id never lands on one a kept input holds, or on one a re-join
  // retired (an id names one media for the life of the take).
  const taken = new Set([
    ...(doc.media ?? []).map((m) => m.id),
    ...(opts.reserved ?? []),
    ...rest.flatMap((p) => [
      ...(p.id ? [p.id] : []),
      ...Object.values(p.subIds ?? {}),
    ]),
  ])
  const ids: JoinPlan['ids'] = [
    {
      id: '',
      sub: Object.fromEntries((doc.media ?? []).map((m) => [m.id, m.id])),
    },
  ]
  const owners = new Map<string, string>()
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
    if (part !== rest[rest.length - 1]) dropEnding(d, part.label, notes)
    const pid = part.id ?? allocate()
    const idMap = new Map<string, string>([['', pid]])
    for (const m of d.media ?? [])
      idMap.set(m.id, part.subIds?.[m.id] ?? allocate())
    ids.push({
      id: pid,
      sub: Object.fromEntries(
        (d.media ?? []).map((m) => [m.id, idMap.get(m.id)!]),
      ),
    })
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

    // Its script rides its media, as a pushed take's rides its source, so
    // its step captions (and the beats they mark) are read from the joined
    // take alone.
    const script =
      !d.source.script && part.actions
        ? publicScript(part.actions as unknown as Record<string, unknown>)
        : undefined
    media.push({
      ...d.source,
      id: pid,
      ...(script ? { script } : {}),
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
      } else if (o.start === undefined) {
        // Neither a time nor a step: validate refuses the joined take.
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
      owners.set(next.id, pid)
    }
    if (dropped)
      notes.push(
        `${part.label}: ${dropped} pinned layer${dropped === 1 ? '' : 's'} kept ${dropped === 1 ? 'its' : 'their'} time and lost the pin (a pin places a layer on the first input's footage only)`,
      )
    // A plain file's own sound is part of what it is: a media plays its
    // picture only, so the sound rides the take's audio, keyed to the copied
    // file, starting where the file now plays, trimmed to its clip, with a
    // short fade at each end. A take's added sound is its own choice and
    // stays behind (above).
    if (part.file?.hasAudio) {
      const seg = segs0(d)
      const at = extents[firstSegment]
      if (part.mute) {
        notes.push(`${part.label}: its own sound is left out (--mute)`)
      } else if (seg && at) {
        const len = Math.max(0, seg.out - seg.in)
        const fade = round3(Math.min(FILE_SOUND_FADE, len / 4))
        const id = `${pid}-sound`
        owners.set(id, pid)
        doc.audio = [
          ...doc.audio,
          {
            id,
            key: d.source.videoKey,
            name: basename(part.file.path),
            start: round3(at.start),
            in: round3(seg.in),
            out: round3(seg.out),
            duration: round3(d.source.meta.durationMs / 1000),
            gain: 1,
            fadeIn: fade,
            fadeOut: fade,
          },
        ]
        notes.push(
          `${part.label}: its own sound plays as audio clip ${id}, ${at.start.toFixed(2)}..${(at.start + len).toFixed(2)}s (--mute ${part.label} to leave it out)`,
        )
      }
    }
    for (const ob of d.objects ?? []) {
      owners.set(ns(ob.id), pid)
      ;(doc.objects ??= []).push({
        ...ob,
        id: ns(ob.id),
        ...(ob.span
          ? { span: { ...ob.span, start: round3(ob.span.start + offset) } }
          : {}),
      })
    }
  }
  for (const part of rest)
    if (part.mute && !part.file?.hasAudio)
      notes.push(
        `${part.label}: --mute leaves nothing out (${part.file ? 'the file carries no sound' : "a take's own footage sound is its recording's; its added sound stays behind anyway"})`,
      )
  if (first.mute)
    notes.push(
      `${first.label}: --mute leaves nothing out (the first input's sound is the film's own)`,
    )
  // Every anchored layer's fallback start is where it plays now; a layer
  // that carries none keeps none, its anchor is its time.
  const pieces = ratedSegments(doc)
  for (const o of doc.overlays ?? []) {
    if (!o.anchor || o.start === undefined) continue
    const r = resolveAnchor(doc, o.anchor, pieces)
    if (r.start !== null) o.start = r.start
  }
  return {
    doc,
    copies: [...copies.values()],
    media: joined,
    actions,
    notes,
    ids,
    owners,
  }
}

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'force',
  'keep-edits',
  'captions',
])
const MULTI = new Set(['mute'])

const USAGE =
  'vos join <take> <take|file.mp4>… --out <dir> [--keep-edits|--force] [--captions] [--zooms per-beat] [--mute <file>]... [--json]'

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
    file: { path, ext: probed.ext, hasAudio: probed.hasAudio },
  }
}

export async function cmdJoin(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(argv, BOOLEAN_FLAGS, MULTI)
  const r = createReporter(flags.json === true)
  const outArg = strFlag(flags, 'out')
  const force = flags.force === true
  const keepEdits = flags['keep-edits'] === true
  const withCaptions = flags.captions === true
  const zoomMode = zoomModeOf(strFlag(flags, 'zooms'))
  if (zoomMode && typeof zoomMode === 'object')
    throw new UsageError(zoomMode.error)
  if (positionals.length < 2 || !outArg) throw new UsageError(USAGE)
  if (force && keepEdits)
    throw new UsageError(
      '--force replaces the joined take and --keep-edits keeps its edits; pass one',
    )
  const out = resolve(outArg)
  const inputs = positionals.map((p) => resolve(p))
  const muted = new Set<number>()
  for (const m of multi.mute ?? []) {
    const i = inputs.indexOf(resolve(m))
    if (i < 0)
      throw new UsageError(
        `--mute ${m}: not one of the inputs; name a file as it is given to vos join`,
      )
    muted.add(i)
  }
  for (const [i, input] of inputs.entries()) {
    if (within(out, input) || within(input, out))
      throw new UsageError(
        `--out ${outArg} overlaps the input ${positionals[i]}; write the joined take somewhere of its own`,
      )
  }
  // --keep-edits over a joined take: its edited doc.json is the base.
  let rejoin = false
  if (existsSync(out)) {
    if (!force && !keepEdits)
      throw new UsageError(
        `--out ${outArg} exists; pass --keep-edits to join again and keep every edit made since (its trims, spans, layers, frame, sound), --force to replace it, or name a new directory`,
      )
    if (keepEdits) {
      if (!existsSync(join(out, 'doc.json')))
        throw new UsageError(
          `--keep-edits: ${outArg} holds no doc.json, so there are no edits to keep; name a new directory, or --force to replace it`,
        )
      rejoin = true
    } else {
      const isTake =
        existsSync(join(out, 'doc.json')) || existsSync(join(out, 'meta.json'))
      if (!isTake && readdirSync(out).length > 0)
        throw new UsageError(
          `--force replaces a take directory, and ${outArg} holds other files; name a new directory`,
        )
    }
    if (within(process.cwd(), out))
      throw new UsageError(
        `--out ${outArg} is the working directory or above it; name a new directory`,
      )
  }

  const parts: JoinPart[] = []
  const read: RejoinInput[] = []
  for (const [i, p] of positionals.entries()) {
    r.log(`reading ${p}…`)
    const part: JoinPart = {
      ...(await readPart(p)),
      ...(muted.has(i) ? { mute: true } : {}),
    }
    parts.push(part)
    // An input's script edited since it was recorded: said, never refused.
    const drift =
      part.kind === 'take'
        ? scriptDrift(part.doc.source.meta.steps ?? [], part.actions?.steps)
        : null
    if (drift) r.warn(`${p}: ${scriptDriftLine(drift)}`)
    read.push({
      part,
      path: relative(out, inputs[i]) || '.',
      footage: await partFootage(part),
    })
  }
  if (keepEdits && !rejoin)
    r.log(
      `note: --keep-edits: ${outArg} does not exist yet, so this is a fresh join`,
    )

  let plan: JoinPlan
  let rejoined: ReturnType<typeof rejoinDocs> | null = null
  if (rejoin) {
    const prev = JSON.parse(
      await readFile(join(out, 'doc.json'), 'utf8'),
    ) as ProjectDoc
    let record = await readJoinRecord(out)
    if (!record) {
      record = await recordFromFootage(out, prev)
      r.log(
        `note: ${outArg} carries no ${JOIN_RECORD_NAME} (joined by an older vos), so its inputs are matched by the footage it holds; a video file joined then was re-encoded on the way in and reads as new`,
      )
    }
    // The record's paths are relative to the take; the done line says them
    // from where the command runs.
    rejoined = rejoinDocs(migrateMotion(prev), record, read, {
      where: (p) => relative(process.cwd(), resolve(out, p)) || '.',
    })
    plan = rejoined.plan
  } else plan = joinDocs(parts)
  // A re-join captions and re-plans only the media it added.
  const only = rejoined ? rejoined.newIds : undefined
  const labelOf = new Map<string, string>([
    ['', positionals[0]],
    ...plan.media.map((m) => [m.id, m.label] as [string, string]),
  ])
  let captions: StepCaptionReport | null = null
  if (withCaptions) {
    captions = landStepCaptions(plan.doc, plan.actions, { only })
    for (const k of captions.uncaptioned)
      plan.notes.push(
        `no step in ${labelOf.get(k) ?? `media ${k}`} carries a caption`,
      )
  }
  let perBeat: PerBeatReport | null = null
  if (zoomMode === 'per-beat')
    perBeat = oneZoomPerBeat(plan.doc, plan.actions, { only })

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

  if (rejoined) {
    // In place: everything else in the take (its vos.json, a score's
    // track, renders) stays; a media that went takes its directory.
    for (const k of rejoined.dropped) {
      if (!/^[A-Za-z0-9_-]+$/.test(k)) continue
      const dir = join(out, k)
      if (existsSync(dir) && statSync(dir).isDirectory())
        await rm(dir, { recursive: true, force: true })
    }
  } else {
    if (existsSync(out)) await rm(out, { recursive: true, force: true })
    await mkdir(out, { recursive: true })
  }
  for (const c of plan.copies) {
    const to = join(out, c.to)
    await mkdir(dirname(to), { recursive: true })
    if (c.remux) {
      const remuxed = await copyRecording(c.from, to, c.remux)
      // Node decodes no compressed audio, so a file whose sound it cannot
      // read is copied as it is; the render reads it in the browser.
      if (!remuxed && c.remux !== 'mov')
        plan.notes.push(
          `could not read ${basename(c.from)}'s audio in Node, so it was copied as it is; its length comes from the container`,
        )
    } else await copyFile(c.from, to)
  }
  const doc = plan.doc
  // The sound the join added carries what its file measures, so a target
  // can be set on it later without decoding it again. A file that cannot
  // be measured here is copied all the same, and said.
  const added = new Set(
    plan.media
      .filter((m) => !only || only.has(m.id))
      .map((m) => `${m.id}-sound`),
  )
  for (const clip of doc.audio) {
    if (!added.has(clip.id) || !isTakeRelativeKey(clip.key)) continue
    try {
      const m = await measureTrack(join(out, takeRelativeFile(clip.key)))
      if (m.lufs !== null)
        clip.loudness = loudnessFact(
          { lufs: m.lufs, peakDb: m.peakDb },
          clip.key,
        )
    } catch (e) {
      plan.notes.push(
        `could not measure audio clip ${clip.id}'s loudness (${(e instanceof Error ? e.message : String(e)).split('\n')[0]}); vos audio measure ${outArg} tries again`,
      )
    }
  }
  await writeJson(join(out, 'meta.json'), doc.source.meta, true)
  if (doc.source.cursor.length)
    await writeJson(join(out, 'cursor.json'), doc.source.cursor)
  if (parts[0].actions)
    await writeJson(join(out, 'actions.json'), parts[0].actions, true)
  await writeJson(join(out, 'doc.json'), doc, true)
  await writeJson(
    join(out, JOIN_RECORD_NAME),
    joinRecordOf(read, plan.ids),
    true,
  )

  const extents = segmentOutputExtents(doc)
  const length = extents.length ? extents[extents.length - 1].end : 0
  for (const n of plan.notes) r.log(`note: ${n}`)
  for (const w of lint.warnings) r.log(`warning: ${w}`)
  // A re-join captions and re-plans its new inputs alone: say which, or
  // that there were none, never a count over inputs it did not look at.
  // A re-join captions and re-plans its new inputs alone: say which, or
  // that there were none, never a count over inputs it did not look at;
  // and an input with no recorded steps (a video file) is said as such.
  const stepCount = (id: string): number =>
    (doc.media ?? []).find((m) => m.id === id)?.meta.steps?.length ?? 0
  const newMedia = only ? plan.media.filter((m) => only.has(m.id)) : []
  const stepped = newMedia.filter((m) => stepCount(m.id) > 0)
  const bare = newMedia.filter((m) => stepCount(m.id) === 0)
  const bareWords = bare.length
    ? `${bare.map((m) => m.label).join(', ')} ${bare.length === 1 ? 'has' : 'have'} no recorded steps`
    : ''
  const onNew = only ? ` on ${stepped.map((m) => m.label).join(', ')}` : ''
  const captionLine = !captions
    ? ''
    : only && !newMedia.length
      ? '\n  --captions: no new input to caption (a re-join captions only the inputs it adds; the kept ones keep their captions as edited)'
      : only && !stepped.length
        ? `\n  --captions: ${bareWords}, so there is nothing to caption`
        : `\n  ${captions.landed.length} step caption${captions.landed.length === 1 ? '' : 's'} landed${onNew}` +
          (captions.skipped.length
            ? `; not landed: ${captions.skipped.join('; ')}`
            : '') +
          (bareWords ? `; ${bareWords}` : '')
  const beatLine = !perBeat
    ? ''
    : only && !newMedia.length
      ? '\n  --zooms per-beat: no new input to re-plan (a re-join re-plans only the inputs it adds; the kept ones keep their zooms as edited)'
      : only && !stepped.length
        ? `\n  --zooms per-beat: ${bareWords}, so there are no beats to plan`
        : `\n  ${only ? `${stepped.map((m) => m.label).join(', ')}: ` : ''}${perBeatLine(perBeat, (k) => labelOf.get(k) ?? `media ${k}`)}${bareWords ? `; ${bareWords}` : ''}`
  const rejoinText = rejoined
    ? rejoinLines(rejoined.report)
        .map((l) => `\n  ${l}`)
        .join('')
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
      ...(perBeat ? { perBeat } : {}),
      ...(rejoined ? { keptEdits: rejoined.report } : {}),
    },
    `${rejoined ? 'Joined again, keeping the edits:' : 'Joined'} ${parts.length} inputs → ${out} (${length.toFixed(1)}s, ${doc.segments.length} segments)\n  ${positionals[0]} is the primary; ${plan.media.map((m) => `${m.label} → ${m.id}`).join(', ')}${rejoinText}${captionLine}${beatLine}\n  Next: vos info ${outArg}; vos frames ${outArg} --times 0,25%,50%,75%,100%; vos render ${outArg}`,
  )
  return EXIT_OK
}
