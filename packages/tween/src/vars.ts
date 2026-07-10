/**
 * Vars parsing: split a GSAP tween-vars object into structured numeric properties
 * and the reserved/unstructurable remainder.
 */

/** GSAP vars keys that configure the tween rather than name an animated property. */
const RESERVED = new Set([
  'duration',
  'delay',
  'ease',
  'repeat',
  'yoyo',
  'yoyoEase',
  'repeatDelay',
  'repeatRefresh',
  'stagger',
  'immediateRender',
  'overwrite',
  'id',
  'data',
  'paused',
  'inherit',
  'lazy',
  'runBackwards',
  'startAt',
  'keyframes',
  'modifiers',
  'snap',
  'callbackScope',
  'onStart',
  'onUpdate',
  'onComplete',
  'onRepeat',
  'onReverseComplete',
  'onStartParams',
  'onUpdateParams',
  'onCompleteParams',
])

/** Keys whose presence means the tween carries un-inspectable behavior. */
const OPAQUE_TRIGGERS = new Set([
  'modifiers',
  'snap',
  'keyframes',
  'onUpdate',
  'onStart',
  'onComplete',
  'onRepeat',
  'onReverseComplete',
])

/** GSAP's default tween ease when none is supplied. */
export const DEFAULT_EASE = 'power1.out'
/** GSAP's default tween duration when none is supplied. */
export const DEFAULT_DURATION = 0.5

/** Per-tween lifecycle callbacks captured for the sampler backend to fire. */
export interface TweenCallbacks {
  onStart?: (...args: unknown[]) => void
  onUpdate?: (...args: unknown[]) => void
  onComplete?: (...args: unknown[]) => void
}

export interface ParsedVars {
  props: Record<string, number>
  /** Relative numeric values (`'+=0.5'`): per-property deltas off the start value. */
  relative?: Record<string, number>
  duration: number
  delay: number
  ease: string
  repeat?: number
  yoyo?: boolean
  repeatDelay?: number
  /** The raw `stagger` value (expanded by the recorder for array targets). */
  stagger?: unknown
  /** Captured callback refs (runtime-only; they also mark the spec opaque). */
  callbacks?: TweenCallbacks
  /** True if the vars carried callbacks/modifiers/non-numeric animated values. */
  opaque: boolean
  /** Names of dropped keys (unstructurable animated values or effect triggers). */
  opaqueKeys: string[]
}

function easeToString(ease: unknown): string {
  if (typeof ease === 'string') return ease
  // Function / object eases (Power2.easeOut, custom fns) are not part of the string
  // dialect — record a marker so extraction can flag them without crashing.
  if (ease != null) return 'custom'
  return DEFAULT_EASE
}

/**
 * Parse a vars object. `defaultDuration`/`defaultEase` let `.set()` pass 0 duration and
 * callers override the tween defaults if needed.
 */
/** Relative numeric value strings: `'+=0.5'` / `'-=10'` (delta off the start value). */
const RELATIVE_RE = /^([+-])=\s*([\d.]+)\s*$/

export function parseVars(
  vars: Record<string, unknown> | undefined,
  opts: { defaultDuration?: number } = {},
): ParsedVars {
  const v = vars ?? {}
  const props: Record<string, number> = {}
  const relative: Record<string, number> = {}
  const opaqueKeys: string[] = []
  let opaque = false
  let hasRelative = false

  for (const key of Object.keys(v)) {
    if (OPAQUE_TRIGGERS.has(key)) {
      opaque = true
      opaqueKeys.push(key)
      continue
    }
    if (RESERVED.has(key)) continue
    const val = v[key]
    if (typeof val === 'number' && Number.isFinite(val)) {
      props[key] = val
    } else if (typeof val === 'string' && RELATIVE_RE.test(val)) {
      // Relative numeric value: destination = start value ± delta.
      const m = RELATIVE_RE.exec(val)!
      const delta = Number(m[2]) * (m[1] === '-' ? -1 : 1)
      if (Number.isFinite(delta)) {
        relative[key] = delta
        hasRelative = true
      } else {
        opaque = true
        opaqueKeys.push(key)
      }
    } else {
      // Non-numeric animated value (color/unit string, function value, nested object).
      opaque = true
      opaqueKeys.push(key)
    }
  }

  const durationRaw = v.duration
  const duration =
    typeof durationRaw === 'number' && Number.isFinite(durationRaw)
      ? durationRaw
      : (opts.defaultDuration ?? DEFAULT_DURATION)
  const delayRaw = v.delay
  const delay = typeof delayRaw === 'number' && Number.isFinite(delayRaw) ? delayRaw : 0

  const repeat = typeof v.repeat === 'number' ? v.repeat : undefined
  const yoyo = typeof v.yoyo === 'boolean' ? v.yoyo : undefined
  const repeatDelay = typeof v.repeatDelay === 'number' ? v.repeatDelay : undefined

  let callbacks: TweenCallbacks | undefined
  for (const key of ['onStart', 'onUpdate', 'onComplete'] as const) {
    const fn = v[key]
    if (typeof fn === 'function') {
      callbacks ??= {}
      callbacks[key] = fn as (...args: unknown[]) => void
    }
  }

  return {
    props,
    relative: hasRelative ? relative : undefined,
    duration,
    delay,
    ease: easeToString(v.ease),
    repeat,
    yoyo,
    repeatDelay,
    stagger: v.stagger,
    callbacks,
    opaque,
    opaqueKeys,
  }
}
