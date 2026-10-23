/**
 * Reuse: re-time a previous cut onto a NEW recording of the same
 * script. The recorder's `meta.steps` say when each actions.json step ran
 * in BOTH takes, so the old timeline maps onto the new one piecewise —
 * matched step edges are the control points, and any source time in
 * between interpolates. A span is re-timed against the STEP it was made
 * on whenever one can be found: an explicit `anchor` first, else the step
 * whose window held the span's start (or ended just before it), keeping
 * the span's offset from that step exactly. Only a span between steps
 * goes through the map.
 *
 * Report, never guess: every span that could not re-anchor cleanly is
 * NAMED in `flagged` with the reason in words — a vanished step (the span
 * that sat on it is dropped, with what it framed, never re-timed to a
 * place with nothing under it), a skipped selector, a span clamped or
 * dropped at the new take's edge. The agent fixes actions.json and
 * re-runs; the verb never silently invents a cut.
 *
 * Output-anchored layers keep their output second by contract (a title at
 * 1 s stays a title at 1 s). A layer PINNED to a step is about that step,
 * so it follows the step's new output time instead (`retimeOverlays`);
 * an unpinned layer that sat over a step which moved is named, with the
 * step's new time, so the person pins it or moves it.
 *
 * Pure functions, no I/O — reuse.test.ts drives them with synthetic
 * step timelines; the browser gate is smoke-recut.ts.
 */
import {
  docFreezes,
  ratedSegments,
  resolveAnchor as resolveLayerAnchor,
} from '@vosjs/studio-core'
import type {
  FreezeSpan,
  OverlayClip,
  ProjectDoc,
  RejectedSpan,
  SpeedSpan,
  StepAnchor,
  StepSpan,
  TiltSpan,
  ZoomSpan,
} from '@vosjs/studio-core'

/** Minimum surviving span length (seconds) — anything shorter drops. */
const MIN_SPAN = 0.15
/** A span starting this long after a step's end still belongs to it. */
const AFTER_STEP = 1
/** A layer is about the press before it for longer: a callout lands a beat after. */
const LAYER_AFTER_STEP = 5
/** Slack around a step's window, seconds. */
const WINDOW_SLACK = 0.05
/** An unpinned layer whose step moved less than this is left unnamed. */
const LAYER_DRIFT = 0.5

export interface StepMap {
  /** old SOURCE seconds → new SOURCE seconds (piecewise linear, clamped). */
  map: (t: number) => number
  /** old steps with no usable match in the new recording. */
  unmatched: StepSpan[]
  matched: number
}

/**
 * An unnamed old step by its place beside the NEAREST named one: the step
 * two after `zoomOut` is still two after `zoomOut` when a step was added
 * before it. Looked for from the named step before and the one after; the
 * verb and the selector must agree, and two answers that disagree are no
 * answer.
 */
function matchByNeighbour(
  old: StepSpan,
  newSteps: readonly StepSpan[],
  oldSteps: readonly StepSpan[],
): StepSpan | null {
  const named = oldSteps.filter(
    (s) => s.id && newSteps.some((n) => n.id === s.id && !n.skipped),
  )
  const before = named
    .filter((s) => s.step < old.step)
    .sort((a, b) => b.step - a.step)[0]
  const after = named
    .filter((s) => s.step > old.step)
    .sort((a, b) => a.step - b.step)[0]
  const found = [before, after].flatMap((anchor) => {
    if (!anchor) return []
    const now = newSteps.find((n) => n.id === anchor.id)!
    const hit = newSteps.find(
      (n) => n.step === now.step + old.step - anchor.step,
    )
    return hit &&
      !hit.skipped &&
      !hit.id &&
      hit.do === old.do &&
      hit.selector === old.selector
      ? [hit]
      : []
  })
  return found.length && found.every((h) => h === found[0]) ? found[0] : null
}

