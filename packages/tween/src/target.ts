/**
 * Target identity resolution.
 *
 * The recorder needs to know WHAT a tween animates so extraction can bind tracks to
 * named elements/refs. Identity is by object reference: whoever provides the ctx (the
 * host stub for extraction, or the engine for live recording) tags the concrete
 * objects — element `props`, split `segments`, uniforms, named refs — via `tagTarget`.
 * Anything untagged resolves to a stable `opaque` handle so it is still grouped
 * consistently across the tweens that touch it.
 */
import type { TweenTarget } from './types'

/** Global identity map: concrete object → its declared target. */
const TAGS = new WeakMap<object, TweenTarget>()

/** WeakMap-keyable: objects and functions (function-backed proxies are common ref stubs). */
function keyable(obj: unknown): obj is object {
  return obj != null && (typeof obj === 'object' || typeof obj === 'function')
}

/** Tag a concrete object with its target identity (idempotent; last write wins). */
export function tagTarget<T extends object>(obj: T, target: TweenTarget): T {
  if (keyable(obj)) TAGS.set(obj, target)
  return obj
}

/** Read a previously-set tag, if any. */
export function readTag(obj: unknown): TweenTarget | undefined {
  return keyable(obj) ? TAGS.get(obj) : undefined
}

/**
 * Resolves objects to targets, assigning stable `opaque` labels to untagged objects.
 * One resolver per recorder so opaque numbering is deterministic within an extraction
 * and identical objects group together.
 */
export class TargetResolver {
  private opaque = new WeakMap<object, TweenTarget>()
  private counter = 0

  resolve(obj: unknown): TweenTarget {
    const tagged = readTag(obj)
    if (tagged) return tagged
    if (keyable(obj)) {
      const existing = this.opaque.get(obj)
      if (existing) return existing
      const target: TweenTarget = { kind: 'opaque', label: `#${this.counter++}` }
      this.opaque.set(obj, target)
      return target
    }
    // Primitives / null: a fresh opaque handle (cannot be re-identified).
    return { kind: 'opaque', label: `#${this.counter++}` }
  }
}
