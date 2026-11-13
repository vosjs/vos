/**
 * Step captions: every recorder step that carries a `caption` (two to eight
 * words in actions.json) becomes a text layer ANCHORED to that step, in the
 * house caption style. The anchor is what keeps it honest: the lowering
 * places it where the step plays in the cut, so a trim or a speed change
 * moves it with no edit, and `start` is written too, as the fallback and as
 * what a reader of the document sees.
 *
 * The captions it lands are stamped `from: 'steps'`, so a second run
 * replaces exactly those and nothing a person wrote; a step that already
 * has a caption anchored to it (or the plan's own caption for it) is left
 * alone. Pure: the caller hands in each media's actions.json.
 */
import {
  docCardLayout,
  docMediaList,
  findStep,
  mediaKey,
  overlayPlainText,
  ratedSegments,
  resolveAnchor,
  segmentOutputExtents,
} from '@vosjs/studio-core'
import { totalDuration } from '@vosjs/timeline'
import { CAPTION_MAX, CAPTION_MIN, fitCaptions, heldLine } from './captionFit'
import { CAPTION_ID_PREFIX, houseCaption } from './motionPlan'
import { scriptStepOf } from './scriptStep'
import type {
  OverlayAnchor,
  OverlayClip,
  ProjectDoc,
  StepSpan,
} from '@vosjs/studio-core'
import type { ActionsFile } from './actions'

/** The provenance a landed step caption carries. */
export const STEP_CAPTIONS_FROM = 'steps'

/**
 * Where a step caption lands: as its step BEGINS (`at: "start"`, no
 * offset), so the words name the beat while it plays. Landing after the
 * gesture ended ran a caption over the next beat's payoff.
 */
export const STEP_CAPTION_AT = 'start' as const

export interface StepCaptionReport {
  /** Captions landed (each `media` absent = the primary). */
  landed: { id: string; step: string | number; media?: string; start: number }[]
  /** Steps with a caption that did not land, in words. */
  skipped: string[]
  /** Landed captions kept past their step to be read, in words. */
  held: string[]
  /** The media (`''` = the primary) that have steps and not one caption among them. */
  uncaptioned: string[]
  /**
   * The media (`''` = the primary) whose captions were put at the top:
   * the lower third is where that take was pressed or typed into.
   */
  raised: string[]
}

/** Where a house caption sits when the lower third is the app's own. */
export const CAPTION_TOP_Y = 0.14
/** Half the height a caption's band is taken to have, as a frame fraction. */
const CAPTION_BAND = 0.07
/** How tall a typed line, or a press on a surface, is taken to be, in the take's points. */
const PRESS_LINE = 44

/**
 * Whether one input's captions belong at the top of the frame: its
 * presses reach the lower third (a chat's composer, a status bar's
 * control) and leave the top alone. One answer per input, so the words do
 * not move about within an app. An input pressed in both bands, or in
 * neither, keeps the lower third.
 *
 * A press is its element, except where the element says little about
 * where the work is: a field that was typed into counts as the line at
 * the press, and so does an element taller than half the window (a
 * terminal's text, a canvas).
 */
export function captionsBelongOnTop(
  doc: ProjectDoc,
  media: string,
  source: ProjectDoc['source'],
  lowerY: number,
): boolean {
  const h = source.meta.height
  if (!(h > 0)) return false
  let layout
  try {
    layout = docCardLayout(doc, media || null)
  } catch {
    return false
  }
  if (!(layout.H > 0) || !(layout.dh > 0)) return false
  const typed = (source.meta.steps ?? []).filter(
    (st) => st.do === 'type' && !st.skipped,
  )
  // A span of the take's height, as a span of the frame's (the card at rest).
  const inFrame = (y0: number, y1: number): [number, number] => [
    (layout.dy + (y0 / h) * layout.dh) / layout.H,
    (layout.dy + (y1 / h) * layout.dh) / layout.H,
  ]
  let lower = false
  let upper = false
  for (const e of source.cursor) {
    if (e.type !== 'down') continue
    const t = e.t / 1000
    const r = e.rect
    const line =
      !r || r.h > h / 2 || typed.some((st) => t >= st.tStart && t <= st.tEnd)
    const [a, b] = line
      ? inFrame(e.y - PRESS_LINE / 2, e.y + PRESS_LINE / 2)
      : inFrame(r.y, r.y + r.h)
    if (a < lowerY + CAPTION_BAND && b > lowerY - CAPTION_BAND) lower = true
    if (a < CAPTION_TOP_Y + CAPTION_BAND && b > CAPTION_TOP_Y - CAPTION_BAND)
      upper = true
  }
  return lower && !upper
}

