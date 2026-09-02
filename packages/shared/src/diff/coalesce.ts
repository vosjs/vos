import { opKey } from './types'
import type { Op } from './types'

/**
 * Net effect per node across a sequence of op sets (the coalescing rules):
 * initial→final only, no intermediate drags. add→modify folds into the add;
 * add→remove vanishes; modify chains keep the first `from` and last `to`
 * (dropping props that net to no change); remove→add of the same id is one
 * modify (the node was replaced in place). Output is deterministically
 * ordered: track declaration order, then output-time anchor, then id.
 */
export function coalesce(opsInOrder: readonly Op[]): Op[] {
  const byNode = new Map<string, Op>()

  for (const next of opsInOrder) {
    const key = opKey(next)
    const prev = byNode.get(key)
    if (!prev) {
      byNode.set(key, cloneOp(next))
      continue
    }
    const folded = foldPair(prev, next)
    if (folded) byNode.set(key, folded)
    else byNode.delete(key)
  }

  return [...byNode.values()].sort(compareOps)
}

function foldPair(prev: Op, next: Op): Op | null {
  // add then remove: the node never existed for the reader.
  if (prev.op === 'add' && next.op === 'remove') return null
  // add then modify: still an add, with the final properties.
  if (prev.op === 'add' && next.op === 'modify') {
    return { ...prev, props: mergeProps(prev.props, next.props) }
  }
  // modify then remove: the removal is the story.
  if (next.op === 'remove') return { ...next }
  // remove then add: replaced in place — one modify.
  if (prev.op === 'remove' && next.op === 'add') {
    return { ...next, op: 'modify', props: mergeProps(prev.props, next.props) }
  }
  // modify then modify: first from, last to; drop props that net out.
  if (prev.op === 'modify' && next.op === 'modify') {
    const merged = mergeProps(prev.props, next.props, true)
    const lines =
      prev.lines !== undefined || next.lines !== undefined
        ? (prev.lines ?? 0) + (next.lines ?? 0)
        : undefined
    if (!merged && lines === undefined) return null
    return { ...prev, props: merged, lines }
  }
  // Remaining combinations (add→add, remove→remove) shouldn't occur between
  // well-formed sets; keep the latest as the honest answer.
  return { ...next }
}

function mergeProps(
  a: Op['props'],
  b: Op['props'],
  dropNoNet = false,
): Op['props'] {
  if (!a) return b ? { ...b } : undefined
  if (!b) return { ...a }
  const out: NonNullable<Op['props']> = { ...a }
  for (const [k, [from, to]] of Object.entries(b)) {
    out[k] = k in out ? [out[k][0], to] : [from, to]
  }
  if (dropNoNet) {
    for (const [k, [from, to]] of Object.entries(out)) {
      if (JSON.stringify(from) === JSON.stringify(to)) delete out[k]
    }
  }
  return Object.keys(out).length ? out : undefined
}

function cloneOp(op: Op): Op {
  return { ...op, props: op.props ? { ...op.props } : undefined }
}

/** Track presentation order: content tracks in output order, then meta. */
const TRACK_ORDER = [
  'segments',
  'frame',
  'camera',
  'cursor',
  'cam',
  'zoom',
  'tilt',
  'speed',
  'overlay',
  'object',
  'audio',
  'export',
  'knob',
  'look',
  'data',
  'code',
  'config',
]

function compareOps(a: Op, b: Op): number {
  const ta = TRACK_ORDER.indexOf(a.track)
  const tb = TRACK_ORDER.indexOf(b.track)
  if (ta !== tb) return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb)
  const anchorA = timeAnchor(a)
  const anchorB = timeAnchor(b)
  if (anchorA !== anchorB) return anchorA - anchorB
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

function timeAnchor(op: Op): number {
  for (const k of ['in', 'at', 'start']) {
    const pair = op.props?.[k]
    if (pair) {
      const v = pair[1] ?? pair[0]
      if (typeof v === 'number') return v
    }
  }
  return Number.MAX_SAFE_INTEGER
}
