/**
 * Plan — build or refresh the take's ProjectDoc (doc.json), the agent-editable
 * surface. Fresh takes run the real studio ingest + auto-zoom planner. Reruns
 * honor the wand contract: `source:'manual'` zoom spans (and every other doc
 * edit) are preserved; only `source:'auto'` spans are regenerated, and new
 * suggestions overlapping a manual span are dropped.
 *
 * Two more things a plan writes, both DATA on the document so the studio
 * shows what the kit will render: a LAYOUT copied from a poster document
 * (`--style` carries the seed's card placement, its stage clips by id, its
 * rest lean and its trailing hold, with the release's words patched into
 * the stage clips), and the cut's MOTION as planner proposals (the card's
 * entrance, the end card, a caption per beat, a music bed and click
 * sounds, from LAUNCH.md's roles). Motion is proposed on a FRESH plan and
 * on `--motion`, never on a refresh: a document that carries a cut is the
 * maker's, and a deleted end card stays deleted.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_FRAME_STYLE,
  STYLE_FIELDS,
  copyLayout,
  copyStyle,
  isRejected,
  isStageClip,
  layoutOf,
  planAutoSpeed,
  planAutoZoom,
  projectFromArtifact,
  withBackdrop,
  migrateMotion,
} from '@vosjs/studio-core'
import { RECORDING_NAME, loadTake, writeJson } from './take'
import { retimeCut } from './reuse'
import { proposeMotion } from './motionPlan'
import type { MotionProposalInput } from './motionPlan'
import type { ReuseReport } from './reuse'
import type { ReleaseWords } from './posterValues'
import type {
  Backdrop,
  LayoutParts,
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
  /** The loop the fresh doc opened on when one was handed in (`none` if a reference's frame won without one). */
  backdrop?: string
  /** The style fields copied from `--style`'s reference, when given. */
  styleFrom?: string
  styleFields?: readonly string[]
  /** The layout the reference carried and what the copy left alone. */
  layout?: LayoutParts & { notes: string[] }
  /** The motion proposed onto the document, and what could not be. */
  motion?: { notes: string[]; skipped: string[] }
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
   * A reference that is a POSTER carries its layout too: the stage clips
   * by id, the rest lean where this take has no spans, the trailing hold.
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
  /**
   * The backdrop a FRESH doc opens on (the set's house pick, or what
   * `--background` named), written under a `--style`/`--reuse` reference's
   * frame, which still wins. Null or absent: the bare frame.
   */
  backdrop?: Backdrop | null
  /**
   * The release's words, patched into the stage clips a layout carries
   * (`stage-title` ← headline, `stage-kicker` ← kicker, `stage-brand` ←
   * the wordmark) and read by the end card.
   */
  words?: ReleaseWords
  /** The brand's mark (a take-dir key + aspect): the layout's `stage-mark` and the end card's mark. */
  mark?: { key: string; aspect: number } | null
  /**
   * Propose the cut's motion (the card's enter, the templates the recipe
   * names, the end card, captions, bed, clicks) from these roles. Applied
   * on a fresh plan; `again` re-proposes onto an existing document
   * (replacing only the proposals' own ids and `from`s).
   */
  motion?: MotionProposalInput & { again?: boolean }
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

/**
 * The release's words into the stage clips a layout carries: a headline
 * into `stage-title`, a kicker into `stage-kicker`, the wordmark into
 * `stage-brand`. A word that is absent leaves the clip's own words (the
 * exemplar's placeholder, or what the maker typed). In place.
 */
export function patchStageWords(doc: ProjectDoc, words: ReleaseWords): void {
  const map: Record<string, string | null | undefined> = {
    'stage-title': words.headline,
    'stage-kicker': words.kicker,
    'stage-brand': words.brand,
  }
  for (const clip of doc.overlays ?? []) {
    if (clip.kind !== 'text' || !isStageClip(clip)) continue
    const v = map[clip.id]
    if (typeof v === 'string' && v.trim()) clip.text = v.trim()
  }
}

/** `copyStyle` with the layout, the words and the mark applied. */
function applyStyle(
  seed: ProjectDoc,
  doc: ProjectDoc,
  opts: PlanOptions,
): { doc: ProjectDoc; layout: PlanSummary['layout'] } {
  const parts = layoutOf(seed)
  const carries = parts.clips.length > 0 || parts.lean || parts.freeze
  if (!carries) return { doc: copyStyle(seed, doc), layout: undefined }
  const keys = opts.mark ? { 'stage-mark': opts.mark.key } : undefined
  const { doc: next, notes } = copyLayout(seed, copyStyle(seed, doc), { keys })
  if (opts.words) patchStageWords(next, opts.words)
  return { doc: next, layout: { ...parts, notes } }
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
  // The frame a fresh doc opens on: the house backdrop on the bare frame
  // when one was handed in. The ingest still derives the browser bar from
  // the footage on top of it.
  const ingest = opts.backdrop
    ? { frame: withBackdrop(DEFAULT_FRAME_STYLE, opts.backdrop) }
    : {}

  let doc: ProjectDoc
  let fresh: boolean
  let layout: PlanSummary['layout']
  if (opts.reuse) {
    // The re-render loop: fresh ingest of the NEW footage, the
    // previous cut's style + human work re-timed onto it, autos re-planned.
    // The previous cut in the one vocabulary (a legacy end card becomes
    // clips and a card exit, which ride along like the other overlays).
    const prev = migrateMotion(opts.reuse.doc)
    const artifact: RecordingArtifact = {
      videoKey: RECORDING_NAME,
      cursor,
      meta,
    }
    doc = projectFromArtifact(artifact, RECORDING_NAME, ingest).doc
    doc = copyStyle(prev, doc)
    const rt = retimeCut(prev, meta.steps ?? [], meta.durationMs)
    doc.segments = rt.segments
    // The previous cut's freezes survive the re-record, re-timed onto the
    // new footage (the trailing one is the poster's still).
    if (rt.freeze.length) doc.freeze = rt.freeze
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
    if (opts.style) {
      const applied = applyStyle(opts.style.doc, take.doc, opts)
      doc = applied.doc
      layout = applied.layout
    } else {
      doc = take.doc
    }
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
    doc = projectFromArtifact(artifact, RECORDING_NAME, ingest).doc
    if (opts.style) {
      const applied = applyStyle(opts.style.doc, doc, opts)
      doc = applied.doc
      layout = applied.layout
    }
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

  // The motion proposals ride a fresh document, or an explicit re-ask.
  let motion: PlanSummary['motion']
  if (opts.motion && (fresh || opts.motion.again)) {
    const proposed = proposeMotion(doc, opts.motion)
    doc = proposed.doc
    motion = { notes: proposed.notes, skipped: proposed.skipped }
  }

  await writeJson(take.paths.doc, doc, true)
  return {
    doc,
    zoomAuto: doc.zoom.filter((z) => z.source !== 'manual').length,
    zoomManual: doc.zoom.filter((z) => z.source === 'manual').length,
    cursorKept: doc.source.cursor.length > 0,
    fresh,
    ...(opts.backdrop
      ? { backdrop: doc.frame.backgroundMedia?.key ?? 'none' }
      : {}),
    ...(opts.style
      ? {
          styleFrom: opts.style.from,
          styleFields: STYLE_FIELDS.filter(
            (k) => opts.style!.doc[k] !== undefined,
          ),
        }
      : {}),
    ...(layout ? { layout } : {}),
    ...(motion ? { motion } : {}),
  }
}