/**
 * Match an old step to a new one: by `id` when both carry one; else, for
 * an unnamed step, by its place beside the nearest named step; else the
 * same index when the verb + selector still agree there; else a UNIQUE
 * (do, selector) match anywhere. A new step that was skipped (selector
 * never appeared) is no match — its gesture did not happen.
 */
function matchStep(
  old: StepSpan,
  newSteps: StepSpan[],
  oldSteps: readonly StepSpan[] = [],
): StepSpan | null {
  const usable = (s: StepSpan | undefined): s is StepSpan =>
    !!s && s.skipped !== true
  if (old.id) {
    const byId = newSteps.find((s) => s.id === old.id)
    return usable(byId) ? byId : null
  }
  const near = matchByNeighbour(old, newSteps, oldSteps)
  if (near) return near
  const atIndex = newSteps.find((s) => s.step === old.step)
  if (
    usable(atIndex) &&
    atIndex.do === old.do &&
    atIndex.selector === old.selector
  ) {
    return atIndex
  }
  const bySignature = newSteps.filter(
    (s) => s.do === old.do && s.selector === old.selector && !s.skipped,
  )
  return old.selector !== undefined && bySignature.length === 1
    ? bySignature[0]
    : usable(atIndex) && old.selector === undefined && atIndex.do === old.do
      ? atIndex
      : null
}

/** A step by the reference an anchor or a pin carries: an id, else an index. */
function stepByRef(
  steps: readonly StepSpan[],
  ref: string | number,
): StepSpan | undefined {
  return typeof ref === 'string'
    ? steps.find((s) => s.id === ref)
    : steps.find((s) => s.step === ref)
}

const stepName = (s: StepSpan): string => String(s.id ?? s.step)

/**
 * The step a SOURCE moment was made on: the gesture whose window holds it
 * (a wait is no gesture), else the gesture that ended within a second
 * before it. Null between steps.
 */
export function stepUnder(
  t: number,
  steps: readonly StepSpan[],
  after = AFTER_STEP,
): StepSpan | null {
  const gestures = steps.filter((s) => s.do !== 'wait' && !s.skipped)
  const holding = gestures.find(
    (s) => s.tStart - WINDOW_SLACK <= t && t <= s.tEnd + WINDOW_SLACK,
  )
  if (holding) return holding
  const before = gestures
    .filter((s) => s.tEnd <= t && t - s.tEnd <= after)
    .sort((a, b) => b.tEnd - a.tEnd)
  return before[0] ?? null
}

export function buildStepMap(
  oldSteps: StepSpan[],
  newSteps: StepSpan[],
  oldDuration: number,
  newDuration: number,
): StepMap {
  const points: { from: number; to: number }[] = [
    { from: 0, to: 0 },
    { from: oldDuration, to: newDuration },
  ]
  const unmatched: StepSpan[] = []
  let matched = 0
  for (const old of oldSteps) {
    if (old.skipped) continue // never ran in the old take; nothing anchored to it
    const hit = matchStep(old, newSteps, oldSteps)
    if (!hit) {
      unmatched.push(old)
      continue
    }
    matched++
    points.push({ from: old.tStart, to: hit.tStart })
    points.push({ from: old.tEnd, to: hit.tEnd })
  }
  // Sort and keep the mapping monotonic: a control point that would send
  // time backwards (steps reordered between takes) is dropped — the
  // interpolation through its neighbours is the honest fallback.
  points.sort((a, b) => a.from - b.from || a.to - b.to)
  const clean: { from: number; to: number }[] = []
  for (const p of points) {
    const last = clean.at(-1)
    if (!last) {
      clean.push(p)
      continue
    }
    if (p.from <= last.from + 1e-9) continue
    if (p.to < last.to) continue
    clean.push(p)
  }
  const map = (t: number): number => {
    const x = Math.max(0, Math.min(t, oldDuration))
    let i = 1
    while (i < clean.length - 1 && clean[i].from < x) i++
    const a = clean[i - 1] ?? clean[0]
    const b = clean[i] ?? a
    const span = b.from - a.from
    const u = span > 1e-9 ? (x - a.from) / span : 0
    return Math.max(0, Math.min(a.to + (b.to - a.to) * u, newDuration))
  }
  return { map, unmatched, matched }
}

