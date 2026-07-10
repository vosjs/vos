/**
 * The recording facade.
 *
 * `createTweenRecorder(backend?)` returns an object shaped like the slice of `gsap`
 * that `createTimeline` uses (`.timeline()`, plus a pure `utils` subset). The timeline
 * it returns is a `RecordingTimeline`: it captures every `.to/.from/.fromTo/.set` as a
 * `TweenSpec` (resolving GSAP position parameters to absolute times) AND, when a real
 * `gsap` backend is supplied, forwards the identical call so live playback is unchanged.
 * With no backend it is a pure recorder for host-side extraction.
 */
import { TargetResolver } from './target'
import { parseVars } from './vars'
import type { TweenSpec, TweenTarget } from './types'

/** A structural slice of a real gsap timeline the recorder can delegate to. */
export interface TimelineBackend {
  to(target: unknown, vars: object, position?: number | string): unknown
  from(target: unknown, vars: object, position?: number | string): unknown
  fromTo(target: unknown, fromVars: object, toVars: object, position?: number | string): unknown
  set(target: unknown, vars: object, position?: number | string): unknown
  add(child: unknown, position?: number | string): unknown
  addLabel(label: string, position?: number | string): unknown
  pause(): unknown
  play(): unknown
  seek(time: number, suppressEvents?: boolean): unknown
  clear(): unknown
  timeScale(value: number): unknown
  time(): number
  progress(): number
  duration(): number
  totalDuration(): number
  eventCallback(type: string, callback?: (...args: unknown[]) => void): unknown
  data?: unknown
}

/** A gsap-shaped backend factory (real `gsap`, or `gsap` module). */
export interface GsapBackend {
  timeline(vars?: object): TimelineBackend
  utils?: Record<string, unknown>
}

/** Tracks the insertion cursor + labels so GSAP position params resolve to absolute time. */
class PositionState {
  /** Current timeline duration = max end of all children (seconds). */
  end = 0
  /** Start/end of the most recently inserted child (for `'<'` / `'>'`). */
  lastStart = 0
  lastEnd = 0
  labels = new Map<string, number>()

  private offset(rest: string): number {
    const s = rest.trim()
    if (!s) return 0
    if (s.startsWith('+=')) return Number(s.slice(2))
    if (s.startsWith('-=')) return -Number(s.slice(2))
    return Number(s)
  }

  resolve(position: number | string | undefined): number {
    if (position == null) return this.end
    if (typeof position === 'number') return position
    const p = position.trim()
    if (p.startsWith('+=')) return this.end + Number(p.slice(2))
    if (p.startsWith('-=')) return this.end - Number(p.slice(2))
    if (p.startsWith('<')) return this.lastStart + this.offset(p.slice(1))
    if (p.startsWith('>')) return this.lastEnd + this.offset(p.slice(1))
    // label [±= x]
    const rel = p.search(/[+-]=/)
    if (rel !== -1) {
      const name = p.slice(0, rel).trim()
      const base = this.labels.get(name) ?? this.end
      return base + this.offset(p.slice(rel))
    }
    if (this.labels.has(p)) return this.labels.get(p)!
    // Unknown string → append at end (GSAP treats unrecognized labels as new labels
    // at the end; we approximate by appending).
    return this.end
  }

  /** Record an inserted child spanning [start, start+totalDur]; advance the cursor. */
  advance(start: number, totalDur: number): void {
    const childEnd = start + totalDur
    this.lastStart = start
    this.lastEnd = childEnd
    if (childEnd > this.end) this.end = childEnd
  }
}

/** Total occupied duration of a tween including finite repeats (infinite → base). */
function totalWithRepeats(duration: number, repeat?: number, repeatDelay?: number): number {
  if (!repeat || repeat < 0) return duration
  return duration * (repeat + 1) + (repeatDelay ?? 0) * repeat
}

export class RecordingTimeline {
  readonly specs: TweenSpec[] = []
  private pos = new PositionState()
  private _data: unknown
  private _callbacks = new Map<string, (...args: unknown[]) => void>()

  constructor(
    private resolver: TargetResolver,
    private backend?: TimelineBackend,
    vars?: object,
  ) {
    if (vars && typeof (vars as { data?: unknown }).data !== 'undefined') {
      this._data = (vars as { data?: unknown }).data
    }
  }

  /** Master duration in seconds (max child end). */
  get recordedDuration(): number {
    return this.pos.end
  }

