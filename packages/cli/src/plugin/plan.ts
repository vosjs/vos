/**
 * Plan — build or refresh the take's ProjectDoc (doc.json), the agent-editable
 * surface. Fresh takes run the real studio ingest + auto-zoom planner. Reruns
 * honor the wand contract: `source:'manual'` zoom spans (and every other doc
 * edit) are preserved; only `source:'auto'` spans are regenerated, and new
 * suggestions overlapping a manual span are dropped.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  STYLE_FIELDS,
  copyStyle,
  isRejected,
  planAutoSpeed,
  planAutoZoom,
  projectFromArtifact,
} from '@vosjs/studio-core'
import { RECORDING_NAME, loadTake, writeJson } from './take'
import { retimeCut } from './reuse'
import type { ReuseReport } from './reuse'
import type {
  ProjectDoc,
  RecordingArtifact,
  ZoomSpan,
} from '@vosjs/studio-core'

export interface PlanSummary {
  doc: ProjectDoc
  zoomAuto: number
  zoomManual: number
  cursorKept: boolean
  fresh: boolean
  /** The style fields copied from `--style`'s reference, when given. */
  styleFrom?: string
  styleFields?: readonly string[]
  /** `--reuse`: what the re-anchor did and what it could not. */
  reuse?: ReuseReport & { from: string }
}

export interface PlanOptions {
  /**
   * Style transfer at the data layer: a signed-off take whose
   * zoomStyle/zoomParams/speedParams/tiltStyle/frame/cursor/cam/export are
   * copied onto this take BEFORE the planners run, so the auto spans are
   * proposed under the series' camera. The cut (spans, overlays, audio) is
   * never touched; a field absent on the reference is removed here too.
   */
  style?: { from: string; doc: ProjectDoc }
  /**
   * The re-render loop: a PREVIOUS cut of the same script (a
   * re-record's doc.prev.json) applied to this take's NEW footage. Style
   * fields copy over like --style; the human's camera spans and trims
   * re-time through the step map / explicit anchors; output-anchored work
   * (overlays, audio, objects) carries at its output times; auto spans
   * re-plan on the new cursor. The report NAMES whatever could not follow.
   */
  reuse?: { from: string; doc: ProjectDoc }
}

const overlaps = (a: ZoomSpan, b: ZoomSpan) => a.in < b.out && b.in < a.out

/** `<take>/digest/digest.json`'s activity bins, when a digest exists. */
async function readDigestActivity(
  dir: string,
): Promise<readonly number[] | null> {
  const file = join(dir, 'digest', 'digest.json')
  if (!existsSync(file)) return null
  try {
    const d = JSON.parse(await readFile(file, 'utf8')) as {
      activity?: unknown
    }
    return Array.isArray(d.activity) &&
      d.activity.every((v) => typeof v === 'number')
      ? d.activity
      : null
  } catch {
    return null
  }
}