/** Resolve an explicit anchor against the NEW steps; null when it cannot. */
export function resolveAnchor(
  anchor: StepAnchor,
  newSteps: StepSpan[],
): number | null {
  const step = stepByRef(newSteps, anchor.step)
  if (!step || step.skipped) return null
  const base = anchor.at === 'end' ? step.tEnd : step.tStart
  return base + (anchor.offset ?? 0)
}

interface SourceSpan {
  id: string
  in: number
  out: number
  anchor?: StepAnchor
}

export interface ReuseReport {
  /** spans re-timed against a step: an explicit anchor, or the step they sat on. */
  anchored: number
  /** spans re-timed through the step map (approximate by nature). */
  mapped: number
  /** everything that needs a human/agent look, in words. */
  flagged: string[]
}

/** What a span framed, for the words that name a dropped one. */
function framed(span: object): string {
  const s = span as Partial<ZoomSpan & SpeedSpan & TiltSpan & FreezeSpan>
  if (typeof s.level === 'number' && typeof s.cx === 'number') {
    return ` (it framed ${s.cx.toFixed(2)}, ${(s.cy ?? 0).toFixed(2)} at ${s.level.toFixed(1)}×)`
  }
  if (typeof s.rate === 'number') return ` (${s.rate}× speed)`
  if (typeof s.rx === 'number' || typeof s.ry === 'number') {
    return ` (lean ${s.rx ?? 0}°, ${s.ry ?? 0}°)`
  }
  if (typeof s.seconds === 'number') return ` (a ${s.seconds} s hold)`
  return ''
}

/**
 * Where a SOURCE moment lands in the new recording, and how: through its
 * explicit anchor, through the step it sat on (offset kept exactly), else
 * through the map. Null means the step it was made on is gone from the
 * new recording — the moment is dropped and named by the caller.
 */
function placeMoment(
  t: number,
  anchor: StepAnchor | undefined,
  ctx: {
    oldSteps: readonly StepSpan[]
    newSteps: StepSpan[]
    stepMap: StepMap
    report: ReuseReport
  },
):
  | { at: number; via: 'anchor' | 'step' | 'map' }
  | { gone: StepSpan | string } {
  if (anchor) {
    const at = resolveAnchor(anchor, ctx.newSteps)
    if (at === null) return { gone: String(anchor.step) }
    ctx.report.anchored++
    return { at, via: 'anchor' }
  }
  const under = stepUnder(t, ctx.oldSteps)
  if (under) {
    const hit = matchStep(under, ctx.newSteps, ctx.oldSteps)
    if (!hit) return { gone: under }
    ctx.report.anchored++
    return { at: hit.tStart + (t - under.tStart), via: 'step' }
  }
  ctx.report.mapped++
  return { at: ctx.stepMap.map(t), via: 'map' }
}

const goneWords = (gone: StepSpan | string): string =>
  typeof gone === 'string'
    ? `its anchored step (${gone}) is missing or skipped in the new recording`
    : `it sat on step ${stepName(gone)} (${gone.do}${gone.selector ? ` ${gone.selector}` : ''}), which is missing or skipped in the new recording`

