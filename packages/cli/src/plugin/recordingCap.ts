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
 *
 * How the recorder APPLIES a cap (reached, clamp, the words) is mechanism
 * and lives in `@vosjs/render-core/record` (AN4); re-exported here.
 */
export {
  capReached,
  cappedLine,
  clampWait,
  formatDurationCap,
} from '@vosjs/render-core/record'

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