/**
 * A step's caption: on the step itself, else its actions.json step, else
 * the document's embedded script. `recorded` is the media's recorded steps,
 * which find the script step a recorded one was made from when the script
 * was edited after recording (`scriptStepOf`).
 */
export function captionOf(
  step: StepSpan,
  actions: ActionsFile | null | undefined,
  script: Record<string, unknown> | undefined,
  recorded: readonly StepSpan[] = [],
): string | null {
  const own = (step as { caption?: unknown }).caption
  if (typeof own === 'string' && own.trim()) return own.trim()
  for (const list of [
    actions?.steps,
    Array.isArray(script?.steps) ? (script.steps as unknown[]) : undefined,
  ]) {
    const raw = scriptStepOf(step, list, recorded)
    if (typeof raw?.caption === 'string' && raw.caption.trim())
      return raw.caption.trim()
  }
  return null
}

const safeId = (v: string | number): string =>
  String(v)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'step'

/**
 * Land every step's caption on `doc` as a step-anchored layer. `actions`
 * maps a media key (`''` = the primary, else a `media[].id`) to the
 * actions.json that recorded it. Mutates `doc`; answers what it did.
 */
export function landStepCaptions(
  doc: ProjectDoc,
  actions: ReadonlyMap<string, ActionsFile | null>,
  opts: { only?: ReadonlySet<string> } = {},
): StepCaptionReport {
  const report: StepCaptionReport = {
    landed: [],
    skipped: [],
    held: [],
    uncaptioned: [],
    raised: [],
  }
  // `only` (a re-join): land the captions of these media alone, and keep
  // every other media's step captions as they were edited.
  const mine = (o: OverlayClip) =>
    !opts.only || opts.only.has(mediaKey(o.anchor?.media))
  const kept = (doc.overlays ?? []).filter(
    (o) => o.from !== STEP_CAPTIONS_FROM || !mine(o),
  )
  const rated = ratedSegments(doc)
  const footageEnd = totalDuration(rated)
  // Where each clip of the cut ends, and whose it is: a caption is about
  // its media and never outlives the clip it starts in (after a join, the
  // next clip is someone else's footage).
  const docSegments = (
    doc.segments.length
      ? doc.segments
      : [{ in: 0, out: doc.source.meta.durationMs / 1000 }]
  ) as { media?: string }[]
  const extents = segmentOutputExtents(doc)
  const clipEnd = (start: number, media: string): number => {
    for (let i = 0; i < extents.length; i++) {
      const e = extents[i]
      if (
        mediaKey(docSegments[i]?.media) === media &&
        start >= e.start - 1e-6 &&
        start < e.end - 1e-6
      )
        return e.end
    }
    return footageEnd
  }
  const ends = new Map<OverlayClip, number>()
  const labels = new Map<OverlayClip, string>()
  const untils = new Map<OverlayClip, number>()
  /** Does a caption the run keeps already speak for this step? */
  const spoken = (media: string, step: StepSpan, steps: StepSpan[]) =>
    kept.some((o) => {
      if (o.kind !== 'text' || o.preset !== 'caption') return false
      if (o.anchor && mediaKey(o.anchor.media) === media)
        return findStep(steps, o.anchor.step) === step
      // The plan's own beat caption (`vos plan` on the primary).
      return media === '' && o.id === `${CAPTION_ID_PREFIX}${step.step}`
    })
  const fresh: (OverlayClip & { start: number })[] = []
  const taken = new Set(kept.map((o) => o.id))
  for (const { id: media, source } of docMediaList(doc)) {
    if (opts.only && !opts.only.has(media)) continue
    const steps = source.meta.steps ?? []
    let captioned = 0
    let onTop: boolean | undefined
    for (const step of steps) {
      const caption = captionOf(step, actions.get(media), source.script, steps)
      if (!caption) continue
      captioned++
      const ref = step.id ?? step.step
      const label = `step ${JSON.stringify(ref)}${media ? ` of ${media}` : ''}`
      if (step.skipped) {
        report.skipped.push(`${label}: the recorder skipped it`)
        continue
      }
      if (spoken(media, step, steps)) {
        report.skipped.push(`${label}: a caption is already anchored to it`)
        continue
      }
      const anchor: OverlayAnchor = {
        step: ref,
        ...(media ? { media } : {}),
        at: STEP_CAPTION_AT,
      }
      const placed = resolveAnchor(doc, anchor, rated)
      if (placed.start === null) {
        report.skipped.push(`${label}: the cut leaves it out`)
        continue
      }
      const end = clipEnd(placed.start, media)
      if (placed.start >= end - CAPTION_MIN) {
        report.skipped.push(`${label}: it plays in the last second of its clip`)
        continue
      }
      const base = `step-${media ? `${media}-` : ''}${safeId(ref)}`
      let id = base
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
      taken.add(id)
      const clip: OverlayClip & { start: number } = {
        ...houseCaption(id, caption, placed.start, CAPTION_MAX),
        start: placed.start,
        anchor,
        from: STEP_CAPTIONS_FROM,
      }
      // The lower third is the house place; an input pressed there (and
      // not at the top) has its words at the top instead.
      onTop ??= captionsBelongOnTop(doc, media, source, clip.transform.y)
      if (onTop) {
        clip.transform = { ...clip.transform, y: CAPTION_TOP_Y }
        if (!report.raised.includes(media)) report.raised.push(media)
      }
      ends.set(clip, end)
      // Where the step ends in the cut: the caption leaves with it.
      const stepEnd = resolveAnchor(doc, { ...anchor, at: 'end' }, rated)
      if (stepEnd.start !== null) untils.set(clip, stepEnd.start)
      labels.set(clip, label)
      fresh.push(clip)
      report.landed.push({
        id,
        step: ref,
        ...(media ? { media } : {}),
        start: placed.start,
      })
    }
    if (steps.length && !captioned) report.uncaptioned.push(media)
  }
  // In playing order, each caption leaves when its step ends (or once its
  // words are read), gives way to the next one and ends with the clip it
  // starts in; one that cannot be read before the next is dropped and said,
  // never left on screen beside it.
  const fit = fitCaptions(fresh, (c) => ({
    start: c.start,
    end: ends.get(c) ?? footageEnd,
    ...(untils.has(c) ? { until: untils.get(c) } : {}),
    ...(c.kind === 'text' ? { text: overlayPlainText(c) } : {}),
  }))
  for (const { item, why } of fit.dropped) {
    report.skipped.push(`${labels.get(item) ?? item.id}: ${why}`)
    report.landed = report.landed.filter((l) => l.id !== item.id)
  }
  report.raised = report.raised.filter((m) =>
    report.landed.some((l) => mediaKey(l.media) === m),
  )
  for (const k of fit.kept)
    if (k.held)
      report.held.push(heldLine(labels.get(k.item) ?? k.item.id, k.held))
  const landedClips = fit.kept.map(({ item, duration }) => {
    item.duration = duration
    return item
  })
  const overlays = [...kept, ...landedClips]
  if (overlays.length) doc.overlays = overlays
  else delete doc.overlays
  return report
}

/**
 * `vos plan`'s argv with a bare `--captions` (no value after it) read as
 * `--captions=steps`: land the step captions. `--captions none` keeps its
 * meaning (the plan proposes no captions).
 */
/** What a plan says of captions it put at the top, or '' when it put none there. */
export function raisedLine(report: StepCaptionReport): string {
  if (!report.raised.length) return ''
  const whose = report.raised.map((m) => m || 'this take').join(', ')
  return `captions over ${whose} sit at the top: the lower third is where ${report.raised.length === 1 ? 'that take was' : 'those takes were'} pressed (move one with transform.y)`
}

export function bareCaptionsFlag(argv: readonly string[]): string[] {
  return argv.map((a, i) =>
    a === '--captions' && (i + 1 >= argv.length || argv[i + 1].startsWith('--'))
      ? '--captions=steps'
      : a,
  )
}