function retimeSpans<T extends SourceSpan>(
  kind: string,
  spans: T[],
  ctx: {
    oldSteps: readonly StepSpan[]
    newSteps: StepSpan[]
    stepMap: StepMap
    newDuration: number
    report: ReuseReport
  },
  opts: { overlap: 'trim' | 'keep' } = { overlap: 'trim' },
): T[] {
  const out: T[] = []
  for (const span of spans) {
    const length = span.out - span.in
    const placed = placeMoment(span.in, span.anchor, ctx)
    if ('gone' in placed) {
      ctx.report.flagged.push(
        `${kind} ${span.id}: ${goneWords(placed.gone)} — dropped; re-aim it on the new footage${framed(span)}`,
      )
      continue
    }
    const nextIn = placed.at
    const nextOut = Math.min(nextIn + length, ctx.newDuration)
    const clampedIn = Math.max(0, Math.min(nextIn, ctx.newDuration))
    if (nextOut - clampedIn < MIN_SPAN) {
      ctx.report.flagged.push(
        `${kind} ${span.id}: lands outside the new recording (${clampedIn.toFixed(2)}s) — dropped`,
      )
      continue
    }
    out.push({ ...span, in: +clampedIn.toFixed(3), out: +nextOut.toFixed(3) })
  }
  out.sort((a, b) => a.in - b.in)
  // A deletion is a record of what was removed; two may cover the same
  // seconds, and trimming one away would let a deleted proposal return.
  if (opts.overlap === 'keep') return out
  // Playing spans must not overlap: trim a later span's head to its
  // neighbour's tail (a shifted step can squeeze two spans together).
  const kept: T[] = []
  for (const span of out) {
    const prev = kept.at(-1)
    if (prev && span.in < prev.out) {
      const trimmed = { ...span, in: +prev.out.toFixed(3) }
      if (trimmed.out - trimmed.in < MIN_SPAN) {
        ctx.report.flagged.push(
          `${kind} ${span.id}: fully overlapped ${prev.id} after re-timing — dropped`,
        )
        continue
      }
      ctx.report.flagged.push(
        `${kind} ${span.id}: overlapped ${prev.id} after re-timing — trimmed to ${trimmed.in.toFixed(2)}s`,
      )
      kept.push(trimmed)
      continue
    }
    kept.push(span)
  }
  return kept
}

export interface ReusedCut {
  segments: { in: number; out: number }[]
  zoom: ZoomSpan[]
  speed: SpeedSpan[]
  /** The previous cut's freezes, re-timed like its manual spans (a legacy hold included). */
  freeze: FreezeSpan[]
  tilt: TiltSpan[]
  /** The previous cut's rejected proposals, re-timed like its manual spans. */
  rejected: RejectedSpan[]
  report: ReuseReport
}

/**
 * The previous cut's HUMAN work, re-timed onto the new recording. Auto
 * spans are deliberately absent — the planners re-propose them on the new
 * cursor track, exactly as a refresh does. Output-anchored work (overlays,
 * audio, objects) is not retimed here: see `retimeOverlays`, which runs
 * once the new cut's rate is final.
 */
