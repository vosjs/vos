import { formatDurationCap, planLimits } from '@vosjs/shared/limits'

/**
 * The hosted recording cap as `vos record` applies it: the
 * default for `--max-duration`, read from the one limits table. A CLI take
 * that runs past it is stopped at the cap so what lands is what vos.so hosts.
 */
export function defaultMaxDurationSeconds(): number {
  return planLimits().recordingMaxSeconds
}

/** True once the take has reached the cap — the recorder stops driving steps. */
export function capReached(elapsedMs: number, capSeconds: number): boolean {
  return elapsedMs >= capSeconds * 1000
}

/** A wait step never sleeps past the cap. */
export function clampWait(
  waitMs: number,
  elapsedMs: number,
  capSeconds: number,
): number {
  return Math.max(0, Math.min(waitMs, capSeconds * 1000 - elapsedMs))
}

/** The one line printed when the cap stopped the take. */
export function cappedLine(capSeconds: number): string {
  return `stopped at ${formatDurationCap(capSeconds)} (--max-duration ${capSeconds}); the remaining steps did not run`
}
