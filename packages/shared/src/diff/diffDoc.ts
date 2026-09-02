import { diffConfig } from './diffConfig'
import { deepEqual, diffIdTrack, isRecord, shallowDiff } from './internal'
import type { AnyRecord } from './internal'
import type { Op } from './types'

/**
 * Semantic diff over two ProjectDoc states (wired end-to-end once hosted
 * versions persist take docs). Every editable node has a stable id, so id-keyed
 * tracks diff exactly; singleton surfaces report as scoped modifies. Typed
 * structurally (Record-based) — the differ must not depend on studio-core.
 */

/** Track name → doc field, for the id-keyed span/clip tracks. */
const ID_TRACKS: readonly [track: string, field: string][] = [
  ['zoom', 'zoom'],
  ['tilt', 'tilt'],
  ['camMove', 'camMotion'],
  ['speed', 'speed'],
  ['rejected', 'rejected'],
  ['overlay', 'overlays'],
  ['object', 'objects'],
  ['audio', 'audio'],
]

/** Singleton surfaces that report as one scoped modify each. */
const SCOPED_FIELDS = ['frame', 'cursor', 'cam', 'export'] as const

export function diffDoc(a: AnyRecord, b: AnyRecord): Op[] {
  const ops: Op[] = []

  // The program anchor: its config diffs as a program does (code /
  // knob / data / look / config tracks), and its tween-timing overlay as
  // one `tween` track keyed by spec index.
  const pa = isRecord(a.program) ? a.program : undefined
  const pb = isRecord(b.program) ? b.program : undefined
  if (pa || pb) {
    ops.push(
      ...diffConfig(
        pa && isRecord(pa.config) ? pa.config : {},
        pb && isRecord(pb.config) ? pb.config : {},
      ),
    )
    const ea = pa && isRecord(pa.tweenEdits) ? pa.tweenEdits : {}
    const eb = pb && isRecord(pb.tweenEdits) ? pb.tweenEdits : {}
    for (const key of new Set([...Object.keys(ea), ...Object.keys(eb)])) {
      const va = isRecord(ea[key]) ? ea[key] : undefined
      const vb = isRecord(eb[key]) ? eb[key] : undefined
      if (va && !vb) ops.push({ op: 'remove', track: 'tween', id: `#${key}` })
      else if (!va && vb) ops.push({ op: 'add', track: 'tween', id: `#${key}` })
      else if (va && vb) {
        const props = shallowDiff(va, vb)
        if (props)
          ops.push({ op: 'modify', track: 'tween', id: `#${key}`, props })
      }
    }
    // A changed `program.duration` (the anchor's own length) reports as the
    // config's duration would; the config's own duration already did above.
    const da = programLength(pa)
    const db = programLength(pb)
    if (
      da !== db &&
      (pa?.duration !== undefined || pb?.duration !== undefined)
    ) {
      ops.push({
        op: 'modify',
        track: 'config',
        id: 'duration',
        props: { value: [da, db] },
      })
    }
  }

  for (const [track, field] of ID_TRACKS) {
    ops.push(...diffIdTrack(track, asNodeList(a[field]), asNodeList(b[field])))
  }

  // A speed edit's cost in OUTPUT seconds rides the first
  // speed op, so the history line says what the cut gained or lost
  // ("speed sp0: rate 2→4, output 25s→22.5s").
  const speedOps = ops.filter((o) => o.track === 'speed')
  if (speedOps.length) {
    const [oa, ob] = [outputDuration(a), outputDuration(b)]
    if (oa !== null && ob !== null && Math.abs(oa - ob) >= 0.05) {
      speedOps[0].props = { ...(speedOps[0].props ?? {}), output: [oa, ob] }
    }
  }

  // Segments: the trim surface. Report count + kept-duration movement, not
  // the raw arrays (payloads stay small; the compare player shows the rest).
  const aSeg = asNodeList(a.segments) ?? []
  const bSeg = asNodeList(b.segments) ?? []
  if (!deepEqual(a.segments, b.segments)) {
    const props: Record<string, [unknown, unknown]> = {}
    if (aSeg.length !== bSeg.length) props.count = [aSeg.length, bSeg.length]
    const [da, db] = [keptDuration(aSeg), keptDuration(bSeg)]
    if (da !== db) props.duration = [da, db]
    ops.push({
      op: 'modify',
      track: 'segments',
      id: 'segments',
      props: Object.keys(props).length
        ? props
        : { value: ['edited', 'edited'] },
    })
  }

  for (const field of SCOPED_FIELDS) {
    const va = a[field]
    const vb = b[field]
    const fa = isRecord(va) ? va : {}
    const fb = isRecord(vb) ? vb : {}
    const props = shallowDiff(fa, fb)
    if (props) ops.push({ op: 'modify', track: field, id: field, props })
  }

  // Camera personality: style + overrides + wand intensity as ONE surface.
  const cameraProps: Record<string, [unknown, unknown]> = {}
  for (const k of ['zoomStyle', 'tiltStyle', 'micGain'] as const) {
    if (!deepEqual(a[k], b[k])) cameraProps[k] = [a[k], b[k]]
  }
  if (!deepEqual(a.zoomParams, b.zoomParams)) {
    cameraProps.zoomParams = [a.zoomParams, b.zoomParams]
  }
  if (Object.keys(cameraProps).length) {
    ops.push({
      op: 'modify',
      track: 'camera',
      id: 'camera',
      props: cameraProps,
    })
  }

  return ops
}

