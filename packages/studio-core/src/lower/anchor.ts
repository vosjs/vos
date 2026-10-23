/**
 * Layers anchored to a recorder step: a caption that starts where its step
 * plays in the cut.
 *
 * A layer is OUTPUT-anchored (a title at 1 s stays at 1 s through every
 * trim), which is right for a title and wrong for a caption about a step:
 * the step moves whenever the footage before it is trimmed, sped up or
 * re-recorded, and a hand-written `start` stays behind. An `anchor` names
 * the step instead. Here its moment (the step's edge in `meta.steps`, in
 * its media's SOURCE seconds) is mapped through the rated pieces, the same
 * list every source-anchored span is mapped through, and the anchor's
 * `offset` (OUTPUT seconds) is added. The clip's own `start` is the
 * fallback when the step cannot be found or the cut leaves it out; an
 * anchored layer may carry none, and then one whose step does not resolve
 * plays nowhere (the lowering drops it, validate refuses it).
 *
 * A text layer's `{elapsed}` fills with the anchored step's off-camera
 * wait, when the recorder kept one (the entry of `meta.skips` that names
 * it, or `offCameraMs` on the step), else the nearest earlier step's on the
 * same media (the beat after an await waited for nothing itself), as a
 * rounded human duration.
 *
 * On a cut that replays the step's seconds, the layer starts in the pass
 * where the step plays the longest (`stepMomentToOutput`).
 *
 * Pure: the caller hands in the rated pieces (`ratedSegments(doc)`), so the
 * lowering, the lint and the CLI read one map.
 */
import { segmentRate } from '@vosjs/timeline'
import { mediaSource, sameMedia } from '../media'
import { findStep } from './pin'
import { hasReplay, longestOutputExtent, momentOutputs } from './occurrences'
import type { Segment } from '@vosjs/timeline'
import type { RichText } from '@vosjs/elements/text'
import type {
  OverlayAnchor,
  OverlayClip,
  ProjectDoc,
  RecordingMeta,
  StepSpan,
} from '../types'

/** The placeholder a text layer's words may carry. */
export const ELAPSED_PLACEHOLDER = '{elapsed}'

const EPS = 1e-9

/**
 * Where a SOURCE moment of one media plays in the cut: the output second of
 * the first rated piece of that media that holds it, null when the cut
 * leaves it out. A moment on a piece's closing edge counts as held there
 * (the last frame of a clip is still that clip). On a cut that plays the
 * moment more than once this is its FIRST occurrence; a step's moment is
 * read through `stepMomentToOutput`, which takes the step's longest pass.
 */
export function sourceMomentToOutput(
  rated: readonly (Segment & { media?: string })[],
  t: number,
  media?: string,
): number | null {
  if (!Number.isFinite(t)) return null
  let acc = 0
  let edge: number | null = null
  for (const p of rated) {
    const rate = segmentRate(p)
    const len = Math.max(0, p.out - p.in) / rate
    if (sameMedia(p.media, media)) {
      if (t >= p.in - EPS && t < p.out - EPS)
        return acc + Math.max(0, t - p.in) / rate
      if (edge === null && Math.abs(t - p.out) <= 1e-6) edge = acc + len
    }
    acc += len
  }
  return edge
}

/**
 * Where a step's moment (its start, or its end with `at: 'end'`) plays in
 * the cut: in the PASS where the step plays the longest
 * (`longestOutputExtent`; the first on a tie), so a caption about a step
 * lands in the main play, not in a short cold open of the same seconds.
 * Null when the cut leaves the moment out. A cut with no replay plays each
 * moment once, and this is `sourceMomentToOutput`.
 */
export function stepMomentToOutput(
  rated: readonly (Segment & { media?: string })[],
  step: Pick<StepSpan, 'tStart' | 'tEnd'>,
  at: 'start' | 'end' | undefined,
  media?: string,
): number | null {
  const moment = at === 'end' ? step.tEnd : step.tStart
  const first = sourceMomentToOutput(rated, moment, media)
  if (first === null || !hasReplay(rated)) return first
  const pass = longestOutputExtent(rated, step.tStart, step.tEnd, media)
  if (!pass) return first
  return (
    momentOutputs(rated, moment, media).find(
      (o) => o >= pass.start - 1e-6 && o <= pass.end + 1e-6,
    ) ?? first
  )
}

