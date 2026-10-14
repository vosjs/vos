/**
 * Auto-speed planner: propose speed-up spans for the three
 * stretches everyone compresses in a screen recording — typing passages,
 * long scrolls, and idle gaps — read deterministically from the cursor track.
 * The wand contract is auto-zoom's: spans arrive `source:'auto'`, any gesture
 * promotes to 'manual', and a re-plan replaces only the auto ones.
 *
 * Signals, in priority order (higher wins an overlap):
 *  1. TYPING — `key` activity pings grouped into sessions (the typing-zoom
 *     grouping rule: a ping joins while the silence stays small). The caret is the
 *     actor and nothing else moves, so 3× still reads.
 *  2. SCROLL — runs of `scroll` events with small gaps: skimming.
 *  3. IDLE — a gap between ANY two consecutive events (plus the head before
 *     the first and the tail after the last): nothing happened at all. Padded
 *     so the moment of stopping and resuming plays at 1×.
 *
 * Deterministic, pure, and empty-track-safe (a browser-recorder take with no
 * cursor track plans nothing).
 */
import { clampSpeedRate } from '../types'
import type { CursorEvent, SpeedSpan, StepSpan } from '../types'

export interface SpeedParams {
  /** Seconds of no input at all before a stretch counts as idle. */
  idleMin: number
  /** Rate applied to idle stretches. */
  idleRate: number
  /** Seconds a typing session must last to earn a span. */
  typingMin: number
  /** Rate applied to typing passages. */
  typingRate: number
  /** Seconds a scroll run must last to earn a span. */
  scrollMin: number
  /** Rate applied to scroll runs. */
  scrollRate: number
  /**
   * Rate applied to a scripted `wait` or a hover's dwell in which nothing
   * moved on screen: the flow's own pauses, read from the step timeline
   * with the digest's activity as the witness.
   */
  stillRate: number
}

/** Conservative defaults: only stretches nobody wants to watch in real time. */
export const DEFAULT_SPEED_PARAMS: SpeedParams = {
  idleMin: 5,
  idleRate: 4,
  typingMin: 3,
  typingRate: 3,
  scrollMin: 2.5,
  scrollRate: 2,
  stillRate: 2,
}

/** Max silence inside a typing session (mirrors the typing-zoom grouping scale). */
const TYPING_GAP = 1.5
/** Max gap inside a scroll run. */
const SCROLL_GAP = 0.8
/** Idle spans start/end this far inside the gap so stop/resume play at 1×. */
const IDLE_PAD = 0.6
/** Shortest span worth proposing (source seconds). */
const MIN_SPAN = 1
/**
 * An idle gap whose measured frame activity (the digest's per-second
 * changed-pixel fraction) averages above this is the video PLAYING — the
 * recording's own playback, a render in progress — not idle. Speeding it up
 * compresses the payoff. Five real takes (2026-08-25) each had one; the
 * cursor track alone cannot tell, so this needs the activity witness, and
 * without one (the studio's ingest) the gap still plans as idle.
 */
export const PLAYBACK_ACTIVITY = 0.1
/**
 * A scripted pause (a `wait`, a hover's dwell) whose measured frame
 * activity averages below this is STILL: nothing moved while the script
 * waited, so the pause plays at the still rate. Needs the activity
 * witness; without one the cursor track cannot tell a page loading from
 * a page at rest, and no still span is proposed.
 */
export const STILL_ACTIVITY = 0.02

interface Candidate {
  in: number
  out: number
  rate: number
}

export function planAutoSpeed(
  track: readonly CursorEvent[],
  opts: {
    durationMs: number
    params?: Partial<SpeedParams>
    /** Per-SOURCE-second motion bins (0..1) when a digest measured them. */
    activity?: readonly number[] | null
    /**
     * The step timeline of a scripted take (`meta.steps`): the flow's own
     * pauses become still spans when the activity witness says nothing
     * moved in them.
     */
    steps?: readonly StepSpan[] | null
  },
): SpeedSpan[] {
  const p = { ...DEFAULT_SPEED_PARAMS, ...opts.params }
  const durS = opts.durationMs / 1000
  if (!track.length || !(durS > 0)) return []
  const evs = [...track].sort((a, b) => a.t - b.t)

  const cands: Candidate[] = []

  // 1. typing sessions
  collectRuns(
    evs.filter((e) => e.type === 'key'),
    TYPING_GAP,
    p.typingMin,
    (start, last) => cands.push({ in: start, out: last, rate: p.typingRate }),
  )

  // 2. scroll runs
  collectRuns(
    evs.filter((e) => e.type === 'scroll'),
    SCROLL_GAP,
    p.scrollMin,
    (start, last) => cands.push({ in: start, out: last, rate: p.scrollRate }),
  )

  // 3. the flow's own pauses: a `wait` step, or a hover's dwell, in which
  //    the frame measured still. Only with the witness: a page loading
  //    behind a wait is not a pause to compress.
  for (const [a, b] of stillSteps(opts.steps, opts.activity)) {
    if (b - a >= MIN_SPAN) cands.push({ in: a, out: b, rate: p.stillRate })
  }
  // 4. idle gaps — between ANY events, plus the head and the tail
  for (const [a, b] of idleGaps(evs, durS, p.idleMin)) {
    if (isPlayback(opts.activity, a, b)) continue
    const start = a + IDLE_PAD
    const end = b - IDLE_PAD
    if (end - start >= MIN_SPAN)
      cands.push({ in: start, out: end, rate: p.idleRate })
  }

  // Resolve overlaps by priority (candidates arrive typing → scroll → idle):
  // a later candidate is clipped to the space the accepted ones left, and a
  // clipped crumb below MIN_SPAN is dropped.
  const accepted: Candidate[] = []
  for (const c of cands) {
    let pieces: Candidate[] = [
      { ...c, in: Math.max(0, c.in), out: Math.min(durS, c.out) },
    ]
    for (const a of accepted) {
      pieces = pieces.flatMap((pc) => {
        if (pc.out <= a.in || pc.in >= a.out) return [pc]
        const kept: Candidate[] = []
        if (a.in - pc.in >= MIN_SPAN) kept.push({ ...pc, out: a.in })
        if (pc.out - a.out >= MIN_SPAN) kept.push({ ...pc, in: a.out })
        return kept
      })
    }
    accepted.push(...pieces.filter((pc) => pc.out - pc.in >= MIN_SPAN))
  }

  accepted.sort((a, b) => a.in - b.in)
  return accepted.map((c, i) => ({
    id: `s${i}`,
    in: round(c.in),
    out: round(c.out),
    rate: clampSpeedRate(c.rate),
    source: 'auto' as const,
  }))
}