  private record(
    target: TweenTarget,
    from: Record<string, number> | undefined,
    parsed: ReturnType<typeof parseVars>,
    position: number | string | undefined,
  ): void {
    const start = this.pos.resolve(position) + parsed.delay
    const spec: TweenSpec = {
      target,
      to: parsed.props,
      startTime: start,
      duration: parsed.duration,
      ease: parsed.ease,
      opaque: parsed.opaque,
    }
    if (from) spec.from = from
    if (parsed.repeat !== undefined) spec.repeat = parsed.repeat
    if (parsed.yoyo !== undefined) spec.yoyo = parsed.yoyo
    if (parsed.repeatDelay !== undefined) spec.repeatDelay = parsed.repeatDelay
    if (parsed.opaqueKeys.length) spec.opaqueKeys = parsed.opaqueKeys
    this.specs.push(spec)
    this.pos.advance(start, totalWithRepeats(parsed.duration, parsed.repeat, parsed.repeatDelay))
  }

  to(target: unknown, vars: Record<string, unknown>, position?: number | string): this {
    this.record(this.resolver.resolve(target), undefined, parseVars(vars), position)
    this.backend?.to(target, vars, position)
    return this
  }

  from(target: unknown, vars: Record<string, unknown>, position?: number | string): this {
    // `.from` animates FROM these values TO the target's current state; we record the
    // explicit values as `from` and leave `to` empty (destination resolved at extract).
    const parsed = parseVars(vars)
    this.record(this.resolver.resolve(target), parsed.props, { ...parsed, props: {} }, position)
    this.backend?.from(target, vars, position)
    return this
  }

  fromTo(
    target: unknown,
    fromVars: Record<string, unknown>,
    toVars: Record<string, unknown>,
    position?: number | string,
  ): this {
    const from = parseVars(fromVars).props
    this.record(this.resolver.resolve(target), from, parseVars(toVars), position)
    this.backend?.fromTo(target, fromVars, toVars, position)
    return this
  }

  set(target: unknown, vars: Record<string, unknown>, position?: number | string): this {
    this.record(this.resolver.resolve(target), undefined, parseVars(vars, { defaultDuration: 0 }), position)
    this.backend?.set(target, vars, position)
    return this
  }

  add(child: unknown, position?: number | string): this {
    if (child instanceof RecordingTimeline) {
      const base = this.pos.resolve(position)
      for (const s of child.specs) {
        this.specs.push({ ...s, startTime: s.startTime + base })
      }
      this.pos.advance(base, child.recordedDuration)
    } else {
      // Unknown child (raw tween/label array) — record an opaque zero-span marker.
      const base = this.pos.resolve(position)
      this.specs.push({
        target: { kind: 'opaque', label: 'add' },
        to: {},
        startTime: base,
        duration: 0,
        ease: 'none',
        opaque: true,
      })
      this.pos.advance(base, 0)
    }
    this.backend?.add(child instanceof RecordingTimeline ? undefined : child, position)
    return this
  }

  addLabel(label: string, position?: number | string): this {
    this.pos.labels.set(label, this.pos.resolve(position))
    this.backend?.addLabel(label, position)
    return this
  }

  // ---- transport passthrough (delegates when live; computes from record otherwise) ----

  pause(): this {
    this.backend?.pause()
    return this
  }
  play(): this {
    this.backend?.play()
    return this
  }
  seek(time: number, suppressEvents?: boolean): this {
    this.backend?.seek(time, suppressEvents)
    return this
  }
  clear(): this {
    this.specs.length = 0
    this.pos = new PositionState()
    this.backend?.clear()
    return this
  }
  timeScale(value: number): this {
    this.backend?.timeScale(value)
    return this
  }
  time(): number {
    return this.backend ? this.backend.time() : 0
  }
  progress(): number {
    if (this.backend) return this.backend.progress()
    return 0
  }
  duration(): number {
    return this.backend ? this.backend.duration() : this.recordedDuration
  }
  totalDuration(): number {
    return this.backend ? this.backend.totalDuration() : this.recordedDuration
  }
  eventCallback(type: string, callback?: (...args: unknown[]) => void): this {
    if (callback) this._callbacks.set(type, callback)
    this.backend?.eventCallback(type, callback)
    return this
  }

  get data(): unknown {
    return this._data
  }
  set data(value: unknown) {
    this._data = value
    if (this.backend) this.backend.data = value
  }
}

/** A gsap-shaped recorder: `.timeline()` returns a `RecordingTimeline`. */
export interface TweenRecorder {
  timeline(vars?: object): RecordingTimeline
  utils: Record<string, unknown>
  /** All timelines produced by this recorder (in creation order). */
  readonly timelines: RecordingTimeline[]
}

/**
 * Create a recorder. Pass a real `gsap` backend for live delegation (playback runs on
 * GSAP while calls are recorded); omit it for pure host-side extraction.
 */
export function createTweenRecorder(backend?: GsapBackend): TweenRecorder {
  const resolver = new TargetResolver()
  const timelines: RecordingTimeline[] = []
  return {
    timelines,
    utils: (backend?.utils as Record<string, unknown>) ?? {},
    timeline(vars?: object): RecordingTimeline {
      const tl = new RecordingTimeline(resolver, backend?.timeline(vars), vars)
      timelines.push(tl)
      return tl
    },
  }
}