/** Why an anchor did not resolve. */
export type AnchorMiss = 'media' | 'step' | 'skipped' | 'cut'

export interface AnchorResolution {
  /** OUTPUT seconds the layer starts at; null when the anchor did not resolve. */
  start: number | null
  /** The step it names, when found. */
  step?: StepSpan
  /** Why it did not resolve. */
  miss?: AnchorMiss
  /**
   * The off-camera wait `{elapsed}` fills with, in ms: the step's own, else
   * the nearest earlier step's on the same media (see `elapsedFrom`).
   */
  elapsedMs?: number
  /**
   * Set when the wait is an EARLIER step's: the step after an await is the
   * natural place for "12 minutes later", and that step waited for nothing.
   */
  elapsedFrom?: StepSpan
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/**
 * The off-camera wait the recorder kept for a step: the entry of
 * `meta.skips` that names the step (by its id or its index) with an `ms`,
 * else `offCameraMs` on the step itself. A step's own `ms` is never read:
 * in a script it is a reading time, not a wait. Read defensively: an older
 * take carries neither.
 */
export function stepElapsedMs(
  meta: Pick<RecordingMeta, 'steps'> & { skips?: unknown },
  step: StepSpan,
): number | null {
  const skips = Array.isArray(meta.skips) ? (meta.skips as unknown[]) : []
  for (const raw of skips) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as { step?: unknown; id?: unknown; ms?: unknown }
    if (!isNum(s.ms) || s.ms < 0) continue
    const named =
      (step.id !== undefined && (s.id === step.id || s.step === step.id)) ||
      s.step === step.step
    if (named) return s.ms
  }
  const own = (step as { offCameraMs?: unknown }).offCameraMs
  return isNum(own) && own >= 0 ? own : null
}

/**
 * The wait `{elapsed}` speaks of for a step: its own, else the nearest
 * earlier step's (by script order) on the same media, so a caption on the
 * beat that lands after an await reads that await. Null with none at all.
 */
export function elapsedFor(
  meta: Pick<RecordingMeta, 'steps'> & { skips?: unknown },
  step: StepSpan,
): { ms: number; from?: StepSpan } | null {
  const own = stepElapsedMs(meta, step)
  if (own !== null) return { ms: own }
  const earlier = (meta.steps ?? [])
    .filter((s) => s !== step && s.step < step.step)
    .sort((a, b) => b.step - a.step)
  for (const s of earlier) {
    const ms = stepElapsedMs(meta, s)
    if (ms !== null) return { ms, from: s }
  }
  return null
}

/** Resolve one anchor against the document and its rated pieces. */
export function resolveAnchor(
  doc: Pick<ProjectDoc, 'source' | 'media'>,
  anchor: OverlayAnchor,
  rated: readonly (Segment & { media?: string })[],
): AnchorResolution {
  const source = mediaSource(doc, anchor.media)
  if (!source) return { start: null, miss: 'media' }
  const meta = source.meta as RecordingMeta & { skips?: unknown }
  const step = findStep(meta.steps ?? [], anchor.step)
  if (!step) return { start: null, miss: 'step' }
  const elapsed = elapsedFor(meta, step)
  const extra = elapsed
    ? {
        elapsedMs: elapsed.ms,
        ...(elapsed.from ? { elapsedFrom: elapsed.from } : {}),
      }
    : {}
  if (step.skipped) return { start: null, step, miss: 'skipped', ...extra }
  const out = stepMomentToOutput(rated, step, anchor.at, anchor.media)
  if (out === null) return { start: null, step, miss: 'cut', ...extra }
  const offset = isNum(anchor.offset) ? anchor.offset : 0
  return { start: round3(Math.max(0, out + offset)), step, ...extra }
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * A wait as a person says it: "40 seconds", "12 minutes", "2 hours",
 * "3 days". Rounded to the unit that reads: whole seconds under ten,
 * fives under a minute, whole minutes under an hour, whole hours under two
 * days.
 */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000
  const plural = (n: number, unit: string) =>
    `${n} ${unit}${n === 1 ? '' : 's'}`
  if (s < 9.5) return plural(Math.max(1, Math.round(s)), 'second')
  if (s < 57.5) return plural(Math.round(s / 5) * 5, 'second')
  const m = s / 60
  if (m < 59.5) return plural(Math.max(1, Math.round(m)), 'minute')
  const h = m / 60
  if (h < 47.5) return plural(Math.max(1, Math.round(h)), 'hour')
  return plural(Math.round(h / 24), 'day')
}

