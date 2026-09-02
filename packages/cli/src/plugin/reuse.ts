/**
 * Reuse: re-time a previous cut onto a NEW recording of the same
 * script. The recorder's `meta.steps` say when each actions.json step ran
 * in BOTH takes, so the old timeline maps onto the new one piecewise —
 * matched step edges are the control points, and any source time in
 * between interpolates. Explicit `anchor`s on camera spans resolve
 * directly against the new steps and win over the map.
 *
 * Report, never guess: every span that
 * could not re-anchor cleanly is NAMED in `flagged` with the reason in
 * words — a vanished step, a skipped selector, a span clamped or dropped
 * at the new take's edge. The agent fixes actions.json and re-runs; the
 * verb never silently invents a cut.
 *
 * Pure functions, no I/O — reuse.test.ts drives them with synthetic
 * step timelines; the browser gate is smoke-recut.ts.
 */
import type {
  ProjectDoc,
  SpeedSpan,
  StepAnchor,
  StepSpan,
  TiltSpan,
  ZoomSpan,
} from '@vosjs/studio-core'

/** Minimum surviving span length (seconds) — anything shorter drops. */
const MIN_SPAN = 0.15

export interface StepMap {
  /** old SOURCE seconds → new SOURCE seconds (piecewise linear, clamped). */
  map: (t: number) => number
  /** old steps with no usable match in the new recording. */
  unmatched: StepSpan[]
  matched: number
}

/**
 * Match an old step to a new one: by `id` when both carry one; else the
 * same index when the verb + selector still agree there; else a UNIQUE
 * (do, selector) match anywhere. A new step that was skipped (selector
 * never appeared) is no match — its gesture did not happen.
 */
function matchStep(old: StepSpan, newSteps: StepSpan[]): StepSpan | null {
  const usable = (s: StepSpan | undefined): s is StepSpan =>
    !!s && s.skipped !== true
  if (old.id) {
    const byId = newSteps.find((s) => s.id === old.id)
    return usable(byId) ? byId : null
  }
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
    const hit = matchStep(old, newSteps)
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
  const step =
    typeof anchor.step === 'string'
      ? newSteps.find((s) => s.id === anchor.step)
      : newSteps.find((s) => s.step === anchor.step)
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
  /** spans re-timed through an explicit anchor. */
  anchored: number
  /** spans re-timed through the step map (approximate by nature). */
  mapped: number
  /** everything that needs a human/agent look, in words. */
  flagged: string[]
}

function retimeSpans<T extends SourceSpan>(
  kind: string,
  spans: T[],
  stepMap: StepMap,
  newSteps: StepSpan[],
  newDuration: number,
  report: ReuseReport,
): T[] {
  const out: T[] = []
  for (const span of spans) {
    const length = span.out - span.in
    let nextIn: number | null = null
    if (span.anchor) {
      nextIn = resolveAnchor(span.anchor, newSteps)
      if (nextIn === null) {
        report.flagged.push(
          `${kind} ${span.id}: its anchored step (${String(span.anchor.step)}) is missing or skipped in the new recording — fell back to the step map`,
        )
      } else {
        report.anchored++
      }
    }
    if (nextIn === null) {
      nextIn = stepMap.map(span.in)
      report.mapped++
    }
    const nextOut = Math.min(nextIn + length, newDuration)
    const clampedIn = Math.max(0, Math.min(nextIn, newDuration))
    if (nextOut - clampedIn < MIN_SPAN) {
      report.flagged.push(
        `${kind} ${span.id}: lands outside the new recording (${clampedIn.toFixed(2)}s) — dropped`,
      )
      continue
    }
    out.push({ ...span, in: +clampedIn.toFixed(3), out: +nextOut.toFixed(3) })
  }
  // Source spans must not overlap: sort, then trim a later span's head to
  // its neighbour's tail (a shifted step can squeeze two spans together).
  out.sort((a, b) => a.in - b.in)
  const kept: T[] = []
  for (const span of out) {
    const prev = kept.at(-1)
    if (prev && span.in < prev.out) {
      const trimmed = { ...span, in: +prev.out.toFixed(3) }
      if (trimmed.out - trimmed.in < MIN_SPAN) {
        report.flagged.push(
          `${kind} ${span.id}: fully overlapped ${prev.id} after re-timing — dropped`,
        )
        continue
      }
      report.flagged.push(
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
  tilt: TiltSpan[]
  report: ReuseReport
}

/**
 * The previous cut's HUMAN work, re-timed onto the new recording. Auto
 * spans are deliberately absent — the planners re-propose them on the new
 * cursor track, exactly as a refresh does. Output-anchored work (overlays,
 * audio, objects) is not retimed here: a title at 1s stays a title at 1s,
 * the constant-perceived-position contract those clips already keep
 * through trims and speed changes.
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
      `step ${miss.id ?? miss.step} (${miss.do}${miss.selector ? ` ${miss.selector}` : ''}) has no match in the new recording — times near it interpolate`,
    )
  }

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
    stepMap,
    newSteps,
    newDuration,
    report,
  )
  // The speed wand's contract: absent source = manual, always kept.
  const speed = retimeSpans(
    'speed',
    (prev.speed ?? []).filter((s) => s.source !== 'auto'),
    stepMap,
    newSteps,
    newDuration,
    report,
  )
  const tilt = retimeSpans(
    'tilt',
    (prev.tilt ?? []).filter((t) => t.source !== 'auto'),
    stepMap,
    newSteps,
    newDuration,
    report,
  )

  return { segments, zoom, speed, tilt, report }
}
