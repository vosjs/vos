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
}

export type SessionCommand =
  | { type: 'LOAD'; code: string; data?: Record<string, unknown> }
  | { type: 'SET_DATA'; data: Record<string, unknown> }
  | { type: 'SET_DURATION'; value: number }

const EPSILON = 1e-6

export function classifyEdit(
  prev: LoweredProgram | null,
  next: LoweredProgram,
  canSetDuration: boolean,
): SessionCommand[] {
  if (!prev || prev.program !== next.program) {
    return [{ type: 'LOAD', code: next.program, data: next.data }]
  }

  const durationChanged =
    next.duration !== undefined &&
    prev.duration !== undefined &&
    Math.abs(next.duration - prev.duration) > EPSILON

  // Duration changed but the running program can't retime → one warm LOAD
  // (it re-inits the carrier from data.duration and carries the data anyway).
  if (durationChanged && !canSetDuration) {
    return [{ type: 'LOAD', code: next.program, data: next.data }]
  }

  const commands: SessionCommand[] = []
  if (next.data !== undefined && next.data !== prev.data) {
    commands.push({ type: 'SET_DATA', data: next.data })
  }
  // After SET_DATA, so a rebuilt carrier and fresh data can never disagree.
  if (durationChanged) {
    commands.push({ type: 'SET_DURATION', value: next.duration! })
  }
  return commands
}
