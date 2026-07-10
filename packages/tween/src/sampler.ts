/**
 * The vos sampler backend: a pure, deterministic evaluator for recorded
 * `RuntimeEntry` lists. `seek(t)` writes every animated property's value at
 * absolute time `t` — no ticker, no wall clock, no hidden per-frame state.
 *
 * Defined semantics (deliberately simpler than GSAP's stateful lazy rendering,
 * verified against it in the differential parity tests):
 * - Implicit values resolve at COMPILE time (first transport use), analytically
 *   reproducing GSAP's lazy capture under monotonic playback: a `.to`'s implicit
 *   start (and a `.from`'s implicit destination) is the track's evaluated value
 *   AT THE TWEEN'S OWN START TIME over the previously-authored tweens — which
 *   is the prior tween's end value when sequential, and the mid-flight value
 *   when tweens overlap.
 * - Explicit `from` values render-on-add: before its start time, the track's
 *   first tween shows its `from` value (GSAP `from`/`fromTo` immediateRender).
 * - Conflicts: among a track's tweens that have started (start <= t), the one
 *   with the latest LAST-RENDER time (`min(t, end)`) wins; ties resolve by
 *   insertion order. This reproduces GSAP's per-tick behavior functionally:
 *   an active tween beats a completed one, and after everything completes the
 *   latest-ending tween's value persists. Zero-duration `.set`s apply for all
 *   t >= startTime, direction-independent.
 * - Repeats fold analytically: yoyo reverses odd cycles; `repeat: -1` never
 *   ends; the end state of finite repeats honors yoyo parity.
 */
import { resolveEase } from '@vosjs/timeline'
import type { RuntimeEntry } from './recorder'

interface CompiledTween {
  entry: RuntimeEntry
  /** Resolved start/end values for each animated property. */
  from: Record<string, number>
  to: Record<string, number>
  start: number
  duration: number
  /** Occupied span including finite repeats (Infinity for repeat: -1). */
  total: number
  ease: (x: number) => number
  repeat: number
  yoyo: boolean
  repeatDelay: number
}