function asNodeList(v: unknown): AnyRecord[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter(isRecord)
}

/**
 * OUTPUT duration of a doc: kept segments with speed spans applied — the
 * same arithmetic the lowering's rate map performs, kept structural so the
 * differ stays dependency-free. Null when the doc cannot say (no source
 * duration and no explicit segments).
 */
function programLength(program: AnyRecord | undefined): number | null {
  if (!program) return null
  if (typeof program.duration === 'number') return program.duration
  const cfg = isRecord(program.config) ? program.config : undefined
  return cfg && typeof cfg.duration === 'number' ? cfg.duration : null
}

function outputDuration(doc: AnyRecord): number | null {
  // A program document is one source span, its own length: its speed
  // spans rate it the way a recording's rate the footage.
  const source = isRecord(doc.source) ? doc.source : undefined
  const meta = source && isRecord(source.meta) ? source.meta : undefined
  const durS = isRecord(doc.program)
    ? programLength(doc.program)
    : meta && typeof meta.durationMs === 'number'
      ? meta.durationMs / 1000
      : null
  const explicit = (asNodeList(doc.segments) ?? [])
    .map((s) => ({
      in: typeof s.in === 'number' ? s.in : 0,
      out: typeof s.out === 'number' ? s.out : 0,
    }))
    .filter((s) => s.out > s.in)
  const segments = explicit.length
    ? explicit
    : durS !== null
      ? [{ in: 0, out: durS }]
      : null
  if (!segments) return null
  const spans = (asNodeList(doc.speed) ?? [])
    .map((s) => ({
      in: typeof s.in === 'number' ? s.in : 0,
      out: typeof s.out === 'number' ? s.out : 0,
      rate: typeof s.rate === 'number' && s.rate > 0 ? s.rate : 1,
    }))
    .filter((s) => s.out > s.in)
  let total = 0
  for (const seg of segments) {
    total += seg.out - seg.in
    for (const sp of spans) {
      const ov = Math.min(seg.out, sp.out) - Math.max(seg.in, sp.in)
      if (ov > 0) total -= ov - ov / sp.rate
    }
  }
  return Math.round(total * 1000) / 1000
}

function keptDuration(segments: AnyRecord[]): number {
  let total = 0
  for (const s of segments) {
    const start = typeof s.in === 'number' ? s.in : 0
    const end = typeof s.out === 'number' ? s.out : start
    total += Math.max(0, end - start)
  }
  return Math.round(total * 1000) / 1000
}