export function retimeCut(
  prev: ProjectDoc,
  newSteps: StepSpan[],
  newDurationMs: number,
): ReusedCut {
  const report: ReuseReport = { anchored: 0, mapped: 0, flagged: [] }
  const oldSteps = prev.source.meta.steps ?? []
  const oldDuration = prev.source.meta.durationMs / 1000
  const newDuration = newDurationMs / 1000
  const stepMap = buildStepMap(oldSteps, newSteps, oldDuration, newDuration)
  for (const miss of stepMap.unmatched) {
    // An unmatched wait is dead time nothing anchors to — reporting it is
    // noise (the smoke's v1 tail wait "vanished" on every reindex).
    if (miss.do === 'wait') continue
    report.flagged.push(
      `step ${stepName(miss)} (${miss.do}${miss.selector ? ` ${miss.selector}` : ''}) has no match in the new recording — times near it interpolate`,
    )
  }
  const ctx = { oldSteps, newSteps, stepMap, newDuration, report }

  // Segments: an untrimmed take stays untrimmed at the new length; a real
  // trim re-times edge-wise through the map.
  const untrimmed =
    prev.segments.length === 0 ||
    (prev.segments.length === 1 &&
      prev.segments[0].in <= 0.05 &&
      prev.segments[0].out >= oldDuration - 0.05)
  const segments = untrimmed
    ? [{ in: 0, out: +newDuration.toFixed(3) }]
    : prev.segments
        .map((s) => ({
          in: +stepMap.map(s.in).toFixed(3),
          out: +stepMap.map(s.out).toFixed(3),
        }))
        .filter((s) => s.out - s.in >= MIN_SPAN)
  if (!untrimmed && segments.length < prev.segments.length) {
    report.flagged.push(
      `${prev.segments.length - segments.length} trimmed segment(s) collapsed to nothing in the new recording — dropped`,
    )
  }

  const zoom = retimeSpans(
    'zoom',
    prev.zoom.filter((z) => z.source === 'manual'),
    ctx,
  )
  // The speed wand's contract: absent source = manual, always kept.
  const speed = retimeSpans(
    'speed',
    (prev.speed ?? []).filter((s) => s.source !== 'auto'),
    ctx,
  )
  const tilt = retimeSpans(
    'tilt',
    (prev.tilt ?? []).filter((t) => t.source !== 'auto'),
    ctx,
  )
  // A freeze is a source MOMENT: its anchor or its step re-times the
  // moment, its seconds come along untouched, and one that lands past the
  // new recording is dropped and named.
  const freeze: FreezeSpan[] = []
  for (const f of docFreezes(prev)) {
    const placed = placeMoment(f.at, f.anchor, ctx)
    if ('gone' in placed) {
      report.flagged.push(
        `freeze ${f.id}: ${goneWords(placed.gone)} — dropped; re-place it on the new footage${framed(f)}`,
      )
      continue
    }
    if (placed.at < 0 || placed.at > newDuration) {
      report.flagged.push(
        `freeze ${f.id}: lands outside the new recording (${placed.at.toFixed(2)}s) — dropped`,
      )
      continue
    }
    freeze.push({ ...f, at: +placed.at.toFixed(3) })
  }
  freeze.sort((a, b) => a.at - b.at)
  // A rejected proposal is a deletion the human made; it follows the
  // footage the way the spans it stands beside do, one lane at a time,
  // and two deletions may legitimately cover the same seconds.
  const rejected: RejectedSpan[] = []
  for (const lane of ['zoom', 'tilt', 'speed'] as const) {
    rejected.push(
      ...retimeSpans(
        `rejected ${lane}`,
        (prev.rejected ?? []).filter((r) => r.lane === lane),
        ctx,
        { overlap: 'keep' },
      ),
    )
  }

  return { segments, zoom, speed, freeze, tilt, rejected, report }
}

/** OUTPUT seconds of a SOURCE moment through a rated piece list; a moment in cut footage snaps to the next kept piece. */
function sourceToOutput(
  pieces: readonly { in: number; out: number; rate?: number }[],
  s: number,
): number {
  let acc = 0
  for (const p of pieces) {
    const rate = p.rate && p.rate > 0 ? p.rate : 1
    const len = Math.max(0, p.out - p.in) / rate
    if (s < p.in) return acc
    if (s <= p.out) return acc + (s - p.in) / rate
    acc += len
  }
  return acc
}

/** SOURCE seconds of an OUTPUT moment through a rated piece list. */
function outputToSource(
  pieces: readonly { in: number; out: number; rate?: number }[],
  t: number,
): number {
  let acc = 0
  for (const p of pieces) {
    const rate = p.rate && p.rate > 0 ? p.rate : 1
    const len = Math.max(0, p.out - p.in) / rate
    if (acc + len >= t) return p.in + Math.max(0, t - acc) * rate
    acc += len
  }
  return pieces.at(-1)?.out ?? t
}

/**
 * The previous cut's layers onto the new cut, once its rate is final. A
 * layer pinned to a step keeps its offset from the step's OUTPUT time, so
 * a callout about a press plays when the press plays; a layer pinned to a
 * press (a source second) has the press re-timed and follows it the same
 * way; a layer pinned to a rect, or to nothing, keeps its output second,
 * and when the step under it moved by more than half a second the layer
 * is named with the step's new time, so the person pins it or moves it.
 */