export async function planTake(
  dir: string,
  opts: PlanOptions = {},
): Promise<PlanSummary> {
  const take = await loadTake(dir)
  const { meta, cursor } = take
  // A digest's activity bins, when one exists: the speed planner then tells
  // playback from idle (the studio's ingest has no such witness).
  const activity = await readDigestActivity(dir)

  let doc: ProjectDoc
  let fresh: boolean
  if (opts.reuse) {
    // The re-render loop: fresh ingest of the NEW footage, the
    // previous cut's style + human work re-timed onto it, autos re-planned.
    const prev = opts.reuse.doc
    const artifact: RecordingArtifact = {
      videoKey: RECORDING_NAME,
      cursor,
      meta,
    }
    doc = projectFromArtifact(artifact, RECORDING_NAME).doc
    doc = copyStyle(prev, doc)
    const rt = retimeCut(prev, meta.steps ?? [], meta.durationMs)
    doc.segments = rt.segments
    // The previous cut's deletions come along too: a proposal the human
    // rejected stays rejected on the new footage.
    if (rt.rejected.length) doc.rejected = rt.rejected
    const manualZoom = rt.zoom
    const autoZoom = planAutoZoom(doc.source.cursor, {
      width: doc.source.meta.width,
      height: doc.source.meta.height,
      style: doc.zoomStyle,
      params: doc.zoomParams,
    })
      .filter((z) => !manualZoom.some((m) => overlaps(z, m)))
      .filter((z) => !isRejected('zoom', z, doc.rejected))
    doc.zoom = [...manualZoom, ...autoZoom].sort((a, b) => a.in - b.in)
    const manualSpeed = rt.speed
    const autoSpeed = planAutoSpeed(doc.source.cursor, {
      durationMs: doc.source.meta.durationMs,
      params: doc.speedParams,
      activity,
    })
      .filter((s) => !manualSpeed.some((m) => s.in < m.out && s.out > m.in))
      .filter((s) => !isRejected('speed', s, doc.rejected))
    doc.speed = [...manualSpeed, ...autoSpeed].sort((a, b) => a.in - b.in)
    if (rt.tilt.length) doc.tilt = rt.tilt
    // Output-anchored work carries at its output times — a title at 1s is
    // still a title at 1s (the constant-perceived-position contract).
    if (prev.overlays?.length) doc.overlays = prev.overlays
    if (prev.objects?.length) doc.objects = prev.objects
    if (prev.audio.length) doc.audio = prev.audio
    if (prev.camMotion?.length) doc.camMotion = prev.camMotion

    await writeJson(take.paths.doc, doc, true)
    return {
      doc,
      zoomAuto: doc.zoom.filter((z) => z.source !== 'manual').length,
      zoomManual: doc.zoom.filter((z) => z.source === 'manual').length,
      cursorKept: doc.source.cursor.length > 0,
      fresh: false,
      reuse: { ...rt.report, from: opts.reuse.from },
    }
  }
  if (take.doc) {
    doc = opts.style ? copyStyle(opts.style.doc, take.doc) : take.doc
    fresh = false
    const manual = doc.zoom.filter((z) => z.source === 'manual')
    const auto = planAutoZoom(doc.source.cursor, {
      width: doc.source.meta.width,
      height: doc.source.meta.height,
      style: doc.zoomStyle,
      params: doc.zoomParams,
    })
      .filter((z) => !manual.some((m) => overlaps(z, m)))
      .filter((z) => !isRejected('zoom', z, doc.rejected))
    doc.zoom = [...manual, ...auto].sort((a, b) => a.in - b.in)
    // The speed wand: absent `source` counts as manual — spans from before
    // the wand are user work and always survive a re-plan.
    const manualSpeed = (doc.speed ?? []).filter((s) => s.source !== 'auto')
    const autoSpeed = planAutoSpeed(doc.source.cursor, {
      durationMs: doc.source.meta.durationMs,
      params: doc.speedParams,
      activity,
    })
      .filter((s) => !manualSpeed.some((m) => s.in < m.out && s.out > m.in))
      .filter((s) => !isRejected('speed', s, doc.rejected))
    doc.speed = [...manualSpeed, ...autoSpeed].sort((a, b) => a.in - b.in)
  } else {
    const artifact: RecordingArtifact = {
      videoKey: RECORDING_NAME,
      cursor,
      meta,
    }
    doc = projectFromArtifact(artifact, RECORDING_NAME).doc
    if (opts.style) doc = copyStyle(opts.style.doc, doc)
    doc.zoom = planAutoZoom(doc.source.cursor, {
      width: doc.source.meta.width,
      height: doc.source.meta.height,
      style: doc.zoomStyle,
      params: doc.zoomParams,
    })
    doc.speed = planAutoSpeed(doc.source.cursor, {
      durationMs: doc.source.meta.durationMs,
      params: doc.speedParams,
      activity,
    })
    fresh = true
  }

  await writeJson(take.paths.doc, doc, true)
  return {
    doc,
    zoomAuto: doc.zoom.filter((z) => z.source !== 'manual').length,
    zoomManual: doc.zoom.filter((z) => z.source === 'manual').length,
    cursorKept: doc.source.cursor.length > 0,
    fresh,
    ...(opts.style
      ? {
          styleFrom: opts.style.from,
          styleFields: STYLE_FIELDS.filter(
            (k) => opts.style!.doc[k] !== undefined,
          ),
        }
      : {}),
  }
}
