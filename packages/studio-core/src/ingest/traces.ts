/**
 * Cursor tracks from the traces other tools leave beside a recording. A
 * take made from someone else's video has no cursor track of its own, so
 * nothing can be auto-zoomed; a trace recorded alongside can supply one.
 * Three shapes, each pure and measured against a real file:
 *
 * - A Playwright trace (`trace.trace` inside `trace.zip`, JSONL, version
 *   8): `before` events carry `class`/`method`/`params` and a monotonic
 *   `startTime`, `after` events an `endTime`, and every action that clicked
 *   somewhere carries `point` on its `input` and `after` events. A
 *   context's video starts when its page is made, so time zero is the
 *   `newPage` call.
 * - A CSV of `t,x,y,type` (ms since the video's start, viewport px; `type`
 *   one of move, down, up, click, scroll, and absent means move).
 * - JSON records, one per line or an array, each carrying `t` (or `ts`,
 *   `time`; ms, or epoch ms) and `x`/`y` (or `point`), with a `type` or an
 *   agent-browser `command`. agent-browser's own log carries neither
 *   timestamps nor coordinates (measured), so a record without them is
 *   NAMED in the notes and dropped, never guessed.
 *
 * Every adapter answers the same shape: the events, the notes for what it
 * could not place, and what the trace says about the viewport and the
 * wall-clock origin. A caller decides what to do with an empty track.
 */
import type { CursorEvent } from '../types'

export interface TraceResult {
  events: CursorEvent[]
  /** What could not be placed, in words, one per line. Empty is clean. */
  notes: string[]
  /** The viewport the coordinates live in, when the trace says. */
  viewport?: { width: number; height: number }
  /** Wall-clock ms at the track's zero, when the trace says (a meta.t0). */
  t0?: number
  kind: 'playwright' | 'csv' | 'records'
  /** Gestures placed, and gestures the trace held that could not be. */
  placed: number
  dropped: number
}

export interface TraceOptions {
  /** Added to every time, ms: a video that started later than the trace's zero. */
  offsetMs?: number
}

/** The ms a press is held when a trace records a click as one instant. */
export const CLICK_HOLD_MS = 40

export type TraceFileKind = 'zip' | 'csv' | 'jsonl' | 'json' | 'trace'

/** What a file's name says it is; null for a file no adapter reads. */
export function traceKindOf(name: string): TraceFileKind | null {
  const m = /\.([a-z0-9]+)$/i.exec(name)
  const ext = m ? m[1].toLowerCase() : ''
  if (ext === 'zip') return 'zip'
  if (ext === 'csv') return 'csv'
  if (ext === 'jsonl' || ext === 'ndjson') return 'jsonl'
  if (ext === 'json') return 'json'
  if (ext === 'trace') return 'trace'
  return null
}

/**
 * Read a trace by its name and text. A `.trace` (or a `.jsonl` whose lines
 * are Playwright's) is a Playwright trace; `.csv` the CSV; `.json`/`.jsonl`
 * otherwise are records. A `.zip` must be opened by the host first (the
 * entry named `trace.trace`), because inflating is the host's.
 */
export function cursorFromTrace(
  name: string,
  text: string,
  opts: TraceOptions = {},
): TraceResult {
  const kind = traceKindOf(name)
  if (kind === 'csv') return cursorFromCsv(text, opts)
  if (kind === 'trace' || looksLikePlaywright(text))
    return cursorFromPlaywrightTrace(text, opts)
  return cursorFromRecords(text, opts)
}

function looksLikePlaywright(text: string): boolean {
  const head = text.slice(0, 4000)
  return (
    head.includes('"type":"context-options"') ||
    (head.includes('"type":"before"') && head.includes('"callId"'))
  )
}

function sortEvents(events: CursorEvent[]): CursorEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map((x) => x.e)
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ---------------------------------------------------------------------------
// Playwright
// ---------------------------------------------------------------------------

