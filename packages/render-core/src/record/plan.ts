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
  doc.segments = splitSegmentsAtSkips(doc.segments, artifact.meta.skips)
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

/**
 * The footage's segments split at every cut an `await` made
 * (`meta.skips[].at`, source seconds), so each cut is a real segment
 * boundary: the timeline shows it, a transition can sit on it, a trim can
 * take either side. A cut at an edge or outside a segment splits nothing,
 * and a segment of another media is left alone. A split segment keeps its
 * arrival on its first piece and its leaving on its last.
 */
export function splitSegmentsAtSkips(
  segments: ProjectDoc['segments'],
  skips: readonly { at: number }[] | undefined,
): ProjectDoc['segments'] {
  if (!skips?.length) return segments
  const cuts = [...new Set(skips.map((s) => s.at))].sort((a, b) => a - b)
  const out: ProjectDoc['segments'] = []
  for (const seg of segments) {
    const inside = seg.media
      ? []
      : cuts.filter((at) => at > seg.in + 1e-3 && at < seg.out - 1e-3)
    if (!inside.length) {
      out.push(seg)
      continue
    }
    const { anim, hold, ...plain } = seg
    const edges = [seg.in, ...inside, seg.out]
    for (let i = 0; i < edges.length - 1; i++) {
      const first = i === 0
      const last = i === edges.length - 2
      const pieceAnim =
        anim && (first || last)
          ? {
              ...(first && anim.enter ? { enter: anim.enter } : {}),
              ...(last && anim.exit ? { exit: anim.exit } : {}),
            }
          : null
      out.push({
        ...plain,
        in: edges[i],
        out: edges[i + 1],
        ...(pieceAnim && Object.keys(pieceAnim).length
          ? { anim: pieceAnim }
          : {}),
        ...(last && hold !== undefined ? { hold } : {}),
      })
    }
  }
  return out
}
