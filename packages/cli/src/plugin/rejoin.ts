/**
 * `vos join … --out <take> --keep-edits`: join again over a joined take
 * that has been edited since, and keep the edits.
 *
 * A joined take is cut after the join: segments trimmed and reordered,
 * speed spans, zooms kept or rejected, captions written and anchored, the
 * frame, the sound, the still, the export. Joining again to add an input
 * (a cold open, a scene recorded later) or to reorder them used to rebuild
 * the document from the inputs and lose all of it. With `--keep-edits` the
 * edited document is the base, and the inputs only say what is new and
 * what is gone:
 *
 * - Inputs are matched to the media they became by their SOURCE FILE,
 *   never by position: the joined take keeps a `join.json` naming each
 *   input's path and the sha256 of its footage. The same footage at the
 *   same path is the same media (the same footage at a new path too: a
 *   moved directory); a path whose footage changed is a different
 *   recording, so its old media goes and the new one comes in fresh. A
 *   take joined before `join.json` existed is matched by the footage it
 *   holds (a take's footage is copied byte for byte), and a video file
 *   joined then reads as new, since the join re-encoded its container.
 * - A kept input keeps its media id, its media entry, and everything on it
 *   as edited: segments, every source-anchored span (zoom, speed, tilt,
 *   cam moves, freezes, rejections), its sound clip, and every layer
 *   anchored to one of its steps. The film-wide fields (frame, cursor,
 *   cam, export, styles) are the edited document's.
 * - A new input is joined the way a fresh join would join it, under an id
 *   no media ever held, and only its own media are re-planned (`--zooms
 *   per-beat`) or captioned (`--captions`).
 * - An input that is gone takes its edits with it, named: its segments,
 *   its spans, the layers anchored to it or placed over its footage, its
 *   sound clip.
 * - Order: while the kept inputs keep their relative order, the edited
 *   segment list stands as it is (a cold open moved to the front stays
 *   there) and a new input's segments go just before the first segment of
 *   the next kept input in argument order, or at the end. When the kept
 *   inputs' order changes, the segments are regrouped in argument order,
 *   each input's own segments keeping their edited order, and the report
 *   says so.
 * - A layer, prop, sound clip or still placed at an output second (no
 *   anchor) follows the segment it played in, so a new input before it
 *   does not slide it onto other footage; one past the footage (an ending)
 *   stays past the new end. A film-wide sound clip (a score) keeps its
 *   seconds, and the report names a changed length.
 * - The first input must be the take's primary, unchanged: the primary
 *   carries the cut's frame and camera, and a different one is a
 *   different film (join it afresh with --force).
 *
 * Pure (`rejoinDocs`); the I/O halves read and write `join.json` and hash
 * footage.
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  mediaKey,
  mediaRefId,
  ratedSegments,
  resolveAnchor,
  segmentOutputExtents,
} from '@vosjs/studio-core'
import { totalDuration } from '@vosjs/timeline'
import { UsageError } from './args'
import { joinDocs } from './join'
import { isTakeRelativeKey, takeRelativeFile } from './media'
import type { DocSegment, OverlayClip, ProjectDoc } from '@vosjs/studio-core'
import type { JoinPart, JoinPlan } from './join'

/** The record a joined take keeps of what it was joined from. */
export const JOIN_RECORD_NAME = 'join.json'

export interface JoinedInput {
  /** The input as given, relative to the joined take; '' when unknown. */
  path: string
  kind: 'take' | 'file'
  /** sha256 of the input's footage as the join read it. */
  footage: string
  /** The media id it became (`''` = the primary). */
  media: string
  /** Its own media's ids in the joined take, by their id in its document. */
  sub?: Record<string, string>
}

export interface JoinRecord {
  version: 1
  inputs: JoinedInput[]
}

/** One input of the new join, read: the part, its path relative to the take, its footage hash. */
export interface RejoinInput {
  part: JoinPart
  path: string
  footage: string
}

export interface RejoinReport {
  kept: { label: string; id: string; moved?: string }[]
  added: { label: string; id: string }[]
  dropped: {
    input: string
    id: string
    why: 'removed' | 'changed'
    segments: number
    spans: number
    layers: string[]
    sound: string[]
  }[]
  /** The kept inputs changed order, so the segments play in argument order again. */
  regrouped: boolean
  /** Layers, props, sound clips and the still that moved with their footage. */
  shifted: string[]
  notes: string[]
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** sha256 of a file, streamed. */
export function fileHash(file: string): Promise<string> {
  return new Promise((done, fail) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', fail)
      .on('end', () => done(h.digest('hex')))
  })
}

