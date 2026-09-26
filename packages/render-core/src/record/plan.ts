/**
 * The FRESH plan of a take: what `vos record` writes as doc.json the moment
 * a recording lands, and what a hosted take gets on the fleet. One
 * composition, so a take recorded anywhere opens on the same camera: the
 * artifact becomes a document (`projectFromArtifact`), the zooms are
 * planned from the cursor track, the speed spans from the same track. The
 * backdrop is a host's PICK (vosso's house set, the CLI's `--background`),
 * handed in as a wire row; studio-core carries only the mechanism.
 *
 * The CLI's `vos plan` is the fuller verb (reuse, style, motion, a still);
 * this is its fresh branch, byte-identical to it.
 */
import {
  DEFAULT_FRAME_STYLE,
  planAutoSpeed,
  planAutoZoom,
  projectFromArtifact,
  withBackdrop,
} from '@vosjs/studio-core'
import type {
  Backdrop,
  ProjectDoc,
  RecordingArtifact,
} from '@vosjs/studio-core'

export interface FreshPlanOptions {
  /** The backdrop the document opens on; absent keeps the bare frame. */
  backdrop?: Backdrop | null
  /** A digest's activity bins, when one exists (the speed planner's witness). */
  activity?: readonly number[] | null
}

export function planFreshTake(
  artifact: RecordingArtifact,
  recordingName: string,
  opts: FreshPlanOptions = {},
): ProjectDoc {
  const ingest = opts.backdrop
    ? { frame: withBackdrop(DEFAULT_FRAME_STYLE, opts.backdrop) }
    : {}
  const doc = projectFromArtifact(artifact, recordingName, ingest).doc
  doc.zoom = planAutoZoom(doc.source.cursor, {
    width: doc.source.meta.width,
    height: doc.source.meta.height,
    duration: doc.source.meta.durationMs / 1000,
    style: doc.zoomStyle,
    params: doc.zoomParams,
  })
  doc.speed = planAutoSpeed(doc.source.cursor, {
    durationMs: doc.source.meta.durationMs,
    params: doc.speedParams,
    activity: opts.activity,
  })
  return doc
}
