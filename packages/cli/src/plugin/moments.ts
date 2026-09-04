/**
 * The moment: which instants of a take become its stills. Three rungs, in
 * order, each pure: the STEP timeline (every gesture's end plus a settle,
 * so the frame shows the response and not the travel), the zoom apexes
 * (the camera's own picks), an even spread. Then two guards over what was
 * actually captured: candidates that hash alike collapse to one (a kit of
 * eight crops of one frame is the failure this exists for), and a blank
 * candidate (a wallpaper, an empty canvas, a flat panel) is dropped with
 * the reason in words. No model; the numbers come from the pixels.
 */
import { ratedSegments, spanOutputExtent } from '@vosjs/studio-core'
import { hammingDistance } from './picture'
import type { ProjectDoc, StepSpan } from '@vosjs/studio-core'

/** Seconds after a gesture's end before the frame is read: the response has landed. */
export const STEP_SETTLE_SECONDS = 0.4

/** Steps that are not gestures: nothing happened on screen at their end. */
const NOT_A_GESTURE = new Set(['wait', 'goto', 'sleep'])

export interface MomentCandidate {
  /** OUTPUT seconds. */
  time: number
  /** Where it came from. */
  source: 'step' | 'zoom' | 'spread' | 'times'
  /** The step's id (or index) when source is 'step'. */
  step?: string | number
}

/**
 * Candidate still times for a take, in rung order. Steps first (skipped
 * steps and waits excluded, and a step whose settled instant falls outside
 * the cut drops silently), then zoom apexes, then the spread; duplicates
 * within 0.25 s are merged. `dropped` counts zoom apexes the cut trimmed
 * out, for the phase note.
 */
export function momentCandidates(
  doc: ProjectDoc,
  duration: number,
): { candidates: MomentCandidate[]; dropped: number } {
  const rated = ratedSegments(doc)
  const out: MomentCandidate[] = []
  const push = (c: MomentCandidate) => {
    if (c.time < 0 || c.time > duration) return
    if (out.some((o) => Math.abs(o.time - c.time) < 0.25)) return
    out.push(c)
  }
  const steps = doc.source.meta.steps ?? []
  for (const s of steps) {
    if (s.skipped || NOT_A_GESTURE.has(s.do)) continue
    const t = stepOutputTime(rated, s, STEP_SETTLE_SECONDS)
    if (t === null) continue
    push({ time: t, source: 'step', step: s.id ?? s.step })
  }
  let dropped = 0
  const apexes: number[] = []
  for (const z of doc.zoom) {
    const ext = spanOutputExtent(rated, z.in, z.out)
    if (ext) apexes.push((ext.start + ext.end) / 2)
    else dropped++
  }
  for (const t of apexes.sort((a, b) => a - b))
    push({ time: t, source: 'zoom' })
  if (!out.length) {
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9])
      push({ time: p * duration, source: 'spread' })
  }
  return { candidates: out, dropped }
}

/**
 * A step's settled instant in OUTPUT seconds (its gesture end plus the
 * settle, mapped through the cut), or null when the cut trimmed it out.
 */
export function stepOutputTime(
  rated: ReturnType<typeof ratedSegments>,
  step: Pick<StepSpan, 'tStart' | 'tEnd'>,
  settle: number,
): number | null {
  const src = step.tEnd + settle
  const ext = spanOutputExtent(rated, src, src + 0.001)
  if (!ext) return null
  return ext.start
}

/**
 * Resolve a `--times` entry of the form `step:<id>[+offset|-offset]` (the
 * id from actions.json, or the step's index) against the take's step
 * timeline, in OUTPUT seconds. Null when the entry is not a step form;
 * throws when the step is unknown or trimmed out.
 */
export function resolveStepTime(doc: ProjectDoc, entry: string): number | null {
  const m = /^step:([^+-]+)([+-]\d+(?:\.\d+)?)?$/.exec(entry.trim())
  if (!m) return null
  const key = m[1]
  const offset = m[2] ? Number(m[2]) : STEP_SETTLE_SECONDS
  const steps = doc.source.meta.steps ?? []
  const step =
    steps.find((s) => s.id === key) ??
    (/^\d+$/.test(key) ? steps.find((s) => s.step === Number(key)) : undefined)
  if (!step) {
    const known = steps
      .map((s) => s.id ?? String(s.step))
      .filter((s) => s.length)
    throw new Error(
      `--times ${entry}: no step "${key}" in the take's step timeline${known.length ? ` (steps: ${known.join(', ')})` : ' (the take carries none: record it with the current CLI)'}`,
    )
  }
  const t = stepOutputTime(ratedSegments(doc), step, offset)
  if (t === null)
    throw new Error(
      `--times ${entry}: step "${key}" (${step.tEnd.toFixed(2)}s in the recording) falls outside the cut`,
    )
  return t
}

export interface CandidateMeasure {
  time: number
  /** Ink coverage inside the frame's subject, 0..1. */
  ink: number
  /** Difference hash of the subject. */
  hash: string
}

export interface MomentPick {
  /** Times that survive, in candidate order. */
  times: number[]
  /** What was dropped, in words. */
  dropped: string[]
}

/** Hamming bits under which two candidates are one frame. */
export const DUPLICATE_BITS = 6

/**
 * Keep the candidates that are populated and distinct. The blank floor is
 * relative to the take (a fraction of the median ink across candidates,
 * with an absolute floor), so a dense page and a sparse app are each held
 * to their own norm; duplicates collapse to the FIRST of a pair, since
 * candidates arrive in rung order (a step beats an apex beats the spread).
 */
export function pickMoments(
  measured: CandidateMeasure[],
  opts: { minInk?: number; relativeInk?: number; duplicateBits?: number } = {},
): MomentPick {
  const minInk = opts.minInk ?? 0.06
  const relative = opts.relativeInk ?? 0.4
  const bits = opts.duplicateBits ?? DUPLICATE_BITS
  const inks = measured.map((m) => m.ink).sort((a, b) => a - b)
  const median = inks[inks.length >> 1] ?? 0
  const floor = Math.max(minInk, median * relative)
  const kept: CandidateMeasure[] = []
  const dropped: string[] = []
  for (const m of measured) {
    if (m.ink < floor) {
      dropped.push(
        `blank at ${m.time.toFixed(2)}s: ${Math.round(m.ink * 100)}% ink, the take's median is ${Math.round(median * 100)}%`,
      )
      continue
    }
    const twin = kept.find((k) => hammingDistance(k.hash, m.hash) <= bits)
    if (twin) {
      dropped.push(
        `${m.time.toFixed(2)}s is the same frame as ${twin.time.toFixed(2)}s`,
      )
      continue
    }
    kept.push(m)
  }
  // Every candidate blank: keep the best one rather than nothing, said.
  if (!kept.length && measured.length) {
    const best = [...measured].sort((a, b) => b.ink - a.ink)[0]
    kept.push(best)
    dropped.push(
      `every candidate is under the blank floor; kept ${best.time.toFixed(2)}s (${Math.round(best.ink * 100)}% ink) as the least empty`,
    )
  }
  return { times: kept.map((k) => k.time), dropped }
}