/** Does a layer's text carry the `{elapsed}` placeholder? */
export function hasElapsed(text: RichText | undefined): boolean {
  if (typeof text === 'string') return text.includes(ELAPSED_PLACEHOLDER)
  return (
    Array.isArray(text) &&
    text.some(
      (r) =>
        typeof r?.text === 'string' && r.text.includes(ELAPSED_PLACEHOLDER),
    )
  )
}

function fillElapsed(text: RichText, words: string): RichText {
  const fill = (s: string) => s.split(ELAPSED_PLACEHOLDER).join(words)
  if (typeof text === 'string') return fill(text)
  return text.map((r) =>
    typeof r.text === 'string' && r.text.includes(ELAPSED_PLACEHOLDER)
      ? { ...r, text: fill(r.text) }
      : r,
  )
}

/** One anchored layer as it plays: its start resolved, its `{elapsed}` filled. */
export function anchoredClip<C extends OverlayClip>(
  clip: C,
  doc: Pick<ProjectDoc, 'source' | 'media'>,
  rated: readonly (Segment & { media?: string })[],
): C {
  if (!clip.anchor || typeof clip.anchor !== 'object') return clip
  const r = resolveAnchor(doc, clip.anchor, rated)
  let next: C = clip
  if (r.start !== null && r.start !== clip.start)
    next = { ...next, start: r.start }
  if (
    next.kind === 'text' &&
    r.elapsedMs !== undefined &&
    hasElapsed(next.text)
  ) {
    next = { ...next, text: fillElapsed(next.text, formatElapsed(r.elapsedMs)) }
  }
  return next
}

/**
 * Where a layer starts as the document stands (OUTPUT seconds): where its
 * anchor's step plays when it resolves, else its own `start`; null for an
 * anchored layer that resolves nowhere and carries no `start`.
 */
export function layerStart(
  clip: OverlayClip,
  doc: Pick<ProjectDoc, 'source' | 'media'>,
  rated: readonly (Segment & { media?: string })[],
): number | null {
  const own = isNum(clip.start) ? clip.start : null
  if (!clip.anchor || typeof clip.anchor !== 'object' || !doc.source) return own
  return resolveAnchor(doc, clip.anchor, rated).start ?? own
}

/**
 * The document without the layers that have no `start` (an anchored layer
 * whose step resolved nowhere): the same object when every layer has one.
 */
export function placedOverlays<D extends { overlays?: OverlayClip[] }>(
  doc: D,
): D {
  const overlays = Array.isArray(doc.overlays) ? doc.overlays : []
  if (overlays.every((o) => !o || isNum(o.start))) return doc
  return { ...doc, overlays: overlays.filter((o) => !o || isNum(o.start)) }
}

/**
 * The document with every anchored layer resolved (its `start` where its
 * step plays, its `{elapsed}` filled), and every anchored layer that has
 * no `start` and whose step does not resolve left out: it has no time to
 * play at. A document with no anchored layer is returned as it is, the
 * same object, so its lowering is byte-identical.
 */
export function resolveOverlayAnchors<
  D extends Pick<ProjectDoc, 'source' | 'media' | 'overlays'>,
>(doc: D, rated: readonly (Segment & { media?: string })[]): D {
  const overlays = Array.isArray(doc.overlays) ? doc.overlays : []
  if (!overlays.some((o) => o && o.anchor)) return doc
  return {
    ...doc,
    overlays: overlays.flatMap((o) => {
      if (!o || !o.anchor) return [o]
      const next = doc.source ? anchoredClip(o, doc, rated) : o
      return isNum(next.start) ? [next] : []
    }),
  }
}
