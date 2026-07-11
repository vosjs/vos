/**
 * Data-driven timeline playback: evaluate serializable `TweenSpec[]` (carried
 * in a program's `ctx.data`) against live target objects each frame.
 *
 * This is the interpreter pattern applied to animation itself: a CONSTANT
 * program calls `player.setSpecs(ctx.data.tweens); player.seek(ctx.time)` per
 * frame, so every edit to the spec list is a live SET_DATA — no recompile, no
 * reload. `setSpecs` memoizes by array identity (frozen `ctx.data` snapshots
 * change identity on every SET_DATA, giving cache invalidation for free).
 *
 * Base values are cached per (target, property) on FIRST sight and restored
 * before every rebuild, so a tween's implicit start keeps meaning "the value
 * before any animation" even when specs are swapped mid-playback.
 */
import { createSampler } from './sampler'
import type { Sampler } from './sampler'
import type { RuntimeEntry } from './recorder'
import type { TweenSpec, TweenTarget } from './types'

export type ResolveTarget = (target: TweenTarget) => unknown

export interface SpecPlayer {
  /** Swap the spec list (memoized by array identity — cheap to call per frame). */
  setSpecs(specs: readonly TweenSpec[] | undefined): void
  /** Evaluate every animated property at absolute time `t` (pure). */
  seek(t: number): void
  /** Footprint of the current specs (max tween end, seconds). */
  duration(): number
}

function footprint(spec: TweenSpec): number {
  const r = spec.repeat ?? 0
  if (r === -1) return spec.startTime + spec.duration
  const rd = spec.repeatDelay ?? 0
  return spec.startTime + spec.duration * (r + 1) + rd * r
}

export function createSpecPlayer(resolve: ResolveTarget): SpecPlayer {
  let current: readonly TweenSpec[] | undefined
  let sampler: Sampler | null = null
  let dur = 0
  /** Original (pre-animation) values per target object. */
  const bases = new WeakMap<object, Record<string, number>>()

  const setSpecs = (specs: readonly TweenSpec[] | undefined): void => {
    if (specs === current) return
    current = specs

    const entries: RuntimeEntry[] = []
    for (const spec of specs ?? []) {
      const raw = resolve(spec.target)
      if (!raw || (typeof raw !== 'object' && typeof raw !== 'function')) continue
      entries.push({ spec: { ...spec }, raw })
    }

    // Snapshot first-seen originals, then restore them so the sampler's
    // compile-time implicit-endpoint capture reads pre-animation values.
    for (const e of entries) {
      const obj = e.raw as Record<string, unknown>
      let saved = bases.get(e.raw as object)
      if (!saved) {
        saved = {}
        bases.set(e.raw as object, saved)
      }
      const props = [
        ...Object.keys(e.spec.to),
        ...Object.keys(e.spec.from ?? {}),
        ...Object.keys(e.spec.toRelative ?? {}),
      ]
      for (const p of props) {
        if (!(p in saved)) {
          const v = obj[p]
          saved[p] = typeof v === 'number' && Number.isFinite(v) ? v : 0
        }
        obj[p] = saved[p]
      }
    }

    sampler = entries.length ? createSampler(entries) : null
    dur = 0
    for (const e of entries) dur = Math.max(dur, footprint(e.spec))
  }

  return {
    setSpecs,
    seek(t: number): void {
      // Serialized specs carry no callbacks — suppress events unconditionally.
      sampler?.seek(t, true)
    },
    duration(): number {
      return dur
    },
  }
}

/**
 * Standard resolver for the vos program context: element `props` / split
 * `segments` via `ctx.elements`, shader uniforms via `content.refs.uniforms`,
 * and dotted ref paths into `content.refs`. Opaque targets are unresolvable
 * by design (data-driven timelines address only nameable targets).
 */
export function contextResolver(
  ctx: {
    elements?: Map<string, { props?: unknown; segments?: unknown[] }>
  },
  content?: { refs?: Record<string, unknown> },
): ResolveTarget {
  return (target: TweenTarget): unknown => {
    switch (target.kind) {
      case 'element': {
        const el = ctx.elements?.get(target.id)
        if (!el) return null
        return target.scope === 'segment'
          ? (el.segments?.[target.segmentIndex] ?? null)
          : (el.props ?? null)
      }
      case 'uniform': {
        const uniforms = content?.refs?.uniforms as
          | Record<string, unknown>
          | undefined
        return uniforms?.[target.path] ?? null
      }
      case 'ref': {
        let node: unknown = content?.refs
        for (const part of target.path.split('.')) {
          if (node == null || typeof node !== 'object') return null
          node = (node as Record<string, unknown>)[part]
        }
        return node ?? null
      }
      case 'opaque':
        return null
    }
  }
}
