/**
 * A step never runs past its own bound, however the page behaves. A page
 * that stops answering (a busy loop, a renderer stuck after a reload the
 * page made itself) leaves every driver call pending for good, and a poll
 * that reads it waits on the read, not on its clock: an `expect` that said
 * "for 5 s" ran for fifteen minutes. So the page the recorder drives is
 * BOUNDED: while a step runs, every call into it is raced against the
 * step's deadline, and once the deadline has passed a pending call answers
 * `undefined` (what an absent element answers) instead of waiting. The
 * step then ends as a skip with the real time it took; the call it left
 * pending is abandoned, never awaited.
 *
 * Between steps the same race holds with a looser bound, so the take's
 * own finish (its last reads, the page's title) cannot hang either.
 */

/** A gesture's bound past what it planned to take. */
export const STEP_MARGIN_MS = 30_000
/** A check's (`expect`, `await`) bound past its own timeout. */
export const WAIT_MARGIN_MS = 5000
/** One call's bound while no step runs (a navigation has its own 45 s timeout). */
export const IDLE_CALL_MS = 60_000

/** The bound of one step, in ms: its own timeout for a check, its plan plus a margin for a gesture. */
export function stepBoundMs(
  step: {
    do: string
    timeout?: number
    until?: unknown
    reload?: boolean
  },
  plannedMs: number,
  defaults: { expectS: number; awaitS: number; downloadS: number },
): number {
  if (step.do === 'expect')
    return (step.timeout ?? defaults.expectS) * 1000 + WAIT_MARGIN_MS
  if (step.do === 'await')
    return (step.timeout ?? defaults.awaitS) * 1000 + STEP_MARGIN_MS
  if (step.do === 'download') return defaults.downloadS * 1000 + STEP_MARGIN_MS
  return plannedMs + STEP_MARGIN_MS
}

export class StepBound {
  private deadline: number | null = null
  private started = 0
  private hung = false

  constructor(
    private readonly now: () => number = Date.now,
    private readonly idleMs = IDLE_CALL_MS,
  ) {}

  /** A step begins: calls into the page answer within `boundMs` from now. */
  start(boundMs: number): void {
    this.started = this.now()
    this.deadline = this.started + boundMs
    this.hung = false
  }

  /** The step ends: whether it ran into its bound, and how long it really took. */
  end(): { hung: boolean; ms: number; boundMs: number } {
    const out = {
      hung: this.hung,
      ms: this.now() - this.started,
      boundMs: (this.deadline ?? this.started) - this.started,
    }
    this.deadline = null
    this.hung = false
    return out
  }

  /** The pending call, or `undefined` once the bound has passed. */
  race<T>(p: Promise<T>): Promise<T> {
    const left =
      this.deadline === null ? this.idleMs : this.deadline - this.now()
    if (left <= 0) {
      this.hung = true
      p.catch(() => {})
      return Promise.resolve(undefined as T)
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.hung = true
        resolve(undefined as T)
      }, left)
      p.then(
        (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        (e: unknown) => {
          clearTimeout(timer)
          reject(e)
        },
      )
    })
  }
}

/**
 * `target` with every method that answers a promise raced through the
 * guard, and every object it hands back (`page.mouse`, `locator()`,
 * `.first()`) guarded the same way. A call is made on the real object, so
 * nothing private to the driver is touched through the proxy.
 */
export function bounded<T extends object>(target: T, bound: StepBound): T {
  const cache = new WeakMap<object, object>()
  const wrap = <O extends object>(obj: O): O => {
    const had = cache.get(obj)
    if (had) return had as O
    const proxy = new Proxy(obj, {
      get(t, prop) {
        const value: unknown = Reflect.get(t, prop, t)
        if (typeof value === 'function')
          return (...args: unknown[]) => {
            const out: unknown = (value as (...a: unknown[]) => unknown).apply(
              t,
              args,
            )
            if (out && typeof (out as Promise<unknown>).then === 'function')
              return bound.race(out as Promise<unknown>)
            if (out && typeof out === 'object' && out !== t) return wrap(out)
            return out
          }
        if (value && typeof value === 'object') return wrap(value)
        return value
      },
    })
    cache.set(obj, proxy)
    return proxy
  }
  return wrap(target)
}
