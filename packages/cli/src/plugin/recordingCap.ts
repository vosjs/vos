/**
 * The hosted recording cap as `vos record` applies it: the default for
 * `--max-duration`. A CLI take that runs past it is stopped at the cap so
 * what lands is what vos.so hosts.
 *
 * The number is vos.so's, stated here because this is the platform client
 * (the plan table itself lives on the platform, beside the guards that
 * enforce it). `--max-duration` overrides it for a take that never leaves
 * the machine.
 */
export const HOSTED_RECORDING_CAP_SECONDS = 30 * 60

export function defaultMaxDurationSeconds(): number {
  return HOSTED_RECORDING_CAP_SECONDS
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

/** `30 min`, `1 h 30 min`, `45 s` — the duration cap in words. */
export function formatDurationCap(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

/** The one line printed when the cap stopped the take. */
export function cappedLine(capSeconds: number): string {
  return `stopped at ${formatDurationCap(capSeconds)} (--max-duration ${capSeconds}); the remaining steps did not run`
}