export function retimeOverlays(
  prev: ProjectDoc,
  next: ProjectDoc,
  report: ReuseReport,
): OverlayClip[] {
  const overlays = prev.overlays ?? []
  if (!overlays.length) return []
  const oldSteps = prev.source.meta.steps ?? []
  const newSteps = next.source.meta.steps ?? []
  const oldPieces = ratedSegments(prev)
  const newPieces = ratedSegments(next)
  const oldDuration = prev.source.meta.durationMs / 1000
  const newDuration = next.source.meta.durationMs / 1000
  const stepMap = buildStepMap(oldSteps, newSteps, oldDuration, newDuration)
  const ctx = { oldSteps, newSteps, stepMap, report }
  const follow = (
    o: OverlayClip,
    oldRef: number,
    newRef: number,
  ): OverlayClip => {
    const offset = o.start - sourceToOutput(oldPieces, oldRef)
    const start = Math.max(0, sourceToOutput(newPieces, newRef) + offset)
    return { ...o, start: +start.toFixed(3) }
  }
  return overlays.map((o) => {
    // Anchored to a step: the lowering re-reads it against the new steps;
    // its fallback `start` follows too, so the document says where it plays.
    if (o.anchor && typeof o.anchor === 'object') {
      const r = resolveLayerAnchor(next, o.anchor, newPieces)
      if (r.start === null) {
        report.flagged.push(
          `overlay ${o.id}: anchored to step ${String(o.anchor.step)}, which is missing, skipped or cut in the new recording — it plays at its fallback ${o.start.toFixed(2)}s; re-anchor or re-place it`,
        )
        return o
      }
      report.anchored++
      return { ...o, start: r.start }
    }
    const pin = o.pin
    if (pin?.step !== undefined) {
      const was = stepByRef(oldSteps, pin.step)
      const now = was
        ? matchStep(was, newSteps, oldSteps)
        : stepByRef(newSteps, pin.step)
      if (!now || now.skipped) {
        report.flagged.push(
          `overlay ${o.id}: pinned to step ${String(pin.step)}, which is missing or skipped in the new recording — kept at ${o.start.toFixed(2)}s; re-pin or re-place it`,
        )
        return o
      }
      report.anchored++
      return follow(o, was?.tStart ?? now.tStart, now.tStart)
    }
    if (typeof pin?.press === 'number') {
      const placed = placeMoment(pin.press, undefined, ctx)
      if ('gone' in placed) {
        report.flagged.push(
          `overlay ${o.id}: pinned to a press at ${pin.press.toFixed(2)}s, and ${goneWords(placed.gone)} — kept at ${o.start.toFixed(2)}s; re-pin or re-place it`,
        )
        return o
      }
      const moved = follow(o, pin.press, placed.at)
      return { ...moved, pin: { ...pin, press: +placed.at.toFixed(3) } }
    }
    // Unpinned (or pinned to a rect): the output-time contract holds, and
    // a layer that sat over a step which moved is named.
    const under = stepUnder(
      outputToSource(oldPieces, o.start),
      oldSteps,
      LAYER_AFTER_STEP,
    )
    if (!under) return o
    const now = matchStep(under, newSteps, oldSteps)
    if (!now) {
      report.flagged.push(
        `overlay ${o.id} (${o.start.toFixed(2)}s): it sat over step ${stepName(under)}, which is missing or skipped in the new recording — kept at its output time; re-place it`,
      )
      return o
    }
    const expected = follow(o, under.tStart, now.tStart).start
    if (Math.abs(expected - o.start) > LAYER_DRIFT) {
      report.flagged.push(
        `overlay ${o.id} (${o.start.toFixed(2)}s): it sat over step ${stepName(under)}, which now plays at ${expected.toFixed(2)}s in the cut — kept at ${o.start.toFixed(2)}s by the output-time contract; pin it to follow (pin: { step: ${JSON.stringify(under.id ?? under.step)} }) or move it`,
      )
    }
    return o
  })
}