interface PwBefore {
  callId: string
  startTime: number
  class?: string
  method?: string
  params?: Record<string, unknown>
}

/** Frame methods that press somewhere and carry a point once they landed. */
const PW_PRESS = new Set([
  'click',
  'dblclick',
  'tap',
  'check',
  'uncheck',
  'setChecked',
  'selectOption',
])
/** Frame methods that type into a field: typing activity, never its text. */
const PW_TYPE = new Set(['fill', 'type', 'press', 'pressSequentially'])

export function cursorFromPlaywrightTrace(
  text: string,
  opts: TraceOptions = {},
): TraceResult {
  const befores: PwBefore[] = []
  const afters = new Map<string, { endTime?: number; point?: Point }>()
  const inputs = new Map<string, Point>()
  let viewport: TraceResult['viewport']
  let wallTime: number | undefined
  let monotonicAtOptions: number | undefined
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let ev: Record<string, unknown>
    try {
      ev = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const type = ev.type
    if (type === 'context-options') {
      const o = ev.options as { viewport?: unknown } | undefined
      const v = o?.viewport as { width?: unknown; height?: unknown } | null
      if (v && typeof v.width === 'number' && typeof v.height === 'number')
        viewport = { width: v.width, height: v.height }
      if (typeof ev.wallTime === 'number') wallTime = ev.wallTime
      if (typeof ev.monotonicTime === 'number')
        monotonicAtOptions = ev.monotonicTime
    } else if (type === 'before' && typeof ev.startTime === 'number') {
      befores.push({
        callId: String(ev.callId),
        startTime: ev.startTime,
        class: typeof ev.class === 'string' ? ev.class : undefined,
        method: typeof ev.method === 'string' ? ev.method : undefined,
        params:
          ev.params && typeof ev.params === 'object'
            ? (ev.params as Record<string, unknown>)
            : undefined,
      })
    } else if (type === 'after') {
      afters.set(String(ev.callId), {
        endTime: typeof ev.endTime === 'number' ? ev.endTime : undefined,
        point: asPoint(ev.point),
      })
    } else if (type === 'input') {
      const p = asPoint(ev.point)
      if (p) inputs.set(String(ev.callId), p)
    }
  }
  const notes: string[] = []
  if (befores.length === 0) {
    return {
      events: [],
      notes: ['not a Playwright trace: no "before" events with a startTime'],
      viewport,
      kind: 'playwright',
      placed: 0,
      dropped: 0,
    }
  }
  // Time zero: the page's creation, where a context's video starts.
  const newPage = befores.find((b) => b.method === 'newPage')
  const origin =
    newPage?.startTime ?? monotonicAtOptions ?? befores[0].startTime
  const offset = opts.offsetMs ?? 0
  const t0 =
    wallTime !== undefined && monotonicAtOptions !== undefined
      ? Math.round(wallTime + (origin - monotonicAtOptions) - offset)
      : undefined
  const at = (ms: number) => round(ms - origin + offset)

  const events: CursorEvent[] = []
  // A box, not a let: the closure below writes it and TS would narrow a let to never.
  const cur: { pos: Point | null } = { pos: null }
  let placed = 0
  let dropped = 0
  const move = (t: number, p: Point) => {
    if (!cur.pos || cur.pos.x !== p.x || cur.pos.y !== p.y) {
      events.push({ t, x: p.x, y: p.y, type: 'move' })
    }
    cur.pos = p
  }
  const press = (start: number, end: number, p: Point, times = 1) => {
    move(start, p)
    let downAt = Math.max(start, end - CLICK_HOLD_MS)
    for (let i = 0; i < times; i++) {
      events.push({ t: round(downAt), x: p.x, y: p.y, type: 'down', button: 0 })
      events.push({
        t: round(downAt + CLICK_HOLD_MS),
        x: p.x,
        y: p.y,
        type: 'up',
        button: 0,
      })
      downAt += CLICK_HOLD_MS * 2
    }
  }
  for (const b of befores) {
    const after = afters.get(b.callId)
    const end = after?.endTime ?? b.startTime
    const point = after?.point ?? inputs.get(b.callId)
    const method = b.method ?? ''
    const cls = b.class ?? ''
    const start = at(b.startTime)
    const label = `${cls}.${method}`
    if (cls === 'Page' && method === 'mouseMove') {
      const p = asPoint(b.params)
      if (!p) {
        notes.push(`${label} at ${start}ms has no x/y`)
        dropped++
        continue
      }
      move(start, p)
      placed++
    } else if (cls === 'Page' && method === 'mouseClick') {
      const p = asPoint(b.params) ?? point
      if (!p) {
        notes.push(`${label} at ${start}ms has no x/y`)
        dropped++
        continue
      }
      press(start, at(end), p, clickCount(b.params))
      placed++
    } else if (
      cls === 'Page' &&
      (method === 'mouseDown' || method === 'mouseUp')
    ) {
      if (!cur.pos) {
        notes.push(`${label} at ${start}ms before any pointer position`)
        dropped++
        continue
      }
      events.push({
        t: start,
        x: cur.pos.x,
        y: cur.pos.y,
        type: method === 'mouseDown' ? 'down' : 'up',
        button: 0,
      })
      placed++
    } else if (cls === 'Page' && method === 'mouseWheel') {
      if (!cur.pos) {
        notes.push(`${label} at ${start}ms before any pointer position`)
        dropped++
        continue
      }
      events.push({ t: start, x: cur.pos.x, y: cur.pos.y, type: 'scroll' })
      placed++
    } else if (cls === 'Frame' && method === 'hover') {
      if (!point) {
        notes.push(
          `${label} ${selectorOf(b)} at ${start}ms landed nowhere the trace recorded`,
        )
        dropped++
        continue
      }
      move(start, point)
      placed++
    } else if (cls === 'Frame' && PW_PRESS.has(method)) {
      if (!point) {
        notes.push(
          `${label} ${selectorOf(b)} at ${start}ms landed nowhere the trace recorded`,
        )
        dropped++
        continue
      }
      press(start, at(end), point, method === 'dblclick' ? 2 : 1)
      placed++
    } else if (cls === 'Frame' && PW_TYPE.has(method)) {
      // Typing activity: when and where, never what. The field's place is
      // known only when a press landed there; otherwise it is named.
      if (!point && !cur.pos) {
        notes.push(
          `${label} ${selectorOf(b)} at ${start}ms typed into a field the trace never placed`,
        )
        dropped++
        continue
      }
      const p = point ?? cur.pos!
      events.push({ t: start, x: p.x, y: p.y, type: 'key' })
      placed++
    } else if (cls === 'Frame' && method === 'dragAndDrop') {
      notes.push(
        `${label} at ${start}ms: a drag has two points the trace records as one; not placed`,
      )
      dropped++
    }
    // Everything else (goto, waits, evaluate, routes) is not a gesture.
  }
  const negative = events.filter((e) => e.t < 0).length
  if (negative)
    notes.push(`${negative} event(s) before the video's start were dropped`)
  return {
    events: sortEvents(events.filter((e) => e.t >= 0)),
    notes,
    viewport,
    t0,
    kind: 'playwright',
    placed,
    dropped,
  }
}

