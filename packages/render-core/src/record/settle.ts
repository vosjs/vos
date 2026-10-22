/**
 * A gesture that waits on the app (`settle`): after the gesture, the
 * recorder waits until the page has made no DOM change and painted no new
 * frame for a beat, at most a few seconds. A heavy canvas falls behind
 * under load, and a script paced by the wall clock then outruns it: the
 * next stroke is drawn before the app has processed the last one.
 *
 * The DOM half is the recorder's one DOM-settle reader (`domSettled`, the
 * same an `await`'s reload lets the page finish with). The paint half is
 * the screencast: it emits a frame only when the compositor painted
 * something new, a canvas redrawn by `requestAnimationFrame` included, and
 * it is read from here rather than by an animation frame in the page,
 * which a background tab never fires. The two are one count: the page's
 * DOM changes plus the frames captured so far. A rehearsal captures no
 * frames, so there it waits on the DOM alone.
 */
import type { RecorderPage } from './driver'
import { domSettled } from './waits'

/** The quiet a settle waits for: no DOM change and no new frame, ms. */
export const APP_QUIET_MS = 300
/** The longest a settle waits on a page that never stops changing, ms. */
export const APP_SETTLE_CAP_MS = 4000

/** The verbs a settle follows: the ones that send the page input. */
export const SETTLE_VERBS = new Set([
  'hover',
  'click',
  'type',
  'press',
  'scroll',
  'move',
  'drag',
  'paste',
])

/** Whether a step waits on the app after its gesture: its own `settle`, else the script's. */
export function settleOn(
  step: { do: string; settle?: boolean },
  scriptDefault: boolean | undefined,
): boolean {
  if (!SETTLE_VERBS.has(step.do)) return false
  return step.settle ?? scriptDefault ?? false
}

/**
 * Wait for the app: no DOM change and no new captured frame for `quietMs`,
 * at most `capMs`. `frames` reads how many frames the capture has kept.
 */
export async function appSettled(
  page: Pick<RecorderPage, 'evaluate'>,
  frames: () => number,
  opts: {
    sleep: (ms: number) => Promise<void>
    now?: () => number
    quietMs?: number
    capMs?: number
  },
): Promise<{ settled: boolean; ms: number }> {
  // The DOM reader polls the page's change count; this hands it the count
  // with the frames added, so a paint is a change like a mutation is.
  const counted = {
    evaluate: async (script: string) => {
      const n = await page.evaluate<number>(script).catch(() => 0)
      return (typeof n === 'number' && n > 0 ? n : 0) + frames()
    },
  } as unknown as RecorderPage
  return domSettled(counted, {
    sleep: opts.sleep,
    ...(opts.now ? { now: opts.now } : {}),
    quietMs: opts.quietMs ?? APP_QUIET_MS,
    capMs: opts.capMs ?? APP_SETTLE_CAP_MS,
    tickMs: 50,
  })
}
