/**
 * Extraction: fold recorded `TweenSpec`s into per-target, per-property keyframe tracks.
 *
 * A `.fromTo`/`.from` supplies an explicit start value; a `.to`'s implicit start chains
 * off the prior keyframe on the same track (GSAP's sequential-tween semantics). A `.set`
 * is a zero-duration step. Where a start value is genuinely unknown host-side (a leading
 * `.to` with no prior anchor, or a `.from`'s destination), the track is flagged
 * `hasOpaque` rather than guessed.
 */
import type { Keyframe, TargetTrack, TimelineDoc, TweenSpec } from './types'
import { targetKey } from './types'
import type { RecordingTimeline } from './recorder'

interface TrackBuilder {
  target: TweenSpec['target']
  property: string
  keyframes: Keyframe[]
  hasOpaque: boolean
}

function keyFor(spec: TweenSpec, property: string): string {
  return `${targetKey(spec.target)}::${property}`
}

/** Insert a keyframe, letting a later write at the same `t` win. */
function putKeyframe(kfs: Keyframe[], t: number, value: number, ease?: string): void {
  const existing = kfs.find((k) => k.t === t)
  if (existing) {
    existing.value = value
    if (ease) existing.ease = ease as Keyframe['ease']
    return
  }
  kfs.push(ease ? { t, value, ease: ease as Keyframe['ease'] } : { t, value })
}

/**
 * Build per-target tracks from an ordered spec list. Specs are processed in start-time
 * order so `.to` chaining sees prior anchors.
 */
export function buildTracks(specs: readonly TweenSpec[]): TargetTrack[] {
  const order = [...specs].sort((a, b) => a.startTime - b.startTime)
  const builders = new Map<string, TrackBuilder>()

  const builderFor = (spec: TweenSpec, property: string): TrackBuilder => {
    const k = keyFor(spec, property)
    let b = builders.get(k)
    if (!b) {
      b = { target: spec.target, property, keyframes: [], hasOpaque: false }
      builders.set(k, b)
    }
    return b
  }

  for (const spec of order) {
    const end = spec.startTime + spec.duration

    if (spec.from) {
      // .from / .fromTo — explicit start values are known.
      for (const [property, value] of Object.entries(spec.from)) {
        const b = builderFor(spec, property)
        putKeyframe(b.keyframes, spec.startTime, value)
        const to = spec.to[property]
        if (typeof to === 'number') {
          putKeyframe(b.keyframes, end, to, spec.ease)
        } else {
          // .from: destination is the object's pre-existing value — unknown host-side.
          b.hasOpaque = true
        }
        if (spec.opaque) b.hasOpaque = true
      }
    }

    // Destination-only props (`.to`/`.set`, or fromTo props without a matching `from`).
    for (const [property, value] of Object.entries(spec.to)) {
      if (spec.from && property in spec.from) continue
      const b = builderFor(spec, property)
      if (spec.duration === 0) {
        // .set — instantaneous step.
        putKeyframe(b.keyframes, spec.startTime, value, 'none')
      } else {
        const hasAnchor = b.keyframes.some((k) => k.t <= spec.startTime)
        if (!hasAnchor) b.hasOpaque = true // leading .to: implicit start unknown
        putKeyframe(b.keyframes, end, value, spec.ease)
      }
      if (spec.opaque) b.hasOpaque = true
    }

    // A fully-opaque spec (no numeric props at all, e.g. an onUpdate-only tween) still
    // records its span so the inspector can show it.
    if (!spec.from && Object.keys(spec.to).length === 0 && spec.opaque) {
      const b = builderFor(spec, '(opaque)')
      b.hasOpaque = true
      putKeyframe(b.keyframes, spec.startTime, 0, 'none')
      if (end > spec.startTime) putKeyframe(b.keyframes, end, 1, spec.ease)
    }
  }

  return [...builders.values()].map((b) => ({
    target: b.target,
    property: b.property,
    hasOpaque: b.hasOpaque,
    track: { keyframes: b.keyframes.sort((a, z) => a.t - z.t) },
  }))
}

/** Extract a `TimelineDoc` (specs + derived tracks + duration) from a recorded timeline. */
export function extractTimeline(tl: RecordingTimeline): TimelineDoc {
  return {
    duration: tl.recordedDuration,
    specs: [...tl.specs],
    tracks: buildTracks(tl.specs),
  }
}
