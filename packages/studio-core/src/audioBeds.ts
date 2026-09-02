/**
 * Music beds — the doc semantics of "background music under the cut".
 *
 * A bed is an ordinary AudioClip with music-true defaults: it starts at 0,
 * covers the whole output (looping to fill when the track is shorter than
 * the cut, trimming its tail when it is longer), ducks under the mic when
 * there is a voice to duck under, and fades out instead of stopping dead.
 * Every default is a plain clip field the user can change afterwards —
 * defaults, not policy.
 *
 * `refillAudioBeds` is the trim-follow rule: when an edit changes the output
 * duration, any clip whose END tracked the previous output end is re-fit to
 * the new one, inside the SAME edit (one undo step, never a stored rule in
 * the doc — lowering stays pure).
 */
import { totalDuration } from '@vosjs/timeline'
import { ratedSegments } from './lower/lowerToComposition'
import type { StudioDoc } from './doc/studioDoc'
import type { AudioClip, ProjectDoc } from './types'

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** Rate-aware OUTPUT duration of a doc (what the viewer experiences). */
/**
 * The OUTPUT length of either document: a recording's kept footage
 * through its speed spans, a program's own length (its `program.duration`,
 * else the config's).
 */
export function docOutputDuration(doc: StudioDoc): number {
  return totalDuration(ratedSegments(doc))
}

export interface MusicBedInput {
  id: string
  /** Durable URL of the track (assets.vos.so catalog or an owned asset). */
  key: string
  name: string
  /** Full source-file length, seconds. */
  trackDuration: number
  /** Current output duration of the doc, seconds. */
  outputDuration: number
  /** Whether the recording carries a mic track (ducking default). */
  hasMic: boolean
}

/** A catalog track placed as the doc's background music bed. */
export function musicBedClip(input: MusicBedInput): AudioClip {
  const track = round3(input.trackDuration)
  const output = round3(input.outputDuration)
  const clip: AudioClip = {
    id: input.id,
    key: input.key,
    name: input.name,
    start: 0,
    in: 0,
    out: track,
    duration: track,
    // Under speech, not over it; catalog tracks are loudness-normalized so
    // one default means the same thing across the library.
    gain: 0.5,
    fadeIn: 0,
    // A bed that just stops reads as a glitch; clamp so a very short cut
    // still spends most of its time at full level.
    fadeOut: output > 0 ? Math.min(1.5, round3(output / 4)) : 1.5,
    duck: input.hasMic || undefined,
  }
  if (output <= 0) return clip
  if (track >= output) {
    // Track outruns the cut: trim the tail to the output end.
    clip.out = output
  } else {
    // Cut outruns the track: loop the whole track to fill it.
    clip.loop = true
    clip.loopLen = output
  }
  return clip
}

/**
 * Is this clip a music BED — background music covering the cut? Beds are
 * what "add a track" replaces (one bed at a time; trying another vibe must
 * not stack). A clip the user moved off 0 or shortened mid-cut stopped
 * being a bed on purpose, so it is theirs to manage and never auto-replaced.
 */
export function isMusicBed(clip: AudioClip, outputDuration: number): boolean {
  if (clip.start > 0.05) return false
  if (clip.loop) return true
  const placed = clip.out - clip.in
  return Math.abs(placed - outputDuration) <= 1
}

/**
 * Re-fit clips that tracked the output end after the duration changed from
 * `prevDuration` to `nextDuration` (both OUTPUT seconds). Mutates `doc`
 * (an immer draft in practice); returns whether anything changed.
 */
export function refillAudioBeds(
  doc: ProjectDoc,
  prevDuration: number,
  nextDuration: number,
): boolean {
  const EPS = 0.05
  if (Math.abs(nextDuration - prevDuration) <= EPS || nextDuration <= 0) {
    return false
  }
  let changed = false
  for (const clip of doc.audio) {
    if (clip.start >= nextDuration) continue
    const placed = clip.loop
      ? Math.max(clip.out - clip.in, clip.loopLen ?? clip.out - clip.in)
      : clip.out - clip.in
    // Only clips whose end sat AT the previous output end follow it — a clip
    // deliberately placed mid-timeline is the user's to manage.
    if (Math.abs(clip.start + placed - prevDuration) > EPS) continue
    const span = clip.out - clip.in
    const nextLen = round3(nextDuration - clip.start)
    if (clip.loop) {
      if (nextLen >= span) {
        clip.loopLen = nextLen
      } else {
        // Shorter than one pass: a loop cannot shrink below its span
        // (clipLength floors at the span), so it becomes a plain trim.
        clip.loop = undefined
        clip.loopLen = undefined
        clip.out = round3(clip.in + nextLen)
      }
    } else {
      if (clip.in + nextLen <= clip.duration) {
        clip.out = round3(clip.in + nextLen)
      } else {
        // The cut outgrew the source file: loop the full remainder to fill.
        clip.out = clip.duration
        clip.loop = true
        clip.loopLen = nextLen
      }
    }
    changed = true
  }
  return changed
}

/**
 * The take's VOICE source key, or null when it has none: the mic sidecar when
 * the take was recorded split (AT), else the legacy mixed track (pre-split
 * takes carried mic+system in the recording's own file). Ducking, the duck-RMS
 * decode and every "has a voice?" UI gate share this one derivation.
 */
export function voiceKey(
  doc: Pick<ProjectDoc, 'source'> | StudioDoc,
): string | null {
  // A program has no voice: the duck controls simply do not show.
  if (!('source' in doc)) return null
  const src = doc.source
  if (src.micKey) return src.micKey
  if (src.meta.hasAudio && !src.meta.hasMic) return src.videoKey
  return null
}