interface Track {
  raw: object
  property: string
  /** Contributing tweens, sorted by (startTime, insertion). */
  tweens: CompiledTween[]
  /** Value shown before the first tween starts. */
  base: number
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Fold absolute local time into the eased-progress input for one tween. */
function foldProgress(c: CompiledTween, local: number): number {
  if (c.duration <= 0) return 1
  if (local <= 0) return 0
  if (c.repeat === 0) return clamp01(local / c.duration)
  const cycle = c.duration + c.repeatDelay
  if (local >= c.total) {
    // End state of finite repeats: yoyo with an even iteration count ends reversed.
    const iterations = c.repeat + 1
    return c.yoyo && iterations % 2 === 0 ? 0 : 1
  }
  let i = Math.floor(local / cycle)
  // An exact cycle boundary belongs to the END of the previous cycle (GSAP
  // holds the finished value through the boundary; the restart is exclusive).
  if (i > 0 && local === i * cycle) i -= 1
  const inCycle = Math.min(local - i * cycle, c.duration) // hold during repeatDelay
  let u = inCycle / c.duration
  if (c.yoyo && i % 2 === 1) u = 1 - u
  return clamp01(u)
}

function totalSpan(duration: number, repeat = 0, repeatDelay = 0): number {
  if (repeat === -1) return Infinity
  if (!repeat) return duration
  return duration * (repeat + 1) + repeatDelay * repeat
}

/**
 * Evaluate a track's value at time `t` over its current tweens. Winner: among
 * started tweens, the latest last-render time `min(t, end)` wins; ties go to
 * the later insertion. Before anything starts, the earliest tween's explicit
 * `from` renders-on-add (GSAP from/fromTo immediateRender), else the base.
 */
function trackValueAt(track: Track, t: number): number {
  let winner: CompiledTween | undefined
  let bestLastRender = -Infinity
  for (const tw of track.tweens) {
    if (tw.start > t) continue
    const lastRender = Math.min(t, tw.start + tw.total)
    if (lastRender >= bestLastRender) {
      bestLastRender = lastRender
      winner = tw
    }
  }
  if (!winner) {
    let first: CompiledTween | undefined
    for (const tw of track.tweens) {
      if (!first || tw.start < first.start) first = tw
    }
    return first && first.entry.spec.from?.[track.property] !== undefined
      ? first.from[track.property]
      : track.base
  }
  const u = foldProgress(winner, t - winner.start)
  const from = winner.from[track.property]
  const to = winner.to[track.property]
  return from + (to - from) * winner.ease(u)
}

export interface Sampler {
  seek(t: number, suppressEvents?: boolean): void
}

/**
 * Compile entries into per-(target, property) tracks and return a sampler.
 * Implicit from/to values are read from the raw targets AT THIS MOMENT — call
 * it before any transport use mutates them (the recorder does this lazily on
 * first seek).
 */
export function createSampler(
  entries: readonly RuntimeEntry[],
  timelineCallbacks?: Map<string, (...args: unknown[]) => void>,
): Sampler {
  // Group by (raw, property), preserving insertion order within groups.
  const tracks = new Map<string, Track>()
  const rawIds = new Map<object, number>()
  const idOf = (raw: object): number => {
    let id = rawIds.get(raw)
    if (id === undefined) {
      id = rawIds.size
      rawIds.set(raw, id)
    }
    return id
  }

  const readNumber = (raw: object, property: string): number => {
    const v = (raw as Record<string, unknown>)[property]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }

  const compiled: CompiledTween[] = []
  for (const entry of entries) {
    const { spec, raw } = entry
    if (!raw || (typeof raw !== 'object' && typeof raw !== 'function')) continue
    const target = raw as object
    const props = new Set([
      ...Object.keys(spec.from ?? {}),
      ...Object.keys(spec.to),
    ])
    if (!props.size && !entry.callbacks) continue

    const c: CompiledTween = {
      entry,
      from: {},
      to: {},
      start: spec.startTime,
      duration: spec.duration,
      total: totalSpan(spec.duration, spec.repeat, spec.repeatDelay),
      ease: resolveEase(spec.ease),
      repeat: spec.repeat ?? 0,
      yoyo: spec.yoyo ?? false,
      repeatDelay: spec.repeatDelay ?? 0,
    }
    compiled.push(c)

    for (const property of props) {
      const key = `${idOf(target)}::${property}`
      let track = tracks.get(key)
      if (!track) {
        track = {
          raw: target,
          property,
          tweens: [],
          base: readNumber(target, property),
        }
        tracks.set(key, track)
      }

      const explicitFrom = spec.from?.[property]
      const explicitTo = spec.to[property]
      // Implicit endpoints = the track's evaluated value at this tween's own
      // start time over the previously-authored tweens (GSAP's lazy capture
      // under monotonic playback, resolved analytically).
      const atStart = () => trackValueAt(track, spec.startTime)
      c.from[property] = explicitFrom ?? atStart()
      c.to[property] = explicitTo ?? atStart()
      track.tweens.push(c)
    }
  }

  // Track tweens stay in INSERTION order — the conflict rule tie-breaks on it.

  // Callback edge detection (onStart/onComplete) needs the previous seek time.
  let lastT = -Infinity

  return {
    seek(t: number, suppressEvents?: boolean): void {
      for (const track of tracks.values()) {
        ;(track.raw as Record<string, unknown>)[track.property] = trackValueAt(track, t)
      }

      if (!suppressEvents) {
        for (const c of compiled) {
          const cb = c.entry.callbacks
          if (!cb) continue
          const active = t >= c.start && (c.total === Infinity || t <= c.start + c.total)
          if (cb.onStart && lastT < c.start && t >= c.start) cb.onStart()
          if (cb.onUpdate && active) cb.onUpdate()
          if (
            cb.onComplete &&
            c.total !== Infinity &&
            lastT < c.start + c.total &&
            t >= c.start + c.total
          ) {
            cb.onComplete()
          }
        }
        timelineCallbacks?.get('onUpdate')?.()
      }
      lastT = t
    },
  }
}
