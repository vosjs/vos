/**
 * The take's clock: ONE path from a wall-clock instant to footage time,
 * for the cursor events and for every screencast frame alike.
 *
 * Footage time is wall time since `t0` minus every off-camera stretch (an
 * `await`) that began before the instant; an instant inside a stretch reads
 * as the stretch's start, which is where the cut is. A frame is placed by
 * the instant it was CAPTURED, never by when its callback ran: a frame in
 * flight when the capture paused lands after the resume and must still sit
 * before the cut.
 *
 * Frame times are strictly increasing. The screencast does not promise it:
 * a frame can arrive after a later one, and a frame without a capture
 * timestamp is stamped by its arrival, a second clock. A frame whose time
 * is not later than the last one kept holds older pixels than what the
 * footage already shows, so it is DROPPED (never re-stamped forward, which
 * would put a stale picture after a newer one).
 */
export class TakeClock {
  private readonly pauses: { from: number; to: number | null }[] = []
  private lastFrameMs = -1

  constructor(readonly t0: number) {}

  /** Footage ms at a wall-clock instant (`Date.now()` space). */
  footageMs(wallMs: number): number {
    let off = 0
    for (const p of this.pauses) {
      if (wallMs <= p.from) break
      off += Math.min(wallMs, p.to ?? Infinity) - p.from
    }
    return wallMs - this.t0 - off
  }

  /** The camera stops at this instant; returns the cut's footage ms. */
  pause(wallMs: number): number {
    const at = this.footageMs(wallMs)
    this.pauses.push({ from: wallMs, to: null })
    return at
  }

  /** The camera rolls again; returns the wall ms the stretch lasted. */
  resume(wallMs: number): number {
    const open = this.pauses[this.pauses.length - 1] as
      | { from: number; to: number | null }
      | undefined
    if (!open || open.to !== null) return 0
    open.to = Math.max(open.from, wallMs)
    return open.to - open.from
  }

  /**
   * A captured frame's footage ms, or null when it is not later than the
   * last frame kept (the frame is dropped; see the module comment).
   */
  placeFrame(captureWallMs: number): number | null {
    const t = Math.max(0, Math.round(this.footageMs(captureWallMs)))
    if (t <= this.lastFrameMs) return null
    this.lastFrameMs = t
    return t
  }
}
