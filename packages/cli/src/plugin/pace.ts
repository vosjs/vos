/**
 * The recorder's pace — the pure parts.
 *
 * A take of a scripted flow should run as long as the script asks, plus the
 * gestures a person makes between the asks (the pointer's travel, the press,
 * the settle after it) and no more. Measured before this module (§4.5 of
 * the utility-clip retrospective), hovers ran 2× their ask, drags 4.8× and
 * a 25 s script recorded 42 s, for two reasons the numbers here answer:
 *
 *  - The motion loops counted STEPS (one per 16 ms of the asked duration)
 *    and awaited a `mouse.move` round trip per step, so a page that
 *    re-renders per move (a slider) stretched every gesture by the round
 *    trip. A gesture is now driven by the CLOCK: its position is a function
 *    of the elapsed time, and it ends when the asked duration has elapsed,
 *    however many samples the page allowed.
 *  - The settles after a gesture were fixed sleeps (500 ms after a click,
 *    250 after every selector lookup). A settle is DATA: `ms` on the step
 *    overrides a small default, and the script's own `wait` steps carry
 *    the intended pauses.
 */

/** Pointer travel: ms per CSS px, floor and ceiling — a person's hand. */
export const POINTER_MS_PER_PX = 0.7
export const POINTER_MIN_MS = 250
export const POINTER_MAX_MS = 800
/** The sample cadence a motion loop aims for. */
export const MOTION_TICK_MS = 16

/** The settle after a gesture when the step names none, by verb. */
export const SETTLE_MS = {
  click: 150,
  type: 150,
  scroll: 200,
  drag: 80,
} as const

/** The press: the pause before the button goes down, and the hold. */
export const PRESS_LEAD_MS = 80
export const PRESS_HOLD_MS = 70
/** The pause between a selector lookup that scrolled the page and the move. */
export const SCROLL_SETTLE_MS = 120
/** The hold after the last step, so the take does not cut on a press. */
export const TRAILING_HOLD_MS = 400

/** How long the pointer takes to travel `dist` CSS px. */
export function pointerTravelMs(dist: number): number {
  return Math.min(
    POINTER_MAX_MS,
    Math.max(POINTER_MIN_MS, Math.round(dist * POINTER_MS_PER_PX)),
  )
}

/** The settle after a step: its own `ms` when it names one, else the verb's. */
export function settleMs(step: { do: string; ms?: number }): number {
  if (typeof step.ms === 'number' && step.ms >= 0) return step.ms
  const d = step.do as keyof typeof SETTLE_MS
  return SETTLE_MS[d] ?? 0
}

export const easeInOutCubic = (u: number): number =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2

/**
 * Drive a motion by the clock: `at(u)` is called with the eased progress
 * for each sample, and the loop ends when `dur` ms have elapsed, with the
 * last call at u = 1 exactly. Between samples it sleeps to the next tick
 * only when the sample came back early; a slow sample (a page busy
 * re-rendering) is followed at once, so the gesture keeps its length and
 * loses samples, never the other way round.
 */
export async function clockMotion(
  dur: number,
  at: (u: number) => Promise<void>,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> },
): Promise<number> {
  const start = clock.now()
  let samples = 0
  for (;;) {
    const elapsed = clock.now() - start
    if (elapsed >= dur) break
    await at(easeInOutCubic(Math.min(1, elapsed / dur)))
    samples++
    const next =
      start + Math.ceil((clock.now() - start) / MOTION_TICK_MS) * MOTION_TICK_MS
    const wait = Math.min(next, start + dur) - clock.now()
    if (wait > 0) await clock.sleep(wait)
  }
  await at(1)
  return samples + 1
}

/**
 * Typing paced by the clock: the i-th character is due at `start + i·delay`;
 * after each keystroke the loop sleeps to the next due time only if the
 * keystroke came back early. A slow field (an editor re-rendering per key)
 * types as fast as it can and says so in the pace report.
 */
export async function clockTyping(
  chars: readonly string[],
  delay: number,
  type: (ch: string, index: number) => Promise<void>,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> },
): Promise<void> {
  const start = clock.now()
  for (let i = 0; i < chars.length; i++) {
    await type(chars[i], i)
    const due = start + (i + 1) * delay
    const wait = due - clock.now()
    if (wait > 0 && i < chars.length - 1) await clock.sleep(wait)
  }
}

/** One step's pace: what the script asked for it and what it took. */
export interface StepPace {
  step: number
  do: string
  /** The script's own ask: a wait's ms, a hover's dwell, a drag's ms, typing's chars × delay; 0 for a click or a scroll. */
  askedMs: number
  /** The gesture the recorder adds by design: pointer travel, the press, the settle. */
  gestureMs: number
  wallMs: number
}

export interface PaceReport {
  askedMs: number
  gestureMs: number
  wallMs: number
  /** Wall time neither asked nor a gesture: what the page and the round trips cost. */
  overheadMs: number
  overheadPct: number
  /** The steps whose wall ran past their ask plus gesture by more than a third. */
  slow: { step: number; do: string; askedMs: number; wallMs: number }[]
}

/** What a script asks of a step, in ms: the part of its wall time that is the author's. */
export function askedMs(step: {
  do: string
  ms?: number
  text?: string
  delayMs?: number
}): number {
  switch (step.do) {
    case 'wait':
      return step.ms ?? 0
    case 'hover':
      return step.ms ?? 700
    case 'drag':
      return step.ms ?? 700
    case 'type':
      return (step.text?.length ?? 0) * (step.delayMs ?? 40)
    default:
      return 0
  }
}

export function paceReport(steps: readonly StepPace[]): PaceReport {
  const askedMs = steps.reduce((a, s) => a + s.askedMs, 0)
  const gestureMs = steps.reduce((a, s) => a + s.gestureMs, 0)
  const wallMs = steps.reduce((a, s) => a + s.wallMs, 0)
  const overheadMs = Math.max(0, wallMs - askedMs - gestureMs)
  const slow = steps
    .filter((s) => s.wallMs > (s.askedMs + s.gestureMs) * 1.34 + 60)
    .map((s) => ({
      step: s.step,
      do: s.do,
      askedMs: s.askedMs,
      wallMs: s.wallMs,
    }))
  return {
    askedMs,
    gestureMs,
    wallMs,
    overheadMs,
    overheadPct: wallMs > 0 ? Math.round((overheadMs / wallMs) * 100) : 0,
    slow,
  }
}

/** The pace in one line for the log. */
export function paceLine(r: PaceReport): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`
  const slow = r.slow.length
    ? `; slow: ${r.slow.map((x) => `#${x.step} ${x.do} ${s(x.wallMs)} for ${s(x.askedMs)} asked`).join(', ')}`
    : ''
  return `pace: the script asked ${s(r.askedMs)}, the gestures added ${s(r.gestureMs)}, the take ran ${s(r.wallMs)} (${r.overheadPct} % overhead${slow})`
}
