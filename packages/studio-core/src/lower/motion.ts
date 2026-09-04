/**
 * The clip's presentation moves: how the card ENTERS, how a cut HOLDS on
 * its last frame, and the END CARD that stands as the clip's poster. Each
 * is a producer of tracks and clips the lowering already understands:
 * the entrance writes the head of the tilt or zoom track and a card-pose
 * track (scale, rise, opacity); a hold is a rated segment whose tiny
 * source span plays for its seconds; the end card is a hold plus text
 * overlays over a receding card. Pure; ON_FRAME reads the tracks.
 */
import { sortKeyframes } from '@vosjs/timeline'
import type { Keyframe, KeyframeTrack, Segment } from '@vosjs/timeline'
import type {
  EndCard,
  FrameEntrance,
  OverlayClip,
  ProjectDoc,
  TextOverlayClip,
} from '../types'

/** The entrance's default length, seconds. */
export const ENTRANCE_SECONDS = 1.2
/** The end card's default length, seconds. */
export const END_CARD_SECONDS = 2.5
/** How long the card takes to recede under the end card's words. */
export const END_CARD_RECEDE = 0.7
/** The tilt-in's opening pose, degrees: top edge away, left edge toward. */
export const TILT_IN_POSE: [number, number] = [-9, 14]
/** The pull-out's opening zoom level. */
export const PULL_OUT_LEVEL = 1.32

const HOLD_SOURCE_SPAN = 0.002

export function entranceSeconds(e: FrameEntrance | null | undefined): number {
  if (!e || e.kind === 'none') return 0
  return Math.max(0.2, Math.min(3, e.seconds ?? ENTRANCE_SECONDS))
}

/**
 * The rated segments with every `hold` expanded: after the last rated
 * piece of a held segment, a freeze piece whose tiny source span at the
 * segment's end plays for `hold` output seconds. Every consumer of the
 * rated list (mapTime, the zoom remap, the audio splice, the duration)
 * inherits the hold from this one seam.
 */
export function withHolds(
  docSegments: readonly (Segment & { hold?: number })[],
  rated: Segment[],
): Segment[] {
  const out: Segment[] = []
  const pending = docSegments
    .filter((s) => typeof s.hold === 'number' && s.hold > 0)
    .map((s) => ({ out: s.out, hold: s.hold as number, used: false }))
  for (let i = 0; i < rated.length; i++) {
    const piece = rated[i]
    out.push(piece)
    const next = rated[i + 1]
    for (const p of pending) {
      if (p.used) continue
      const endsHere = Math.abs(piece.out - p.out) < 1e-9
      const nextContinues = next && Math.abs(next.in - p.out) < 1e-9 && next.out > p.out
      if (endsHere && !nextContinues) {
        out.push({
          in: p.out - HOLD_SOURCE_SPAN,
          out: p.out,
          rate: HOLD_SOURCE_SPAN / p.hold,
        })
        p.used = true
      }
    }
  }
  return out
}

/** Keyframes an entrance prepends to the tilt track, or none. */
export function entranceTiltKeyframes(
  e: FrameEntrance | null | undefined,
): Keyframe<number[]>[] {
  const s = entranceSeconds(e)
  if (!s || e?.kind !== 'tilt-in') return []
  return [
    { t: 0, value: [...TILT_IN_POSE], ease: 'none' },
    { t: s, value: [0, 0], ease: 'power3.out' },
  ]
}

/** Keyframes an entrance prepends to the zoom track ([level, cx, cy]), or none. */
export function entranceZoomKeyframes(
  e: FrameEntrance | null | undefined,
): Keyframe<number[]>[] {
  const s = entranceSeconds(e)
  if (!s || e?.kind !== 'pull-out') return []
  return [
    { t: 0, value: [PULL_OUT_LEVEL, 0.5, 0.42], ease: 'none' },
    { t: s, value: [1, 0.5, 0.5], ease: 'power3.out' },
  ]
}

