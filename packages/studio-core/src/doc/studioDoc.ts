import type {
  AudioClip,
  ObjectClip,
  OverlayClip,
  ProjectDoc,
  SpeedSpan,
} from '../types'

/**
 * The studio document family.
 *
 * A document is an ANCHOR plus the layers every anchor shares. `ProjectDoc`
 * is the recording-anchored member, field for field what it always was (its
 * wire, `doc.json`, does not move). `ProgramAnchorDoc` is the program-anchored
 * member: its anchor IS the user's config — the execution IR, untouched
 * — plus the tween-timing overlay that used to live only in a
 * hook. The shared layers are optional on it until the shared modules activate them.
 *
 * Discriminated on `source`: every recording doc carries one, no program doc
 * may.
 */

/** One entry of the tween-timing overlay — `@vosjs/tween`'s `TweenEdit`, structurally. */
export interface ProgramTweenEdit {
  index: number
  startTime?: number
  duration?: number
  ease?: string
  to?: Record<string, number>
  from?: Record<string, number>
}

export interface ProgramAnchorDoc {
  program: {
    /** THE user's config, as authored (functions as strings). Never composed here. */
    config: Record<string, unknown>
    /** Retimes over the config's recorded tweens, by spec index. */
    tweenEdits?: Record<number, ProgramTweenEdit>
    /** The anchor's own length when the config's is a placeholder. */
    duration?: number
  }
  overlays?: OverlayClip[]
  objects?: ObjectClip[]
  /** Required, like the recording's: the audio module and its lane read it without a guard. Minted `[]`. */
  audio: AudioClip[]
  /** Retime spans over the ANCHOR's clock: the recording's type, `in`/`out` in program seconds. */
  speed?: SpeedSpan[]
  export?: ProjectDoc['export']
}

export type StudioDoc = ProjectDoc | ProgramAnchorDoc

export type AnchorKind = 'recording' | 'program'

export const anchorKindOf = (doc: StudioDoc): AnchorKind =>
  'source' in doc ? 'recording' : 'program'

export const isRecordingDoc = (doc: StudioDoc): doc is ProjectDoc =>
  'source' in doc

export const isProgramDoc = (doc: StudioDoc): doc is ProgramAnchorDoc =>
  !('source' in doc)

/** A program anchor's own length in seconds: `program.duration`, else the config's. */
export function programDuration(doc: ProgramAnchorDoc): number {
  const own = doc.program.duration
  if (typeof own === 'number' && own > 0) return own
  const cfg = doc.program.config.duration
  return typeof cfg === 'number' && cfg > 0 ? cfg : 0
}

/**
 * The anchor's SOURCE length: the footage's for a recording, the
 * program's own for a program. Speed spans, segments and every source-time
 * floor measure against it.
 */
export function anchorSourceDuration(doc: StudioDoc): number {
  return isRecordingDoc(doc)
    ? doc.source.meta.durationMs / 1000
    : programDuration(doc)
}
