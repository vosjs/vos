import {
  deepEqual,
  diffIdTrack,
  isRecord,
  lineDelta,
  shallowDiff,
} from './internal'
import type { AnyRecord } from './internal'
import type { Op } from './types'

/**
 * Semantic diff over two VosConfigJson states: param keys are
 * program mode's stable ids, so knob values and specs diff fully typed;
 * function-string bodies collapse to a magnitude ("createContent changed,
 * 12 lines") — the accepted asymmetry, in the direction nobody reads JSON.
 */

const FUNCTION_FIELDS = ['setup', 'createContent', 'createTimeline', 'onFrame']

/** Top-level structured fields worth reporting individually. */
const CONFIG_FIELDS = ['duration', 'camera', 'postprocessing', 'elements']

export function diffConfig(a: AnyRecord, b: AnyRecord): Op[] {
  const ops: Op[] = []

  const aParams = paramsByKey(a)
  const bParams = paramsByKey(b)
  const aData = isRecord(a.data) ? a.data : {}
  const bData = isRecord(b.data) ? b.data : {}

  // --- Knobs: spec + value changes, keyed by param key -------------------
  const removedKeys: string[] = []
  const addedKeys: string[] = []
  for (const key of aParams.keys()) if (!bParams.has(key)) removedKeys.push(key)
  for (const key of bParams.keys()) if (!aParams.has(key)) addedKeys.push(key)

  // Rename detection (the "replaced knob" trap): a removed and an added key
  // whose specs match ignoring identity/labeling are ONE knob renamed.
  const renamed = new Map<string, string>() // old → new
  for (const oldKey of [...removedKeys]) {
    const oldSpec = aParams.get(oldKey)!
    const match = addedKeys.find((newKey) =>
      specEqualIgnoringIdentity(oldSpec, bParams.get(newKey)!),
    )
    if (match) {
      renamed.set(oldKey, match)
      removedKeys.splice(removedKeys.indexOf(oldKey), 1)
      addedKeys.splice(addedKeys.indexOf(match), 1)
    }
  }

  for (const [oldKey, newKey] of renamed) {
    const props: Record<string, [unknown, unknown]> = {
      key: [oldKey, newKey],
    }
    const fromVal = valueOf(aData, aParams.get(oldKey)!, oldKey)
    const toVal = valueOf(bData, bParams.get(newKey)!, newKey)
    if (!deepEqual(fromVal, toVal)) props.value = [fromVal, toVal]
    ops.push({ op: 'modify', track: 'knob', id: newKey, props })
  }
  for (const key of removedKeys) {
    ops.push({ op: 'remove', track: 'knob', id: key })
  }
  for (const key of addedKeys) {
    const spec = bParams.get(key)!
    ops.push({
      op: 'add',
      track: 'knob',
      id: key,
      props: {
        kind: [undefined, spec.kind],
        value: [undefined, valueOf(bData, spec, key)],
      },
    })
  }
  for (const [key, aSpec] of aParams) {
    const bSpec = bParams.get(key)
    if (!bSpec) continue
    const props: Record<string, [unknown, unknown]> = {}
    const aVal = valueOf(aData, aSpec, key)
    const bVal = valueOf(bData, bSpec, key)
    if (!deepEqual(aVal, bVal)) props.value = [aVal, bVal]
    const specDiff = shallowDiff(aSpec, bSpec, KNOB_IDENTITY)
    if (specDiff) {
      // Default changes only matter when they aren't already the value change
      // (applyParamValue bakes default AND data together).
      if ('default' in specDiff && 'value' in props) delete specDiff.default
      Object.assign(props, specDiff)
    }
    if (Object.keys(props).length) {
      ops.push({ op: 'modify', track: 'knob', id: key, props })
    }
  }

  // --- Data keys not declared as knobs ------------------------------------
  const declared = new Set([...aParams.keys(), ...bParams.keys()])
  const dataKeys = [
    ...new Set([...Object.keys(aData), ...Object.keys(bData)]),
  ].sort()
  for (const key of dataKeys) {
    if (declared.has(key)) continue
    const from = aData[key]
    const to = bData[key]
    if (deepEqual(from, to)) continue
    const op: Op['op'] =
      from === undefined ? 'add' : to === undefined ? 'remove' : 'modify'
    ops.push({ op, track: 'data', id: key, props: { value: [from, to] } })
  }

  // --- Looks (presets), keyed by name -------------------------------------
  ops.push(
    ...diffIdTrack('look', looksAsNodes(a.presets), looksAsNodes(b.presets)),
  )

  // --- Function strings collapse to magnitude -----------------------------
  for (const fn of FUNCTION_FIELDS) {
    const va = a[fn]
    const vb = b[fn]
    const fa = typeof va === 'string' ? va : ''
    const fb = typeof vb === 'string' ? vb : ''
    if (fa === fb) continue
    ops.push({
      op: 'modify',
      track: 'code',
      id: fn,
      lines: lineDelta(fa, fb),
    })
  }

  // --- Remaining structured top-level fields ------------------------------
  for (const field of CONFIG_FIELDS) {
    if (deepEqual(a[field], b[field])) continue
    ops.push({
      op: 'modify',
      track: 'config',
      id: field,
      props: { value: [a[field], b[field]] },
    })
  }

  return ops
}

/** Spec fields that are identity/labeling, not behavior. */
const KNOB_IDENTITY = new Set(['key', 'label', 'order'])

interface ParamSpecLike extends AnyRecord {
  key: string
  kind?: unknown
  default?: unknown
}

function paramsByKey(config: AnyRecord): Map<string, ParamSpecLike> {
  const out = new Map<string, ParamSpecLike>()
  if (!Array.isArray(config.params)) return out
  for (const entry of config.params) {
    if (isRecord(entry) && typeof entry.key === 'string' && entry.key) {
      out.set(entry.key, entry as ParamSpecLike)
    }
  }
  return out
}

/** A knob's effective value: data wins (what playback reads), else default. */
function valueOf(data: AnyRecord, spec: ParamSpecLike, key: string): unknown {
  return data[key] !== undefined ? data[key] : spec.default
}

function specEqualIgnoringIdentity(
  a: ParamSpecLike,
  b: ParamSpecLike,
): boolean {
  return !shallowDiff(a, b, KNOB_IDENTITY)
}

function looksAsNodes(presets: unknown): AnyRecord[] {
  if (!Array.isArray(presets)) return []
  return presets
    .filter((p): p is AnyRecord => isRecord(p) && typeof p.name === 'string')
    .map((p) => ({ ...p, id: p.name }))
}