/**
 * Scroll runs as [start, last] seconds — the same grouping the speed planner
 * proposes 2× over, exported for the take digest.
 */
export function scrollRuns(
  track: readonly CursorEvent[],
  minLen = 1,
): [number, number][] {
  const out: [number, number][] = []
  collectRuns(
    [...track].filter((e) => e.type === 'scroll').sort((a, b) => a.t - b.t),
    SCROLL_GAP,
    minLen,
    (a, b) => out.push([a, b]),
  )
  return out
}

/**
 * Idle gaps as [start, end] seconds: no event of ANY kind for ≥ idleMin,
 * head and tail included — the digest's `idle` moments and the speed
 * planner's 4× candidates come from this one derivation.
 */
export function idleGaps(
  track: readonly CursorEvent[],
  durationS: number,
  idleMin = DEFAULT_SPEED_PARAMS.idleMin,
): [number, number][] {
  const gaps: [number, number][] = []
  let prev = 0
  for (const e of [...track].sort((a, b) => a.t - b.t)) {
    const t = e.t / 1000
    if (t - prev >= idleMin) gaps.push([prev, t])
    if (t > prev) prev = t
  }
  if (durationS - prev >= idleMin) gaps.push([prev, durationS])
  return gaps
}

/**
 * The scripted pauses in which nothing moved, as [start, end] source
 * seconds: every `wait` step between the first and the last doing step,
 * and every `hover` step, whose mean activity is below STILL_ACTIVITY.
 * Empty without steps or without the witness.
 */
export function stillSteps(
  steps: readonly StepSpan[] | null | undefined,
  activity: readonly number[] | null | undefined,
): [number, number][] {
  if (!steps?.length || !activity?.length) return []
  // The flow's opening and closing waits are the clip's establishing and
  // resting beats, where the page is seen before and after the doing:
  // never compressed.
  const live = steps.filter((st) => !st.skipped)
  const doing = live.map((st) => st.do !== 'wait')
  const first = doing.indexOf(true)
  const last = doing.lastIndexOf(true)
  const out: [number, number][] = []
  for (const [i, st] of live.entries()) {
    if (st.do !== 'wait' && st.do !== 'hover') continue
    if (st.do === 'wait' && (first < 0 || i < first || i > last)) continue
    if (meanActivity(activity, st.tStart, st.tEnd) >= STILL_ACTIVITY) continue
    out.push([st.tStart, st.tEnd])
  }
  return out
}

function meanActivity(
  activity: readonly number[],
  a: number,
  b: number,
): number {
  const lo = Math.max(0, Math.floor(a))
  const hi = Math.min(activity.length, Math.ceil(b))
  if (hi <= lo) return 0
  let sum = 0
  for (let i = lo; i < hi; i++) sum += activity[i]
  return sum / (hi - lo)
}

/** Mean activity over [a, b) source seconds exceeds PLAYBACK_ACTIVITY. */
export function isPlayback(
  activity: readonly number[] | null | undefined,
  a: number,
  b: number,
): boolean {
  if (!activity?.length) return false
  const lo = Math.max(0, Math.floor(a))
  const hi = Math.min(activity.length, Math.ceil(b))
  if (hi <= lo) return false
  let sum = 0
  for (let i = lo; i < hi; i++) sum += activity[i]
  return sum / (hi - lo) > PLAYBACK_ACTIVITY
}

/** Group events into runs: one joins while the silence stays ≤ gap. */
function collectRuns(
  evs: readonly CursorEvent[],
  gap: number,
  minLen: number,
  emit: (startS: number, lastS: number) => void,
) {
  let start = -1
  let last = -1
  const flush = () => {
    if (start >= 0 && last - start >= minLen) emit(start, last)
  }
  for (const e of evs) {
    const t = e.t / 1000
    if (start >= 0 && t - last <= gap) {
      last = t
    } else {
      flush()
      start = t
      last = t
    }
  }
  flush()
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
