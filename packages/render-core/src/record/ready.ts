/**
 * When a page counts as ready for the take to begin. The default is the
 * DOM: after `load`, the page must make no DOM change for a beat (counted
 * from outside, the way an `await` reload's settle is), at most a few
 * seconds. Network idle is the opt-in: plenty of real apps hold a socket
 * open or keep an analytics beacon going and never go network-idle, so a
 * take that waited for it started after its whole timeout, every time.
 */
import type { RecorderPage, RecorderResponse } from './driver'
import { realSleep } from './driver'
import { DOM_QUIET_MS, domSettled } from './waits'

/** How a page counts as ready: its DOM settled (default), or its network went idle. */
export type ReadyMode = 'networkidle' | 'settle'
export const READY_MODES: readonly ReadyMode[] = ['settle', 'networkidle']
export const DEFAULT_READY: ReadyMode = 'settle'

/** The longest a navigation waits for `load` or network idle. */
export const NAV_TIMEOUT_MS = 45_000
/** The longest the settle waits on a page that never stops changing. */
export const READY_SETTLE_CAP_MS = 8000
/** After network idle, the beat a hydration takes (what the recorder always gave it). */
export const NETWORKIDLE_HYDRATION_MS = 800

/** How the first load settled: the done event's `ready`. */
export interface ReadyReport {
  mode: ReadyMode
  /** ms from the navigation's start until the page counted as ready */
  ms: number
  /**
   * The wait gave up instead of the page settling: the DOM never stopped
   * changing within the cap (settle), or network idle never came within
   * the navigation timeout (networkidle). Recorded anyway either way.
   */
  capped: boolean
}

/** Why a ready mode is not one, or null. */
export function readyProblem(v: unknown): string | null {
  if (v === undefined) return null
  return typeof v === 'string' && (READY_MODES as string[]).includes(v)
    ? null
    : `ready must be ${READY_MODES.map((m) => `"${m}"`).join(' or ')}`
}

export interface ReadyOpts {
  sleep: (ms: number) => Promise<void>
  now?: () => number
  /** the settle's cap (default `READY_SETTLE_CAP_MS`) */
  capMs?: number
  /** the navigation's own timeout (default `NAV_TIMEOUT_MS`) */
  timeoutMs?: number
}

/**
 * Wait for a page that is navigating (or has just navigated) to be ready:
 * `navigate` starts the navigation with the `waitUntil` the mode asks for;
 * in `settle` mode the DOM settle follows `load`. A navigation that times
 * out is not fatal: the take goes on from whatever the page shows, and the
 * report says it was capped.
 */
export async function untilReady(
  page: RecorderPage,
  mode: ReadyMode,
  navigate: (opts: {
    waitUntil: 'networkidle' | 'load'
    timeout: number
  }) => Promise<RecorderResponse | null>,
  opts: ReadyOpts,
): Promise<{ response: RecorderResponse | null; ready: ReadyReport }> {
  const now = opts.now ?? Date.now
  const start = now()
  const timeout = opts.timeoutMs ?? NAV_TIMEOUT_MS
  if (mode === 'networkidle') {
    let idle = true
    const response = await navigate({
      waitUntil: 'networkidle',
      timeout,
    }).catch(() => {
      idle = false
      return null
    })
    await opts.sleep(NETWORKIDLE_HYDRATION_MS)
    return {
      response,
      ready: { mode, ms: Math.round(now() - start), capped: !idle },
    }
  }
  const response = await navigate({ waitUntil: 'load', timeout }).catch(
    () => null,
  )
  const settled = await domSettled(page, {
    sleep: opts.sleep,
    now,
    quietMs: DOM_QUIET_MS,
    capMs: opts.capMs ?? READY_SETTLE_CAP_MS,
  })
  return {
    response,
    ready: { mode, ms: Math.round(now() - start), capped: !settled.settled },
  }
}

/**
 * An `await`'s reload between polls, under the take's ready mode: the
 * reload waits for `load` (settle) or network idle (networkidle), at most
 * the await's own timeout, and then the DOM settles either way, because
 * network quiet is not a drawn page (a list rendered from its data lands
 * after it). A page that never goes network-idle no longer costs a whole
 * navigation timeout per poll.
 */
export async function reloadUntilReady(
  page: RecorderPage,
  mode: ReadyMode,
  timeoutMs: number,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const nav = {
    waitUntil:
      mode === 'networkidle' ? ('networkidle' as const) : ('load' as const),
    timeout: Math.min(NAV_TIMEOUT_MS, timeoutMs),
  }
  await (page.reload ? page.reload(nav) : page.goto(page.url(), nav)).catch(
    () => null,
  )
  await domSettled(page, { sleep: opts.sleep ?? realSleep })
}

/** The ready report in words, for the take's log. */
export function readyLine(r: ReadyReport): string {
  const s = (r.ms / 1000).toFixed(1)
  if (r.mode === 'networkidle')
    return r.capped
      ? `(networkidle timeout after ${s} s, continuing)`
      : `(network idle after ${s} s)`
  return r.capped
    ? `(the page was still changing after ${s} s, starting anyway)`
    : `(the page settled after ${s} s)`
}