/** The fingerprint of an input's footage: its file's bytes, or a hosted key itself. */
export async function partFootage(part: JoinPart): Promise<string> {
  if (part.file) return fileHash(part.file.path)
  const key = part.doc.source.videoKey
  if (!isTakeRelativeKey(key))
    return `key:${createHash('sha256').update(key).digest('hex')}`
  const file = join(part.dir, takeRelativeFile(key))
  return existsSync(file)
    ? fileHash(file)
    : `key:${createHash('sha256').update(key).digest('hex')}`
}

/** The take's `join.json`, or null when it has none (or one this CLI cannot read). */
export async function readJoinRecord(dir: string): Promise<JoinRecord | null> {
  const file = join(dir, JOIN_RECORD_NAME)
  if (!existsSync(file)) return null
  try {
    const v = JSON.parse(await readFile(file, 'utf8')) as JoinRecord
    return v && v.version === 1 && Array.isArray(v.inputs) ? v : null
  } catch {
    return null
  }
}

/**
 * A record for a take joined before `join.json`: each media's footage as
 * the take holds it, in the document's order (the primary first). A
 * take's footage was copied byte for byte, so it matches its input.
 */
export async function recordFromFootage(
  dir: string,
  doc: ProjectDoc,
): Promise<JoinRecord> {
  const hash = async (key: string) => {
    if (!isTakeRelativeKey(key))
      return `key:${createHash('sha256').update(key).digest('hex')}`
    const file = join(dir, takeRelativeFile(key))
    return existsSync(file) ? fileHash(file) : `missing:${key}`
  }
  const inputs: JoinedInput[] = [
    {
      path: '',
      kind: 'take',
      footage: await hash(doc.source.videoKey),
      media: '',
    },
  ]
  for (const m of doc.media ?? [])
    inputs.push({
      path: '',
      kind: 'take',
      footage: await hash(m.videoKey),
      media: m.id,
    })
  return { version: 1, inputs }
}

/** The record a join writes beside its document. */
export function joinRecordOf(
  inputs: readonly { path: string; footage: string; part: JoinPart }[],
  ids: JoinPlan['ids'],
): JoinRecord {
  return {
    version: 1,
    inputs: inputs.map((x, i) => {
      const sub = ids[i]?.sub ?? {}
      return {
        path: x.path,
        kind: x.part.kind,
        footage: x.footage,
        media: ids[i]?.id ?? '',
        ...(Object.keys(sub).length ? { sub } : {}),
      }
    }),
  }
}

/**
 * Which new input is which old one. Two passes so a duplicate input (the
 * same take twice) pairs in order: the same footage at the same path,
 * then the same footage anywhere. A prior input whose path comes back
 * with other footage CHANGED; one that does not come back is REMOVED.
 */
export function matchInputs(
  prev: readonly JoinedInput[],
  next: readonly { path: string; footage: string }[],
): {
  match: (number | null)[]
  changed: number[]
  removed: number[]
} {
  const match: (number | null)[] = next.map(() => null)
  const claimed = new Set<number>()
  const pass = (same: (p: JoinedInput, n: { path: string }) => boolean) => {
    next.forEach((n, i) => {
      if (match[i] !== null) return
      const j = prev.findIndex(
        (p, k) => !claimed.has(k) && p.footage === n.footage && same(p, n),
      )
      if (j >= 0) {
        match[i] = j
        claimed.add(j)
      }
    })
  }
  pass((p, n) => p.path !== '' && p.path === n.path)
  pass(() => true)
  const changed: number[] = []
  const removed: number[] = []
  prev.forEach((p, j) => {
    if (claimed.has(j)) return
    const back =
      p.path !== '' &&
      next.some((n, i) => match[i] === null && n.path === p.path)
    ;(back ? changed : removed).push(j)
  })
  return { match, changed, removed }
}

/** A prior input's media keys: its own and its media's. */
const keysOf = (x: JoinedInput): string[] => [
  x.media,
  ...Object.values(x.sub ?? {}),
]

/**
 * Join `inputs` over `prev`, the joined take's edited document, keeping
 * its edits (see the module comment). Throws a UsageError when the first
 * input is not the take's primary.
 */
