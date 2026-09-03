/**
 * The hosted recording cap as `vos record` applies it: the default for
 * `--max-duration`. A CLI take that runs past it is stopped at the cap so
 * what lands is what vos.so hosts.
 *
 * The number's home is the platform's plan table, served public at
 * `GET /api/limits`; `hostedRecordingCap` reads it before a take (with the
 * caller's key when one resolves, so a plan with a longer cap gets it).
 * The constant below is the offline fallback, stated here because this is
 * the platform client. `--max-duration` overrides either for a take that
 * never leaves the machine.
 */
export const HOSTED_RECORDING_CAP_SECONDS = 30 * 60

/**
 * The cap in a limits payload, or null when the payload is not one: an
 * integer number of seconds above zero under `limits.recordingMaxSeconds`.
 */
export function parseHostedCap(body: unknown): number | null {
  const limits =
    body && typeof body === 'object'
      ? (body as { limits?: { recordingMaxSeconds?: unknown } }).limits
      : undefined
  const cap = limits?.recordingMaxSeconds
  return typeof cap === 'number' && Number.isInteger(cap) && cap > 0
    ? cap
    : null
}

/**
 * The hosted cap read live from `GET /api/limits`. Bounded and fail-open:
 * null within ~2 s or on any refusal, and the caller uses the constant.
 * A key, when given, asks for the caller's own plan.
 */
export async function hostedRecordingCap(
  origin: string,
  key?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 2000)
  try {
    const res = await fetchImpl(`${origin.replace(/\/+$/, '')}/api/limits`, {
      signal: ctl.signal,
      ...(key ? { headers: { authorization: `Bearer ${key}` } } : {}),
    })
    if (!res.ok) return null
    return parseHostedCap(await res.json())
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

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
