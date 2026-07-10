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
export function parseVars(
  vars: Record<string, unknown> | undefined,
  opts: { defaultDuration?: number } = {},
): ParsedVars {
  const v = vars ?? {}
  const props: Record<string, number> = {}
  const opaqueKeys: string[] = []
  let opaque = false

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