/**
 * Prepend an entrance's keyframes to a track: keyframes the entrance
 * would overlap (earlier than its end plus a beat) give way, so a span
 * that starts at the cold open loses its head to the entrance rather
 * than fighting it. An empty entrance returns the track untouched.
 */
export function prependEntrance(
  track: KeyframeTrack<number[]> | undefined,
  head: Keyframe<number[]>[],
): KeyframeTrack<number[]> | undefined {
  if (!head.length) return track
  const end = head[head.length - 1].t
  const rest = (track?.keyframes ?? []).filter((k) => k.t > end + 0.1)
  return { keyframes: sortKeyframes([...head, ...rest]) }
}

/**
 * The card-pose track [scale, dy, opacity] in OUTPUT seconds: the entrance
 * settles the card in from a slightly smaller, lower, transparent pose;
 * the end card recedes it under the words. Undefined when neither
 * exists, so a doc without them lowers byte-identically.
 */
export function cardPoseTrack(
  e: FrameEntrance | null | undefined,
  endStart: number | null,
  endSeconds: number,
): KeyframeTrack<number[]> | undefined {
  const keyframes: Keyframe<number[]>[] = []
  const s = entranceSeconds(e)
  if (s) {
    const from =
      e?.kind === 'rise'
        ? [0.96, 0.08, 0]
        : e?.kind === 'pull-out'
          ? [1, 0, 0]
          : [0.94, 0.05, 0]
    keyframes.push({ t: 0, value: from, ease: 'none' })
    keyframes.push({ t: s, value: [1, 0, 1], ease: 'power3.out' })
  }
  if (endStart !== null && endSeconds > 0) {
    const t0 = Math.max(endStart, s)
    keyframes.push({ t: t0, value: [1, 0, 1], ease: 'none' })
    keyframes.push({
      t: t0 + Math.min(END_CARD_RECEDE, endSeconds * 0.4),
      value: [0.9, -0.02, 0.22],
      ease: 'power2.out',
    })
  }
  if (!keyframes.length) return undefined
  return { keyframes: sortKeyframes(keyframes) }
}

/**
 * A doc with its end card expanded: the last segment holds for the card's
 * seconds and the card's words ride as OUTPUT-anchored text overlays over
 * the receding footage (the house presets, so they resolve at lowering like
 * any title). Returns the output second the card starts at, for the pose
 * track. A doc with no end card comes back as itself.
 */
export function expandEndCard(
  doc: ProjectDoc,
  outputDuration: number,
): { doc: ProjectDoc; endStart: number | null; seconds: number } {
  const card = doc.endCard
  if (!card || !doc.segments.length) return { doc, endStart: null, seconds: 0 }
  const seconds = Math.max(1, Math.min(8, card.seconds ?? END_CARD_SECONDS))
  const segments = doc.segments.map((s, i) =>
    i === doc.segments.length - 1
      ? { ...s, hold: ((s as { hold?: number }).hold ?? 0) + seconds }
      : s,
  )
  const endStart = outputDuration
  const clips: TextOverlayClip[] = []
  const text = (
    id: string,
    body: string,
    preset: TextOverlayClip['preset'],
    y: number,
    delay: number,
  ): TextOverlayClip => ({
    id,
    kind: 'text',
    text: body,
    preset,
    start: endStart + delay,
    duration: Math.max(0.3, seconds - delay),
    transform: { x: 0.5, y, scale: 1, rotation: 0 },
    enter: 'rise',
    exit: 'none',
    align: 'center',
  })
  if (card.headline?.trim()) clips.push(text('endcard-title', card.headline.trim(), 'title', 0.44, 0.35))
  if (card.sub?.trim()) clips.push(text('endcard-sub', card.sub.trim(), 'caption', 0.57, 0.5))
  if (card.wordmark?.trim()) clips.push(text('endcard-mark', card.wordmark.trim(), 'label', 0.88, 0.65))
  const overlays: OverlayClip[] = [...(doc.overlays ?? []), ...clips]
  return { doc: { ...doc, segments, overlays }, endStart, seconds }
}
