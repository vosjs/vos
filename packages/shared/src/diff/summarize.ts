import type { Op } from './types'

/**
 * Deterministic prose over an op list — the line that lands in the agent's
 * context ("zoom z3: end 4.2s→4.6s, level 2.2→1.8; tilt t1 removed").
 * Same ops ⇒ byte-identical string; unit-pinned like the geometry mirrors.
 */
export function summarize(
  ops: readonly Op[],
  options: { maxItems?: number } = {},
): string {
  const max = options.maxItems ?? 12
  if (ops.length === 0) return 'no changes'
  const shown = ops.slice(0, max)
  const parts = shown.map(phrase)
  const hidden = ops.length - shown.length
  if (hidden > 0)
    parts.push(`and ${hidden} smaller change${hidden === 1 ? '' : 's'}`)
  return parts.join('; ')
}

function phrase(op: Op): string {
  if (op.track === 'code') {
    return `code ${op.id} changed (${op.lines ?? 0} line${op.lines === 1 ? '' : 's'})`
  }
  if (op.track === 'knob') return knobPhrase(op)
  if (op.track === 'config') {
    if (op.id === 'duration' && op.props?.value) {
      const [from, to] = op.props.value
      return `duration ${fmt(from, true)}→${fmt(to, true)}`
    }
    return `${op.id} changed`
  }
  if (op.track === 'data') {
    const pair = op.props?.value
    if (op.op === 'add') return `data ${op.id} set to ${fmt(pair?.[1])}`
    if (op.op === 'remove') return `data ${op.id} removed`
    return `data ${op.id}: ${fmt(pair?.[0])}→${fmt(pair?.[1])}`
  }
  if (op.track === 'look') {
    if (op.op === 'add') return `look "${op.id}" added`
    if (op.op === 'remove') return `look "${op.id}" removed`
    return `look "${op.id}" changed`
  }
  if (op.track === 'segments') {
    const d = op.props?.duration
    if (d) return `trim: kept footage ${fmt(d[0], true)}→${fmt(d[1], true)}`
    return 'segments edited'
  }
  if (SCOPED_TRACKS.has(op.track)) {
    return `${op.track} ${propList(op.props)}`
  }

  // Id-keyed span/clip tracks.
  const name = `${op.track} ${op.id}`
  // The output-duration pair a speed edit carries (what the cut gained
  // or lost in screen seconds) rides add/remove phrases too — a new 2× span
  // shortens the video without modifying anything.
  const output = op.props?.output
  const outputNote = output
    ? `output ${fmt(output[0], true)}→${fmt(output[1], true)}`
    : null
  if (op.op === 'add') {
    const range = rangeOf(op)
    const bits = [range, outputNote].filter(Boolean).join(', ')
    return bits ? `${name} added (${bits})` : `${name} added`
  }
  if (op.op === 'remove')
    return outputNote ? `${name} removed (${outputNote})` : `${name} removed`
  return `${name}: ${propList(op.props)}`
}

function knobPhrase(op: Op): string {
  const rename = op.props?.key
  if (rename) return `replaced knob ${fmt(rename[0])} with ${fmt(rename[1])}`
  if (op.op === 'add') {
    const kind = (op.props?.kind ?? [])[1]
    return typeof kind === 'string'
      ? `knob ${op.id} added (${kind})`
      : `knob ${op.id} added`
  }
  if (op.op === 'remove') return `knob ${op.id} removed`
  const value = op.props?.value
  const parts: string[] = []
  if (value) parts.push(`${fmt(value[0])}→${fmt(value[1])}`)
  for (const [k, [from, to]] of Object.entries(op.props ?? {})) {
    if (k === 'value') continue
    parts.push(`${k} ${fmt(from)}→${fmt(to)}`)
  }
  return `knob ${op.id}: ${parts.join(', ')}`
}

const SCOPED_TRACKS = new Set(['frame', 'cursor', 'cam', 'export', 'camera'])

/** Humanized property names for the take vocabulary. */
const PROP_LABELS: Record<string, string> = {
  in: 'start',
  out: 'end',
  cx: 'focus x',
  cy: 'focus y',
}

/** Properties whose numbers are seconds. */
const TIME_PROPS = new Set([
  'in',
  'out',
  'at',
  'start',
  'end',
  'duration',
  'output',
])

function propList(props: Op['props']): string {
  if (!props) return 'changed'
  return Object.entries(props)
    .map(([k, [from, to]]) => {
      const time = TIME_PROPS.has(k)
      return `${PROP_LABELS[k] ?? k} ${fmt(from, time)}→${fmt(to, time)}`
    })
    .join(', ')
}

function rangeOf(op: Op): string | null {
  const startPair = anchorPair(op, ['in', 'at', 'start'])
  const start = startPair ? startPair[1] : undefined
  if (typeof start !== 'number') return null
  const endPair = anchorPair(op, ['out'])
  const end = endPair ? endPair[1] : undefined
  return typeof end === 'number'
    ? `${fmt(start, true)}–${fmt(end, true)}`
    : `at ${fmt(start, true)}`
}

function anchorPair(
  op: Op,
  keys: readonly string[],
): [unknown, unknown] | undefined {
  for (const k of keys) {
    const pair = op.props?.[k]
    if (pair) return pair
  }
  return undefined
}

/**
 * Long strings (content knobs carry whole headlines) collapse to
 * one line and truncate — the summary is a changelog sentence, and it also
 * rides 409 stale_base bodies, so a multiline value must never spill raw.
 */
const FMT_STRING_MAX = 40

function fmt(v: unknown, time = false): string {
  if (v === undefined) return '∅'
  if (v === null) return 'null'
  if (typeof v === 'number') {
    const rounded = Math.round(v * 100) / 100
    return time ? `${rounded}s` : String(rounded)
  }
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'string') {
    if (v === '') return '""'
    const flat = v.replace(/\s*\n\s*/g, ' ')
    const clipped =
      flat.length > FMT_STRING_MAX
        ? `${flat.slice(0, FMT_STRING_MAX - 1)}…`
        : flat
    return clipped === v ? quoteIfNeeded(clipped) : `"${clipped}"`
  }
  return 'changed'
}

function quoteIfNeeded(s: string): string {
  return /^[\w.#-]+$/.test(s) ? s : `"${s}"`
}