interface Point {
  x: number
  y: number
}

function asPoint(v: unknown): Point | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as { x?: unknown; y?: unknown }
  return typeof o.x === 'number' && typeof o.y === 'number'
    ? { x: o.x, y: o.y }
    : undefined
}

function clickCount(params: Record<string, unknown> | undefined): number {
  const n = params?.clickCount
  return typeof n === 'number' && n > 1 ? Math.min(3, Math.floor(n)) : 1
}

function selectorOf(b: PwBefore): string {
  const s = b.params?.selector
  return typeof s === 'string' ? s : ''
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_TYPES = new Set(['move', 'down', 'up', 'click', 'scroll'])

export function cursorFromCsv(
  text: string,
  opts: TraceOptions = {},
): TraceResult {
  const notes: string[] = []
  const events: CursorEvent[] = []
  const offset = opts.offsetMs ?? 0
  let placed = 0
  let dropped = 0
  const lines = text.split(/\r?\n/)
  let cols = ['t', 'x', 'y', 'type']
  let start = 0
  const first = (lines[0] ?? '').split(',').map((c) => c.trim().toLowerCase())
  if (
    first.length >= 3 &&
    first.some((c) => c !== '' && Number.isNaN(Number(c)))
  ) {
    cols = first
    start = 1
  }
  const ti = cols.indexOf('t')
  const xi = cols.indexOf('x')
  const yi = cols.indexOf('y')
  const ki = cols.indexOf('type')
  if (ti < 0 || xi < 0 || yi < 0) {
    return {
      events: [],
      notes: [
        'the CSV needs t, x and y columns (a header row names them; without one the order is t,x,y,type)',
      ],
      kind: 'csv',
      placed: 0,
      dropped: 0,
    }
  }
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const cells = raw.split(',').map((c) => c.trim())
    const t = Number(cells[ti])
    const x = Number(cells[xi])
    const y = Number(cells[yi])
    const type = ((ki >= 0 ? cells[ki] : '') || 'move') as
      | 'move'
      | 'down'
      | 'up'
      | 'click'
      | 'scroll'
    if (![t, x, y].every(Number.isFinite)) {
      notes.push(`line ${i + 1}: t, x and y must be numbers`)
      dropped++
      continue
    }
    if (!CSV_TYPES.has(type)) {
      notes.push(
        `line ${i + 1}: unknown type "${type}" (move, down, up, click, scroll)`,
      )
      dropped++
      continue
    }
    const at = round(t + offset)
    if (type === 'click') {
      events.push({ t: at, x, y, type: 'move' })
      events.push({ t: at, x, y, type: 'down', button: 0 })
      events.push({ t: round(at + CLICK_HOLD_MS), x, y, type: 'up', button: 0 })
    } else if (type === 'down' || type === 'up') {
      events.push({ t: at, x, y, type, button: 0 })
    } else {
      events.push({ t: at, x, y, type })
    }
    placed++
  }
  return { events: sortEvents(events), notes, kind: 'csv', placed, dropped }
}