export function rejoinDocs(
  prev: ProjectDoc,
  record: JoinRecord,
  inputs: readonly RejoinInput[],
): {
  plan: JoinPlan
  report: RejoinReport
  newIds: Set<string>
  dropped: Set<string>
} {
  const { match, changed, removed } = matchInputs(record.inputs, inputs)
  const first = match[0] === null ? null : record.inputs[match[0]]
  if (!first || first.media !== '')
    throw new UsageError(
      `--keep-edits: ${inputs[0].part.label} is not the primary this take was joined from (its first input, footage unchanged). The primary carries the cut's frame and camera; keep it first, or join afresh with --force`,
    )

  // The kept inputs keep their ids; every id the take ever named stays
  // retired, so a new input never inherits an old media's edits.
  const parts: JoinPart[] = inputs.map((x, i) => {
    const j = match[i]
    if (i === 0 || j === null) return x.part
    const was = record.inputs[j]
    return { ...x.part, id: was.media, ...(was.sub ? { subIds: was.sub } : {}) }
  })
  const reserved = new Set<string>([
    ...record.inputs.flatMap(keysOf),
    ...(prev.media ?? []).map((m) => m.id),
  ])
  const fresh = joinDocs(parts, { reserved })

  // Which media keys stay, which are new, which go; and each key's input.
  const argOf = new Map<string, number>()
  const newIds = new Set<string>()
  const kept = new Set<string>()
  fresh.ids.forEach((ids, i) => {
    for (const k of [ids.id, ...Object.values(ids.sub)]) {
      argOf.set(k, i)
      if (match[i] === null) newIds.add(k)
    }
  })
  match.forEach((j, i) => {
    if (j === null) return
    for (const k of keysOf(record.inputs[j])) kept.add(k)
    // A kept input's media the record never named (a sub-media the take
    // grew since) stays with it.
    for (const k of [fresh.ids[i].id, ...Object.values(fresh.ids[i].sub)])
      kept.add(k)
  })
  kept.add('')
  const dropped = new Set<string>()
  for (const k of [
    ...record.inputs.flatMap(keysOf),
    ...(prev.media ?? []).map((m) => m.id),
  ])
    if (!kept.has(k)) dropped.add(k)

  const report: RejoinReport = {
    kept: [],
    added: [],
    dropped: [],
    regrouped: false,
    shifted: [],
    notes: [],
  }
  inputs.forEach((x, i) => {
    const j = match[i]
    if (j === null) {
      report.added.push({ label: x.part.label, id: fresh.ids[i].id })
      return
    }
    const was = record.inputs[j]
    report.kept.push({
      label: x.part.label,
      id: was.media,
      ...(was.path && was.path !== x.path ? { moved: was.path } : {}),
    })
  })

  const doc = structuredClone(prev)
  const keyOf = (s: { media?: string }) => mediaKey(s.media)

  // ── segments ──
  const prevSegments = prev.segments.length
    ? prev.segments
    : [{ in: 0, out: round3(prev.source.meta.durationMs / 1000) }]
  const prevExt = segmentOutputExtents(prev)
  const prevFootage = totalDuration(ratedSegments(prev))
  let segments: DocSegment[] = prevSegments.filter((s) => kept.has(keyOf(s)))
  // The kept inputs' order now against their order in the record.
  const keptOrder = match.filter((j): j is number => j !== null)
  const inOrder = keptOrder.every((j, k) => k === 0 || keptOrder[k - 1] < j)
  if (!inOrder) {
    report.regrouped = true
    segments = segments
      .map((s, at) => ({ s, at, arg: argOf.get(keyOf(s)) ?? 0 }))
      .sort((a, b) => a.arg - b.arg || a.at - b.at)
      .map((x) => x.s)
  }
  // Each new input's segments, as the fresh join cut them, go before the
  // next kept input's first segment in argument order, or at the end.
  const freshSegs = fresh.doc.segments
  const freshExt = segmentOutputExtents(fresh.doc)
  const firstFresh = new Map<number, number>()
  inputs.forEach((_, i) => {
    if (match[i] !== null) return
    const mine = freshSegs
      .map((s, at) => ({ s, at }))
      .filter((x) => argOf.get(keyOf(x.s)) === i)
    if (!mine.length) return
    firstFresh.set(i, mine[0].at)
    let at = segments.length
    for (let n = i + 1; n < inputs.length; n++) {
      if (match[n] === null) continue
      const k = segments.findIndex((s) => argOf.get(keyOf(s)) === n)
      if (k >= 0) {
        at = k
        break
      }
    }
    segments.splice(at, 0, ...mine.map((x) => x.s))
  })
  doc.segments = segments

  // ── media ──
  const freshMedia = new Map((fresh.doc.media ?? []).map((m) => [m.id, m]))
  const media = [
    ...(prev.media ?? [])
      .filter((m) => kept.has(m.id))
      .map((m) => {
        // A take joined before media carried their script gains it now.
        const f = freshMedia.get(m.id)
        return !m.script && f?.script ? { ...m, script: f.script } : m
      }),
    ...(fresh.doc.media ?? []).filter((m) => newIds.has(m.id)),
  ]
    .map((m, at) => ({ m, at, arg: argOf.get(m.id) ?? 0 }))
    .sort((a, b) => a.arg - b.arg || a.at - b.at)
    .map((x) => x.m)
  if (media.length) doc.media = media
  else delete doc.media

  // ── source-anchored spans ──
  const spanLanes = [
    'zoom',
    'speed',
    'tilt',
    'camMotion',
    'freeze',
    'rejected',
  ] as const
  const dropCount = new Map<string, { segments: number; spans: number }>()
  const tally = (k: string, what: 'segments' | 'spans') => {
    const c = dropCount.get(k) ?? { segments: 0, spans: 0 }
    c[what]++
    dropCount.set(k, c)
  }
  for (const s of prevSegments)
    if (dropped.has(keyOf(s))) tally(keyOf(s), 'segments')
  for (const lane of spanLanes) {
    const before = (prev[lane] ?? []) as { media?: string }[]
    for (const s of before) if (dropped.has(keyOf(s))) tally(keyOf(s), 'spans')
    const next = [
      ...before.filter((s) => kept.has(keyOf(s))),
      ...((fresh.doc[lane] ?? []) as { media?: string }[]).filter((s) =>
        newIds.has(keyOf(s)),
      ),
    ]
    if (next.length) (doc as unknown as Record<string, unknown>)[lane] = next
    else delete (doc as unknown as Record<string, unknown>)[lane]
  }

  // ── output-time placement ──
  const newExt = segmentOutputExtents(doc)
  const newFootage = totalDuration(ratedSegments(doc))
  const placeOf = new Map<DocSegment, number>()
  segments.forEach((s, i) => placeOf.set(s, i))
  /** Where an output second of the old cut plays now; null = over footage that is gone. */
  const follow = (t: number): number | null => {
    for (let i = 0; i < prevExt.length; i++) {
      const e = prevExt[i]
      if (t >= e.start - 1e-6 && t < e.end - 1e-6) {
        const at = placeOf.get(prevSegments[i])
        if (at === undefined) return null
        const moved = newExt[at].start + (t - e.start)
        return Math.abs(moved - t) < 1e-9 ? t : round3(moved)
      }
    }
    if (t >= prevFootage - 1e-6) {
      const moved = newFootage + (t - prevFootage)
      return Math.abs(moved - t) < 1e-9 ? t : round3(moved)
    }
    return t
  }
  /** A new input's own placements, from where the fresh join cut it to where it plays now. */
  const deltaOf = (k: string): number => {
    const i = argOf.get(k)
    if (i === undefined) return 0
    const at = firstFresh.get(i)
    if (at === undefined) return 0
    const now = placeOf.get(freshSegs[at])
    return now === undefined ? 0 : newExt[now].start - freshExt[at].start
  }
  const droppedItems = new Map<string, { layers: string[]; sound: string[] }>()
  const lose = (k: string, what: 'layers' | 'sound', id: string) => {
    const c = droppedItems.get(k) ?? { layers: [], sound: [] }
    c[what].push(id)
    droppedItems.set(k, c)
  }
  /** Which input's footage an output second of the old cut played over. */
  const footageAt = (t: number): string | null => {
    for (let i = 0; i < prevExt.length; i++) {
      const e = prevExt[i]
      if (t >= e.start - 1e-6 && t < e.end - 1e-6) return keyOf(prevSegments[i])
    }
    return null
  }

  // Layers: the edited ones, then a new input's.
  const overlays: OverlayClip[] = []
  for (const o of prev.overlays ?? []) {
    const refMedia =
      o.kind !== 'text' && o.kind !== 'html' ? mediaRefId(o.key) : null
    const owner = o.anchor ? mediaKey(o.anchor.media) : null
    const gone =
      (owner !== null && dropped.has(owner) && owner) ||
      (refMedia !== null && dropped.has(refMedia) && refMedia) ||
      null
    if (gone) {
      lose(gone, 'layers', o.id)
      continue
    }
    if (o.anchor) {
      overlays.push(o)
      continue
    }
    const t = follow(o.start)
    if (t === null) {
      lose(footageAt(o.start) ?? '', 'layers', o.id)
      continue
    }
    if (t !== o.start) report.shifted.push(o.id)
    overlays.push(t === o.start ? o : { ...o, start: t })
  }
  for (const o of fresh.doc.overlays ?? []) {
    const k = fresh.owners.get(o.id)
    if (k === undefined || !newIds.has(k)) continue
    const d = o.anchor ? 0 : deltaOf(k)
    overlays.push(d ? { ...o, start: round3(o.start + d) } : o)
  }
  if (overlays.length) doc.overlays = overlays
  else delete doc.overlays

  // 3D props, the same way.
  const objects: NonNullable<ProjectDoc['objects']> = []
  for (const ob of prev.objects ?? []) {
    if (!ob.span) {
      objects.push(ob)
      continue
    }
    const t = follow(ob.span.start)
    if (t === null) {
      lose(footageAt(ob.span.start) ?? '', 'layers', ob.id)
      continue
    }
    if (t !== ob.span.start) report.shifted.push(ob.id)
    objects.push(
      t === ob.span.start ? ob : { ...ob, span: { ...ob.span, start: t } },
    )
  }
  for (const ob of fresh.doc.objects ?? []) {
    const k = fresh.owners.get(ob.id)
    if (k === undefined || !newIds.has(k)) continue
    const d = deltaOf(k)
    objects.push(
      d && ob.span
        ? { ...ob, span: { ...ob.span, start: round3(ob.span.start + d) } }
        : ob,
    )
  }
  if (objects.length) doc.objects = objects
  else delete doc.objects

  // Sound: a media's own clip follows its media; a film-wide one keeps its seconds.
  const allPrev = new Set([...dropped, ...kept])
  const audio: ProjectDoc['audio'] = []
  for (const a of prev.audio) {
    const m = /^(.*)-sound$/.exec(a.id)
    const k = m && allPrev.has(m[1]) ? m[1] : null
    if (k === null) {
      audio.push(a)
      continue
    }
    if (dropped.has(k)) {
      lose(k, 'sound', a.id)
      continue
    }
    const t = follow(a.start)
    if (t === null) {
      lose(k, 'sound', a.id)
      continue
    }
    if (t !== a.start) report.shifted.push(a.id)
    audio.push(t === a.start ? a : { ...a, start: t })
  }
  for (const a of fresh.doc.audio) {
    const k = fresh.owners.get(a.id)
    if (k === undefined || !newIds.has(k)) continue
    const d = deltaOf(k)
    audio.push(d ? { ...a, start: round3(a.start + d) } : a)
  }
  doc.audio = audio

  // The cover moment, an output second the author chose.
  if (typeof prev.still === 'number') {
    const t = follow(prev.still)
    if (t === null) {
      delete doc.still
      report.notes.push(
        `the still (${prev.still.toFixed(2)} s) played over footage that is gone; the cover falls back to its default (vos push --still sets one)`,
      )
    } else if (t !== prev.still) {
      doc.still = t
      report.shifted.push('still')
    }
  }

  // Every anchored layer's fallback start is where it plays now.
  const pieces = ratedSegments(doc)
  if (doc.overlays)
    doc.overlays = doc.overlays.map((o) => {
      if (!o.anchor) return o
      const r = resolveAnchor(doc, o.anchor, pieces)
      return r.start !== null && r.start !== o.start
        ? { ...o, start: r.start }
        : o
    })
  // An ending anchored to a step (an end card on the last input's last
  // step) stays on its step, which may no longer be the end: say so.
  const prevPieces = ratedSegments(prev)
  const wasEnding = new Set(
    (prev.overlays ?? [])
      .filter((o) => {
        if (!o.anchor) return false
        const r = resolveAnchor(prev, o.anchor, prevPieces)
        return r.start !== null && r.start >= prevFootage - 1e-3
      })
      .map((o) => o.id),
  )
  const overrun = (doc.overlays ?? [])
    .filter((o) => wasEnding.has(o.id) && o.start < newFootage - 1e-3)
    .map((o) => o.id)
  if (overrun.length)
    report.notes.push(
      `${overrun.join(', ')} played after the footage and, anchored to ${overrun.length === 1 ? 'its' : 'their'} step, now ${overrun.length === 1 ? 'lands' : 'land'} over the footage that follows; anchor ${overrun.length === 1 ? 'it' : 'them'} to the last input's end, or move ${overrun.length === 1 ? 'it' : 'them'}`,
    )

  // What went, per input.
  const labelOf = (k: string): string => {
    const x = record.inputs.find((r) => keysOf(r).includes(k))
    return x?.path || (k ? `media ${k}` : 'the primary')
  }
  for (const j of [...changed, ...removed]) {
    const x = record.inputs[j]
    for (const k of keysOf(x)) {
      const c = dropCount.get(k) ?? { segments: 0, spans: 0 }
      const items = droppedItems.get(k) ?? { layers: [], sound: [] }
      report.dropped.push({
        input: labelOf(k),
        id: k,
        why: changed.includes(j) ? 'changed' : 'removed',
        segments: c.segments,
        spans: c.spans,
        layers: items.layers,
        sound: items.sound,
      })
    }
  }
  // A media in the document the record never named (and so no input).
  for (const k of dropped) {
    if (report.dropped.some((d) => d.id === k)) continue
    const c = dropCount.get(k) ?? { segments: 0, spans: 0 }
    const items = droppedItems.get(k) ?? { layers: [], sound: [] }
    report.dropped.push({
      input: `media ${k}`,
      id: k,
      why: 'removed',
      segments: c.segments,
      spans: c.spans,
      layers: items.layers,
      sound: items.sound,
    })
  }
  if (Math.abs(newFootage - prevFootage) > 1e-3) {
    const film = doc.audio.filter((a) => !/-sound$/.test(a.id))
    if (film.length)
      report.notes.push(
        `the footage now runs ${newFootage.toFixed(2)} s (was ${prevFootage.toFixed(2)} s); ${film.map((a) => a.id).join(', ')} kept ${film.length === 1 ? 'its' : 'their'} seconds (vos score places a score again)`,
      )
  }

  // A new input's notes only: the kept ones' were said at their join.
  const newLabels = inputs
    .filter((_, i) => match[i] === null)
    .map((x) => x.part.label)
  const notes = fresh.notes.filter((n) =>
    newLabels.some((l) => n.startsWith(`${l}:`)),
  )
  const copies = fresh.copies.filter((c) =>
    [...newIds].some((k) => k !== '' && c.to.startsWith(`${k}/`)),
  )
  return {
    plan: {
      doc,
      copies,
      media: fresh.media,
      actions: fresh.actions,
      notes,
      ids: fresh.ids,
      owners: fresh.owners,
    },
    report,
    newIds,
    dropped,
  }
}

