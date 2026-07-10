/**
 * The vos tween IR — a structured, per-target recording of a GSAP-dialect timeline.
 *
 * The recorder captures each `.to/.from/.fromTo/.set` call on the master timeline as a
 * `TweenSpec` (with absolute start time after position resolution), and the extractor
 * folds those specs into per-target `KeyframeTrack`s. This is the neutral data model
 * that a per-element timeline editor edits and a deterministic backend samples — the
 * GSAP API is only the authoring syntax, not the model.
 */
import type { EaseName, Keyframe, KeyframeTrack } from '@vosjs/timeline'

/**
 * Identity of a tween target, resolved from object identity at record time.
 *
 * - `element` — an element's animatable `props` bag, or one split `segment`'s props.
 * - `ref` — a named object reachable from `content.refs` (path is dot-joined).
 * - `uniform` — a shader uniform object (`content.refs...uniforms.<name>`), special-cased
 *   because `{ value }` uniform tweens are the dominant per-frame idiom.
 * - `opaque` — a plain object we could not identify (still timed/eased, just not bound
 *   to a named element/ref for editing).
 */
export type TweenTarget =
  | { kind: 'element'; id: string; scope: 'props' }
  | { kind: 'element'; id: string; scope: 'segment'; segmentIndex: number }
  | { kind: 'ref'; path: string }
  | { kind: 'uniform'; path: string }
  | { kind: 'opaque'; label: string }

/** Stable string key for grouping specs/tracks by target. */
export function targetKey(t: TweenTarget): string {
  switch (t.kind) {
    case 'element':
      return t.scope === 'segment'
        ? `element:${t.id}/segment/${t.segmentIndex}`
        : `element:${t.id}/props`
    case 'ref':
      return `ref:${t.path}`
    case 'uniform':
      return `uniform:${t.path}`
    case 'opaque':
      return `opaque:${t.label}`
  }
}

/**
 * One recorded tween call, with position resolved to an absolute master-timeline time.
 *
 * `to` holds the destination numeric properties. `from` is present only when the call
 * supplied explicit start values (`.from`/`.fromTo`); a `.to`'s implicit start is
 * resolved during extraction by chaining off the prior keyframe on the same track.
 */
export interface TweenSpec {
  target: TweenTarget
  /** Explicit start values (from `.from`/`.fromTo`), numeric only. */
  from?: Record<string, number>
  /** Destination values, numeric only. */
  to: Record<string, number>
  /**
   * Relative destinations (`'+=0.5'` / `'-=10'`): per-property deltas applied
   * to the tween's start value (`destination = start + delta`).
   */
  toRelative?: Record<string, number>
  /** Absolute start on the master timeline (seconds), after position resolution. */
  startTime: number
  /** Tween duration (seconds); 0 for `.set`. */
  duration: number
  /** Ease name (dialect vocabulary; unrecognized names are kept verbatim). */
  ease: EaseName | string
  /** Repeat count (`-1` = infinite); omitted when absent. */
  repeat?: number
  yoyo?: boolean
  repeatDelay?: number
  /**
   * True when the call also carried effects we could not structure — callbacks
   * (`onUpdate`/…), `modifiers`, or non-numeric target values. The numeric props are
   * still recorded; `opaque` flags that there is additional un-inspectable behavior.
   */
  opaque: boolean
  /** Vars keys that were dropped as unstructurable (callbacks, non-numeric values). */
  opaqueKeys?: string[]
}

/** A per-target, per-property keyframe track derived from the recorded specs. */
export interface TargetTrack {
  target: TweenTarget
  /** The animated property, e.g. 'opacity', 'x', 'rotationX', 'value' (uniform). */
  property: string
  track: KeyframeTrack
  /** True if a contributing spec carried opaque effects (callbacks/modifiers/non-numeric). */
  hasOpaque: boolean
  /**
   * True if an endpoint value could not be resolved host-side — a leading `.to` (unknown
   * implicit start) or a `.from` (unknown destination). The tween is still structured
   * (target + timing + one endpoint known); the missing value resolves at runtime.
   */
  unresolved?: boolean
}

/**
 * The extracted timeline model: the flat recorded specs plus the derived per-target
 * tracks and the total master duration.
 */
export interface TimelineDoc {
  /** Master timeline duration in seconds (max end of all recorded children). */
  duration: number
  specs: TweenSpec[]
  tracks: TargetTrack[]
}

export type { EaseName, Keyframe, KeyframeTrack }
