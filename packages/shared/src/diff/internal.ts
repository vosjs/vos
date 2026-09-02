import type { Op } from './types'

export type AnyRecord = Record<string, unknown>

export function isRecord(v: unknown): v is AnyRecord {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => deepEqual(a[k], b[k]))
  }
  return false
}

/**
 * Shallow property diff of two node objects: changed keys → [from, to].
 * Nested values compare deep but report as whole-value pairs — span/clip
 * props are overwhelmingly scalars, and a whole-value pair stays honest for
 * the rest. `ignore` keys (identity fields) never report.
 */
export function shallowDiff(
  a: AnyRecord,
  b: AnyRecord,
  ignore: ReadonlySet<string> = new Set(),
): Record<string, [unknown, unknown]> | undefined {
  const props: Record<string, [unknown, unknown]> = {}
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  for (const k of keys) {
    if (ignore.has(k)) continue
    if (!deepEqual(a[k], b[k])) props[k] = [a[k], b[k]]
  }
  return Object.keys(props).length ? props : undefined
}

/**
 * Diff two id-keyed node lists into add/remove/modify ops. Identity is the
 * id — a moved span with the same id is a modify (the trap case); a
 * remove+add pair is two different nodes by construction.
 */
export function diffIdTrack(
  track: string,
  a: readonly AnyRecord[] | undefined,
  b: readonly AnyRecord[] | undefined,
): Op[] {
  const ops: Op[] = []
  const aById = new Map((a ?? []).map((n) => [String(n.id), n]))
  const bById = new Map((b ?? []).map((n) => [String(n.id), n]))
  for (const [id, node] of aById) {
    if (!bById.has(id)) {
      ops.push({ op: 'remove', track, id, props: pickAnchor(node) })
    }
  }
  for (const [id, node] of bById) {
    const prev = aById.get(id)
    if (!prev) {
      ops.push({ op: 'add', track, id, props: pickAnchor(node) })
      continue
    }
    const props = shallowDiff(prev, node, ID_KEYS)
    if (props) ops.push({ op: 'modify', track, id, props })
  }
  return ops
}

const ID_KEYS = new Set(['id'])

/**
 * Anchor props carried on add/remove ops so the summary can place the node
 * in time ("zoom z5 added (0.8s–2.4s)") without shipping the whole node.
 */
function pickAnchor(
  node: AnyRecord,
): Record<string, [unknown, unknown]> | undefined {
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of ['in', 'out', 'at', 'start', 'kind', 'key']) {
    if (node[k] !== undefined) out[k] = [undefined, node[k]]
  }
  return Object.keys(out).length ? out : undefined
}

/** Magnitude of a function-string change: max(lines added, lines removed). */
export function lineDelta(a: string, b: string): number {
  const count = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (const line of s.split('\n')) m.set(line, (m.get(line) ?? 0) + 1)
    return m
  }
  const ca = count(a)
  const cb = count(b)
  let removed = 0
  let added = 0
  for (const [line, n] of ca) removed += Math.max(0, n - (cb.get(line) ?? 0))
  for (const [line, n] of cb) added += Math.max(0, n - (ca.get(line) ?? 0))
  return Math.max(added, removed)
}
