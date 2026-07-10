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
import { staggerOffsets } from './stagger'
import { createSampler } from './sampler'
import type { Sampler } from './sampler'
import type { ParsedVars, TweenCallbacks } from './vars'
import type { TweenSpec } from './types'

/**
 * One recorded tween bound to its concrete runtime object. `spec` is the
 * serializable IR; `raw` and `callbacks` are runtime-only (they let the vos
 * sampler backend write values and fire lifecycle callbacks).
 */
export interface RuntimeEntry {
  spec: TweenSpec
  raw: unknown
  callbacks?: TweenCallbacks
}

/**
 * A serializable timing/ease/value override for one recorded tween, addressed
 * by its ENTRY INDEX (recording order — stable for a given `createTimeline`
 * source, including array-target/stagger expansion). This is how an editor
 * edits a timeline without regenerating its code: replay the original function
 * through the recorder, then `applyEdits`. Timing/ease edits work for opaque
 * tweens too (an `onUpdate` shader tween can be moved/stretched without
 * understanding its body); value overrides apply to the recorded numeric props.
 *
 * Overrides MERGE into the freshly-recorded spec, so re-applying a full
 * overlay onto a fresh recording (the editor pattern) is idempotent.
 */
export interface TweenEdit {
  index: number
  /** New absolute start on the master timeline (seconds, clamped to >= 0). */
  startTime?: number
  /** New tween duration (seconds, clamped to >= 0). */
  duration?: number
  /** New ease name (dialect vocabulary). */
  ease?: string
  /**
   * Destination value overrides, merged per property into the recorded `to`
   * (an override on a relative-value prop replaces the delta with an absolute
   * destination).
   */
  to?: Record<string, number>
  /**
   * Start-value overrides, merged per property into `from`. Overriding a prop
   * without an explicit start CREATES one (pinning a `.to`'s implicit start).
   */
  from?: Record<string, number>
}

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
  /** Recorded tweens with their runtime bindings (source of truth). */
  readonly entries: RuntimeEntry[] = []
  private pos = new PositionState()
  private _data: unknown
  protected _callbacks = new Map<string, (...args: unknown[]) => void>()

  // ---- sampler-backed transport state (used when there is no live backend) ----
  private _sampler: Sampler | null = null
  private _time = 0
  private _rate = 1
  private _raf: unknown = null
  private _paused = true
  private _repeat = 0
  /** True when any recorded tween repeats forever — seek must not clamp then. */
  private _hasInfinite = false

  constructor(
    private resolver: TargetResolver,
    protected backend?: TimelineBackend,
    vars?: object,
  ) {
    if (vars && typeof (vars as { data?: unknown }).data !== 'undefined') {
      this._data = (vars as { data?: unknown }).data
    }
    // Timeline-level lifecycle callbacks may come in via vars.
    if (vars) {
      for (const key of ['onStart', 'onUpdate', 'onComplete'] as const) {
        const fn = (vars as Record<string, unknown>)[key]
        if (typeof fn === 'function') {
          this._callbacks.set(key, fn as (...args: unknown[]) => void)
        }
      }
    }
  }

  /** The serializable IR (derived view over `entries`). */
  get specs(): TweenSpec[] {
    return this.entries.map((e) => e.spec)
  }

  /** Master duration in seconds (max child end). */
  get recordedDuration(): number {
    return this.pos.end
  }

  private record(
    rawTarget: unknown,
    from: Record<string, number> | undefined,
    parsed: ParsedVars,
    position: number | string | undefined,
  ): void {
    const base = this.pos.resolve(position) + parsed.delay
    // Array targets expand into one spec per element with stagger offsets.
    const targets = Array.isArray(rawTarget) ? rawTarget : [rawTarget]
    const stagger = staggerOffsets(targets.length, parsed.stagger)

    for (let i = 0; i < targets.length; i++) {
      const start = base + stagger.offsets[i]
      const spec: TweenSpec = {
        target: this.resolver.resolve(targets[i]),
        to: parsed.props,
        startTime: start,
        duration: parsed.duration,
        ease: parsed.ease,
        opaque: parsed.opaque || stagger.opaque,
      }
      if (from) spec.from = from
      if (parsed.relative) spec.toRelative = parsed.relative
      if (parsed.repeat !== undefined) spec.repeat = parsed.repeat
      if (parsed.yoyo !== undefined) spec.yoyo = parsed.yoyo
      if (parsed.repeatDelay !== undefined) spec.repeatDelay = parsed.repeatDelay
      if (parsed.opaqueKeys.length) spec.opaqueKeys = parsed.opaqueKeys
      this.entries.push({ spec, raw: targets[i], callbacks: parsed.callbacks })
    }

    if (parsed.repeat === -1) this._hasInfinite = true
    this._sampler = null // recompile implicit values on next transport use
    this.pos.advance(
      base,
      stagger.max + totalWithRepeats(parsed.duration, parsed.repeat, parsed.repeatDelay),
    )
  }

  /** Lazily compile the sampler (no-backend mode). */
  private sampler(): Sampler {
    this._sampler ??= createSampler(this.entries, this._callbacks)
    return this._sampler
  }

  /**
   * Apply serializable timing/ease overrides to recorded entries (see
   * `TweenEdit`) and recompute the master footprint. The sampler recompiles on
   * the next seek, so implicit endpoints re-resolve against the new layout.
   *
   * No-backend (vos sampler) mode only affects playback; with a live gsap
   * backend the already-built delegated timeline is NOT retimed (specs still
   * update, so extraction reflects the edits) — editors should run edits on
   * the vos backend.
   */
  applyEdits(edits: readonly TweenEdit[]): this {
    const finite = (
      values: Record<string, number> | undefined,
    ): [string, number][] =>
      Object.entries(values ?? {}).filter(
        ([, v]) => typeof v === 'number' && Number.isFinite(v),
      )

    for (const e of edits) {
      const entry = this.entries[e.index]
      if (!entry) continue
      const spec = entry.spec
      if (typeof e.startTime === 'number' && Number.isFinite(e.startTime)) {
        spec.startTime = Math.max(0, e.startTime)
      }
      if (typeof e.duration === 'number' && Number.isFinite(e.duration)) {
        spec.duration = Math.max(0, e.duration)
      }
      if (typeof e.ease === 'string') spec.ease = e.ease
      for (const [prop, value] of finite(e.to)) {
        spec.to = { ...spec.to, [prop]: value }
        // An absolute destination supersedes a relative ('+=x') one.
        if (spec.toRelative && prop in spec.toRelative) {
          const { [prop]: _dropped, ...rest } = spec.toRelative
          spec.toRelative = Object.keys(rest).length ? rest : undefined
        }
      }
      for (const [prop, value] of finite(e.from)) {
        spec.from = { ...spec.from, [prop]: value }
      }
    }
    // Retimes can extend or shrink the timeline — recompute the end from the
    // edited entries (same footprint rule the recorder's cursor uses).
    let end = 0
    for (const { spec } of this.entries) {
      end = Math.max(
        end,
        spec.startTime +
          totalWithRepeats(spec.duration, spec.repeat, spec.repeatDelay),
      )
    }
    this.pos.end = end
    this._sampler = null
    return this
  }

  to(target: unknown, vars: Record<string, unknown>, position?: number | string): this {
    this.record(target, undefined, parseVars(vars), position)
    this.backend?.to(target, vars, position)
    return this
  }

  from(target: unknown, vars: Record<string, unknown>, position?: number | string): this {
    // `.from` animates FROM these values TO the target's current state; we record the
    // explicit values as `from` and leave `to` empty (destination resolved at extract).
    const parsed = parseVars(vars)
    this.record(target, parsed.props, { ...parsed, props: {} }, position)
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
    this.record(target, from, parseVars(toVars), position)
    this.backend?.fromTo(target, fromVars, toVars, position)
    return this
  }

  set(target: unknown, vars: Record<string, unknown>, position?: number | string): this {
    this.record(target, undefined, parseVars(vars, { defaultDuration: 0 }), position)
    this.backend?.set(target, vars, position)
    return this
  }

  add(child: unknown, position?: number | string): this {
    if (child instanceof RecordingTimeline) {
      const base = this.pos.resolve(position)
      for (const e of child.entries) {
        this.entries.push({
          ...e,
          spec: { ...e.spec, startTime: e.spec.startTime + base },
        })
      }
      this.pos.advance(base, child.recordedDuration)
    } else {
      // Unknown child (raw tween/label array) — record an opaque zero-span marker.
      const base = this.pos.resolve(position)
      this.entries.push({
        raw: child,
        spec: {
          target: { kind: 'opaque', label: 'add' },
          to: {},
          startTime: base,
          duration: 0,
          ease: 'none',
          opaque: true,
        },
      })
      this.pos.advance(base, 0)
    }
    this._sampler = null
    this.backend?.add(child instanceof RecordingTimeline ? undefined : child, position)
    return this
  }

  addLabel(label: string, position?: number | string): this {
    this.pos.labels.set(label, this.pos.resolve(position))
    this.backend?.addLabel(label, position)
    return this
  }

  // ---- transport: delegates when a live backend exists; sampler-driven otherwise ----

  private stopDriver(): void {
    if (this._raf !== null) {
      const g = globalThis as Record<string, unknown>
      const cancel = (
        typeof g.cancelAnimationFrame === 'function' ? g.cancelAnimationFrame : g.clearTimeout
      ) as (id: unknown) => void
      cancel(this._raf)
      this._raf = null
    }
  }

  /**
   * Wall-clock play driver for PREVIEW in no-backend mode (looping, like the
   * engine's master playback). Export/scrub determinism comes from `seek()`,
   * which stays pure — this driver only advances the playhead between frames.
   */
  private startDriver(): void {
    if (this._raf !== null) return
    const g = globalThis as Record<string, unknown>
    const schedule = (
      typeof g.requestAnimationFrame === 'function'
        ? g.requestAnimationFrame
        : (fn: () => void) => (g.setTimeout as (f: () => void, ms: number) => unknown)(fn, 16)
    ) as (fn: () => void) => unknown
    let last = Date.now()
    const tick = (): void => {
      const now = Date.now()
      const dt = ((now - last) / 1000) * this._rate
      last = now
      const dur = this.recordedDuration
      let next = this._time + dt
      if (dur > 0 && next > dur) {
        if (this._repeat === -1) {
          next %= dur // master loop (tl.repeat(-1))
        } else {
          this.seek(dur)
          this.pause()
          return
        }
      }
      this.seek(next)
      this._raf = schedule(tick)
    }
    this._raf = schedule(tick)
  }

  pause(): this {
    this._paused = true
    if (this.backend) this.backend.pause()
    else this.stopDriver()
    return this
  }
  play(): this {
    this._paused = false
    if (this.backend) this.backend.play()
    else this.startDriver()
    return this
  }
  /** GSAP-style paused getter/setter. */
  paused(value?: boolean): boolean | this {
    if (value === undefined) return this._paused
    return value ? this.pause() : this.play()
  }
  /**
   * GSAP-style repeat getter/setter for the MASTER timeline (the compiled
   * program calls `tl.repeat(-1)`). `-1` makes the no-backend play driver loop
   * (it already wraps at duration); other values stop at the end.
   */
  repeat(value?: number): number | this {
    if (value === undefined) return this._repeat
    this._repeat = value
    return this
  }
  /** Stop and release (GSAP kill): halt the driver; recorded entries remain. */
  kill(): this {
    this.stopDriver()
    return this
  }
  seek(time: number, suppressEvents?: boolean): this {
    if (this.backend) {
      this.backend.seek(time, suppressEvents)
    } else {
      const dur = this._hasInfinite ? Infinity : this.recordedDuration
      this._time = Math.max(0, dur > 0 ? Math.min(time, dur) : time)
      this.sampler().seek(this._time, suppressEvents)
    }
    return this
  }
  clear(): this {
    this.entries.length = 0
    this.pos = new PositionState()
    this._sampler = null
    this._hasInfinite = false
    this.backend?.clear()
    return this
  }
  /** GSAP-style timeScale getter/setter. */
  timeScale(value?: number): number | this {
    if (value === undefined) return this._rate
    this._rate = value
    this.backend?.timeScale(value)
    return this
  }
  /** GSAP-style time getter/setter (setter = seek). */
  time(value?: number): number | this {
    if (value === undefined) {
      return this.backend ? this.backend.time() : this._time
    }
    return this.seek(value, false)
  }
  /**
   * GSAP-style progress getter/setter. The setter is how hosts scrub
   * (the playback bridge's SEEK command calls `tl.progress(value)`).
   */
  progress(value?: number): number | this {
    if (value === undefined) {
      if (this.backend) return this.backend.progress()
      const dur = this.recordedDuration
      return dur > 0 ? this._time / dur : 0
    }
    const dur = this.backend ? this.backend.duration() : this.recordedDuration
    return this.seek(Math.max(0, Math.min(value, 1)) * dur, false)
  }
  duration(): number {
    return this.backend ? this.backend.duration() : this.recordedDuration
  }
  totalDuration(): number {
    return this.backend ? this.backend.totalDuration() : this.recordedDuration
  }
  /** GSAP-style eventCallback: getter with one arg, setter with two. */
  eventCallback(
    type: string,
    callback?: (...args: unknown[]) => void,
  ): ((...args: unknown[]) => void) | null | this {
    if (callback === undefined) {
      if (this.backend) {
        return this.backend.eventCallback(type) as
          | ((...args: unknown[]) => void)
          | null
      }
      return this._callbacks.get(type) ?? null
    }
    this._callbacks.set(type, callback)
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