/** The report in words, for the done line. */
export function rejoinLines(r: RejoinReport): string[] {
  const lines: string[] = []
  const n = (v: number, one: string, many = `${one}s`) =>
    `${v} ${v === 1 ? one : many}`
  if (r.kept.length)
    lines.push(
      `kept the edits of ${r.kept.map((k) => `${k.label} (${k.id || 'primary'}${k.moved ? `, found at its new path; was ${k.moved}` : ''})`).join(', ')}`,
    )
  if (r.added.length)
    lines.push(`added ${r.added.map((a) => `${a.label} → ${a.id}`).join(', ')}`)
  for (const d of r.dropped) {
    const what = [
      n(d.segments, 'segment'),
      n(d.spans, 'span'),
      ...(d.layers.length ? [`layers ${d.layers.join(', ')}`] : []),
      ...(d.sound.length ? [`sound ${d.sound.join(', ')}`] : []),
    ].join(', ')
    lines.push(
      `dropped ${d.input} (${d.id || 'primary'}): ${d.why === 'changed' ? 'its footage changed since the join' : 'no longer an input'}; ${what} went with it`,
    )
  }
  if (r.regrouped)
    lines.push(
      'the inputs changed order, so the segments play in argument order again (each input’s own segments in their edited order)',
    )
  if (r.shifted.length)
    lines.push(
      `${r.shifted.join(', ')} moved with the footage ${r.shifted.length === 1 ? 'it plays' : 'they play'} over`,
    )
  lines.push(...r.notes)
  return lines
}
