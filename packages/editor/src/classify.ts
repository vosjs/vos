/**
 * Live-edit tier classifier. Given the previously-delivered lowered
 * composition and the next one, decide the cheapest playback-bridge commands
 * that make the running player match:
 *
 *   program changed        → warm `LOAD` (re-init, transport preserved in-engine;
 *                            carries the latest data)
 *   data changed           → `SET_DATA` (live, no re-init)
 *   duration changed       → `SET_DURATION` when the running program supports it
 *                            (`READY.canSetDuration`), else fall back to LOAD
 *   a stack entry's data   → `SET_DATA { target }` for that entry alone
 *                            (bridge protocol 5); a LOAD carries every entry's
 *                            data as `stack`
 *   tween edits changed    → `SET_TWEEN_EDITS { edits }` (protocol 8): the
 *                            running timeline retimes live; a LOAD carries
 *                            the overlay as `tweenEdits`. The program string
 *                            never moves on a retime.
 *
 * The program string is the structural hash — no field lists, no heuristics.
 * Editors that lower to a CONSTANT interpreter program (all editable state in
 * `ctx.data`) get live editing for every document change by construction.
 * Pure and framework-free: the host owns transport and message plumbing; this
 * owns the decision.
 */

export interface LoweredProgram {
  program: string
  data?: Record<string, unknown>
  /** Output duration in seconds; omit when the host doesn't manage duration. */
  duration?: number
  /**
   * Per-entry data for the program's `stack` (`config.stack[].id` → its own
   * `ctx.data`). Each entry is diffed by reference on its own, like `data`.
   */
  stack?: Record<string, Record<string, unknown>>
  /**
   * The tween-timing overlay (the recorder's `TweenEdit[]`, structurally),
   * diffed by reference. Absent means "none", the same as `[]`.
   */
  tweenEdits?: readonly TweenEditLike[]
}

export interface TweenEditLike {
  index: number
  startTime?: number
  duration?: number
  ease?: string
  to?: Record<string, number>
  from?: Record<string, number>
}

export type SessionCommand =
  | {
      type: 'LOAD'
      code: string
      data?: Record<string, unknown>
      stack?: Record<string, Record<string, unknown>>
      tweenEdits?: readonly TweenEditLike[]
    }
  | { type: 'SET_DATA'; data: Record<string, unknown>; target?: string }
  | { type: 'SET_TWEEN_EDITS'; edits: readonly TweenEditLike[] }
  | { type: 'SET_DURATION'; value: number }

const EPSILON = 1e-6

function load(next: LoweredProgram): SessionCommand {
  const cmd: SessionCommand = {
    type: 'LOAD',
    code: next.program,
    data: next.data,
  }
  if (next.stack) cmd.stack = next.stack
  if (next.tweenEdits) cmd.tweenEdits = next.tweenEdits
  return cmd
}

export function classifyEdit(
  prev: LoweredProgram | null,
  next: LoweredProgram,
  canSetDuration: boolean,
): SessionCommand[] {
  if (!prev || prev.program !== next.program) {
    return [load(next)]
  }

  const durationChanged =
    next.duration !== undefined &&
    prev.duration !== undefined &&
    Math.abs(next.duration - prev.duration) > EPSILON

  // Duration changed but the running program can't retime → one warm LOAD
  // (it re-inits the carrier from data.duration and carries the data anyway).
  if (durationChanged && !canSetDuration) {
    return [load(next)]
  }

  const commands: SessionCommand[] = []
  if (next.data !== undefined && next.data !== prev.data) {
    commands.push({ type: 'SET_DATA', data: next.data })
  }
  if (next.stack) {
    for (const [target, data] of Object.entries(next.stack)) {
      if (data !== prev.stack?.[target]) {
        commands.push({ type: 'SET_DATA', data, target })
      }
    }
  }
  if (next.tweenEdits !== prev.tweenEdits) {
    commands.push({ type: 'SET_TWEEN_EDITS', edits: next.tweenEdits ?? [] })
  }
  // After SET_DATA, so a rebuilt carrier and fresh data can never disagree.
  if (durationChanged) {
    commands.push({ type: 'SET_DURATION', value: next.duration! })
  }
  return commands
}