// ---------------------------------------------------------------------------
// JSON records (an agent's action log)
// ---------------------------------------------------------------------------

const RECORD_TYPES: Record<string, CursorEvent['type'] | 'click'> = {
  move: 'move',
  hover: 'move',
  down: 'down',
  mousedown: 'down',
  up: 'up',
  mouseup: 'up',
  click: 'click',
  press: 'click',
  scroll: 'scroll',
  wheel: 'scroll',
  key: 'key',
  type: 'key',
  fill: 'key',
  focus: 'focus',
}

/**
 * Records: an array, or one JSON object per line. A record places a gesture
 * when it carries a time and a point; one that carries neither is named.
 * Epoch times (over 1e12) are read relative to the first epoch time seen.
 */
export function cursorFromRecords(
  input: string | unknown[],
  opts: TraceOptions = {},
): TraceResult {
  const notes: string[] = []
  const events: CursorEvent[] = []
  const offset = opts.offsetMs ?? 0
  let placed = 0
  let dropped = 0
  let records: unknown[]
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed.startsWith('[')) {
      try {
        records = JSON.parse(trimmed) as unknown[]
      } catch {
        return {
          events: [],
          notes: ['not JSON: the records file could not be parsed'],
          kind: 'records',
          placed: 0,
          dropped: 0,
        }
      }
    } else {
      records = []
      let n = 0
      for (const line of trimmed.split('\n')) {
        n++
        if (!line.trim()) continue
        try {
          records.push(JSON.parse(line))
        } catch {
          notes.push(`line ${n}: not JSON`)
          dropped++
        }
      }
    }
  } else records = input
  let epochZero: number | null = null
  let sawNoTime = 0
  let sawNoPoint = 0
  records.forEach((r, i) => {
    if (!r || typeof r !== 'object') {
      notes.push(`record ${i + 1}: not an object`)
      dropped++
      return
    }
    const o = r as Record<string, unknown>
    let t = numberOf(o.t ?? o.ts ?? o.time ?? o.timestamp)
    // The walk's first stamped record is its zero, gesture or not: an
    // `open` is where the video started, not the first click after it.
    if (t !== undefined && t > 1e12) {
      if (epochZero === null) epochZero = t
      t -= epochZero
    }
    const kind = recordKind(o)
    if (!kind) return // a read, a snapshot, a navigation: not a gesture
    const p = asPoint(o) ?? asPoint(o.point) ?? centerOf(o.rect)
    if (t === undefined) {
      sawNoTime++
      dropped++
      return
    }
    if (!p) {
      sawNoPoint++
      dropped++
      return
    }
    const at = round(t + offset)
    const rect = asRect(o.rect)
    if (kind === 'click') {
      events.push({ t: at, x: p.x, y: p.y, type: 'move' })
      events.push({
        t: at,
        x: p.x,
        y: p.y,
        type: 'down',
        button: 0,
        ...(rect ? { rect } : {}),
      })
      events.push({
        t: round(at + CLICK_HOLD_MS),
        x: p.x,
        y: p.y,
        type: 'up',
        button: 0,
      })
    } else if (kind === 'down' || kind === 'up') {
      events.push({
        t: at,
        x: p.x,
        y: p.y,
        type: kind,
        button: 0,
        ...(rect ? { rect } : {}),
      })
    } else {
      events.push({
        t: at,
        x: p.x,
        y: p.y,
        type: kind,
        ...(rect ? { rect } : {}),
      })
    }
    placed++
  })
  if (sawNoTime)
    notes.push(
      `${sawNoTime} gesture record(s) carry no time (t, ts or time, in ms), so they cannot meet the video; agent-browser's own log has none, so stamp one per command when you keep it`,
    )
  if (sawNoPoint)
    notes.push(
      `${sawNoPoint} gesture record(s) carry no point (x/y, point, or rect); a ref alone says which element, not where it was`,
    )
  return { events: sortEvents(events), notes, kind: 'records', placed, dropped }
}

