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
  docMediaList,
  findStep,
  mediaKey,
  ratedSegments,
  resolveAnchor,
} from '@vosjs/studio-core'
import { totalDuration } from '@vosjs/timeline'
import { CAPTION_ID_PREFIX, houseCaption } from './motionPlan'
import type {
  OverlayAnchor,
  OverlayClip,
  ProjectDoc,
  StepSpan,
} from '@vosjs/studio-core'
import type { ActionsFile } from './actions'

/** The provenance a landed step caption carries. */
export const STEP_CAPTIONS_FROM = 'steps'

/** A step caption lands this long after its gesture ends (the response has shown). */
export const STEP_CAPTION_OFFSET = 0.2

/** The longest a step caption stays, and the shortest it is cut to by the next one. */
const CAPTION_MAX = 3
const CAPTION_MIN = 1.2
/** The air between one caption's end and the next one's start. */
const CAPTION_GAP = 0.1

export interface StepCaptionReport {
  /** Captions landed (each `media` absent = the primary). */
  landed: { id: string; step: string | number; media?: string; start: number }[]
  /** Steps with a caption that did not land, in words. */
  skipped: string[]
}

/** A step's caption: on the step itself, else its actions.json step, else the document's embedded script. */
function captionOf(
  step: StepSpan,
  actions: ActionsFile | null | undefined,
  script: Record<string, unknown> | undefined,
): string | null {
  const own = (step as { caption?: unknown }).caption
  if (typeof own === 'string' && own.trim()) return own.trim()
  for (const list of [
    actions?.steps,
    Array.isArray(script?.steps) ? (script.steps as unknown[]) : undefined,
  ]) {
    if (!Array.isArray(list)) continue
    const byId =
      step.id !== undefined
        ? list.find((s) => (s as { id?: unknown })?.id === step.id)
        : undefined
    const raw = (byId ?? list[step.step]) as { caption?: unknown } | undefined
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
): StepCaptionReport {
  const report: StepCaptionReport = { landed: [], skipped: [] }
  const kept = (doc.overlays ?? []).filter((o) => o.from !== STEP_CAPTIONS_FROM)
  const rated = ratedSegments(doc)
  const footageEnd = totalDuration(rated)
  /** Does a caption the run keeps already speak for this step? */
  const spoken = (media: string, step: StepSpan, steps: StepSpan[]) =>
    kept.some((o) => {
      if (o.kind !== 'text' || o.preset !== 'caption') return false
      if (o.anchor && mediaKey(o.anchor.media) === media)
        return findStep(steps, o.anchor.step) === step
      // The plan's own beat caption (`vos plan` on the primary).
      return media === '' && o.id === `${CAPTION_ID_PREFIX}${step.step}`
    })
  const fresh: OverlayClip[] = []
  const taken = new Set(kept.map((o) => o.id))
  for (const { id: media, source } of docMediaList(doc)) {
    const steps = source.meta.steps ?? []
    for (const step of steps) {
      const caption = captionOf(step, actions.get(media), source.script)
      if (!caption) continue
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
        at: 'end',
        offset: STEP_CAPTION_OFFSET,
      }
      const placed = resolveAnchor(doc, anchor, rated)
      if (placed.start === null) {
        report.skipped.push(`${label}: the cut leaves it out`)
        continue
      }
      if (placed.start >= footageEnd - CAPTION_MIN) {
        report.skipped.push(
          `${label}: it plays in the last second of the footage`,
        )
        continue
      }
      const base = `step-${media ? `${media}-` : ''}${safeId(ref)}`
      let id = base
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
      taken.add(id)
      fresh.push({
        ...houseCaption(id, caption, placed.start, CAPTION_MAX),
        anchor,
        from: STEP_CAPTIONS_FROM,
      })
      report.landed.push({
        id,
        step: ref,
        ...(media ? { media } : {}),
        start: placed.start,
      })
    }
  }
  // In playing order, each caption gives way to the next one and to the
  // end of the footage.
  fresh.sort((a, b) => a.start - b.start)
  fresh.forEach((c, i) => {
    const next = fresh[i + 1]
    const room = Math.min(
      next ? next.start - CAPTION_GAP : Infinity,
      footageEnd,
    )
    c.duration = +Math.max(
      CAPTION_MIN,
      Math.min(CAPTION_MAX, room - c.start),
    ).toFixed(3)
  })
  const overlays = [...kept, ...fresh]
  if (overlays.length) doc.overlays = overlays
  else delete doc.overlays
  return report
}

/**
 * `vos plan`'s argv with a bare `--captions` (no value after it) read as
 * `--captions=steps`: land the step captions. `--captions none` keeps its
 * meaning (the plan proposes no captions).
 */
export function bareCaptionsFlag(argv: readonly string[]): string[] {
  return argv.map((a, i) =>
    a === '--captions' && (i + 1 >= argv.length || argv[i + 1].startsWith('--'))
      ? '--captions=steps'
      : a,
  )
}