function recordKind(
  o: Record<string, unknown>,
): CursorEvent['type'] | 'click' | null {
  const explicit = typeof o.type === 'string' ? o.type.toLowerCase() : ''
  if (explicit && explicit in RECORD_TYPES) return RECORD_TYPES[explicit]
  const cmd = commandWords(o.command ?? o.action ?? o.kind)
  const verb = cmd[0] === 'mouse' ? `${cmd[0]}${cmd[1] ?? ''}` : cmd[0]
  if (!verb) return null
  const key = verb.toLowerCase()
  if (key in RECORD_TYPES) return RECORD_TYPES[key]
  if (key === 'mousemove') return 'move'
  if (key === 'mouseclick') return 'click'
  if (key === 'mousedown') return 'down'
  if (key === 'mouseup') return 'up'
  if (key === 'dblclick') return 'click'
  return null
}

function commandWords(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string') return v.trim().split(/\s+/)
  return []
}

function numberOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
    return Number(v)
  return undefined
}

function asRect(v: unknown): CursorEvent['rect'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const x = numberOf(o.x)
  const y = numberOf(o.y)
  const w = numberOf(o.w ?? o.width)
  const h = numberOf(o.h ?? o.height)
  return x !== undefined &&
    y !== undefined &&
    w !== undefined &&
    h !== undefined
    ? { x, y, w, h }
    : undefined
}

function centerOf(v: unknown): Point | undefined {
  const r = asRect(v)
  return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : undefined
}
