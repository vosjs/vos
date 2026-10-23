/**
 * One zoom per beat (`vos plan --zooms per-beat`, `vos join --zooms
 * per-beat`).
 *
 * The zoom planner proposes a span per gesture, which is right for a form
 * and far too busy for a canvas, where every drag, label and copy is a
 * gesture. The script already says where the beats are: a step that
 * carries a `caption` (the words `--captions` lands) starts one. A beat
 * runs from its captioned step's start until the next captioned step of
 * the same media starts, the last one to the media's end; what plays
 * before the first captioned step is one more beat, the opening.
 *
 * Within a beat, the zoom kept is the one on the beat's ACTION STEP: the
 * captioned step when it acts (ACTING_VERBS: a click, a drag, typing, a
 * paste, a key press), else the first step after it in the beat that
 * acts, since a scene's caption is often written on the wait or the move
 * that opens it. Of the proposals that overlap the action step's own span
 * (`tStart`..`tEnd`), the one that overlaps it most stays (ties: the one
 * the cut plays longest, then the longer, then the higher level, then the
 * earlier). When none overlaps it, or the beat has no acting step, the
 * beat keeps NO zoom: what the planner framed there was the typing or the
 * drag that prepares the payoff, not the payoff, and a person cutting a
 * canvas often wants no zoom in such a beat at all. The opening has no
 * captioned step, so it keeps none either. A span belongs to the beat its
 * midpoint falls in.
 *
 * The others are deleted the way a person deletes a proposal: each
 * becomes a `doc.rejected` entry, so no re-plan proposes it again. The one
 * kept is promoted to `manual`, because a rejected extent can overlap it
 * by half and would otherwise take it too on the next re-plan. A beat that
 * already holds a manual zoom keeps every manual one and loses its
 * proposals. A media none of whose steps carries a caption has no beats:
 * its zooms stay as the planner proposed them, and the report names it.
 * Pure; mutates the document it is handed.
 */
import { docMediaList, mediaKey, rejectSpan } from '@vosjs/studio-core'
import { captionOf } from './stepCaptions'
import type { ProjectDoc, StepSpan, ZoomSpan } from '@vosjs/studio-core'
import type { ActionsFile } from './actions'

/** The note a per-beat rejection carries. */
export const PER_BEAT_NOTE = 'one zoom per beat'

/** The values `--zooms` takes. */
export const ZOOM_MODES = ['per-beat'] as const
export type ZoomMode = (typeof ZOOM_MODES)[number]

/** `--zooms <mode>`, read: null when absent, a usage message when unknown. */
export function zoomModeOf(
  raw: string | undefined,
): ZoomMode | null | { error: string } {
  if (raw === undefined) return null
  if ((ZOOM_MODES as readonly string[]).includes(raw)) return raw as ZoomMode
  return {
    error: `--zooms expects ${ZOOM_MODES.join(' or ')}, got "${raw}"`,
  }
}

/** The verbs that act on the page: a beat's action step is one of these. */
export const ACTING_VERBS: readonly string[] = [
  'click',
  'drag',
  'type',
  'paste',
  'press',
]

/** One beat of one media, in that media's SOURCE seconds. */
export interface Beat {
  /** The media key (`''` = the primary). */
  media: string
  /** The captioned step that starts it (its id, else its index); null for the opening. */
  step: string | number | null
  caption: string | null
  in: number
  out: number
  /**
   * The beat's action step (the captioned step when it acts, else the first
   * acting step after it in the beat) and its own span; absent for the
   * opening and for a beat with no acting step.
   */
  action?: { in: number; out: number; step: number; do: string }
}

/**
 * A media's beats: one per captioned step, plus the opening before the
 * first. Empty when no step carries a caption.
 */
export function mediaBeats(
  media: string,
  source: ProjectDoc['source'],
  actions: ActionsFile | null | undefined,
): Beat[] {
  const end = (source.meta.durationMs || 0) / 1000
  const starts: { step: StepSpan; caption: string }[] = []
  for (const step of source.meta.steps ?? []) {
    if (typeof step.tStart !== 'number') continue
    const caption = captionOf(step, actions, source.script)
    if (caption) starts.push({ step, caption })
  }
  if (!starts.length) return []
  starts.sort((a, b) => a.step.tStart - b.step.tStart)
  const beats: Beat[] = []
  if (starts[0].step.tStart > 0)
    beats.push({
      media,
      step: null,
      caption: null,
      in: 0,
      out: starts[0].step.tStart,
    })
  const ordered = [...(source.meta.steps ?? [])]
    .filter((s) => typeof s.tStart === 'number' && !s.skipped)
    .sort((a, b) => a.tStart - b.tStart || a.step - b.step)
  starts.forEach(({ step, caption }, i) => {
    const next = starts[i + 1]
    const out = next ? next.step.tStart : Math.max(end, step.tStart)
    const acting = ACTING_VERBS.includes(step.do)
      ? step
      : ordered.find(
          (s) =>
            ACTING_VERBS.includes(s.do) &&
            s.tStart >= step.tStart &&
            (s.tStart < out || !next) &&
            s !== step,
        )
    beats.push({
      media,
      step: step.id ?? step.step,
      caption,
      in: step.tStart,
      out,
      ...(acting
        ? {
            action: {
              in: acting.tStart,
              out: Math.max(acting.tStart, acting.tEnd),
              step: acting.step,
              do: acting.do,
            },
          }
        : {}),
    })
  })
  return beats
}

/** The source seconds of a span that the cut keeps, on its own media. */
export function playedSeconds(doc: ProjectDoc, z: ZoomSpan): number {
  const key = mediaKey(z.media)
  const segments = doc.segments.length
    ? doc.segments
    : [{ in: 0, out: doc.source.meta.durationMs / 1000 }]
  let played = 0
  for (const s of segments) {
    if (mediaKey((s as { media?: string }).media) !== key) continue
    played += Math.max(0, Math.min(s.out, z.out) - Math.max(s.in, z.in))
  }
  return played
}

/** Milliseconds, so two spans of one length never part on float noise. */
const ms = (v: number): number => Math.round(v * 1000)

/**
 * How much of a beat's action a span covers, seconds; an instant action
 * (an `expect`) inside the span counts as covered, by a hair.
 */
export function actionOverlap(
  z: ZoomSpan,
  action: { in: number; out: number } | undefined,
): number {
  if (!action) return 0
  const shared = Math.min(z.out, action.out) - Math.max(z.in, action.in)
  if (shared > 0) return shared
  return action.out - action.in < 1e-3 &&
    z.in <= action.in &&
    action.in <= z.out
    ? 1e-6
    : 0
}

/** Among the proposals on the action: played longest, then longest, then higher, then earlier. */
function stronger(doc: ProjectDoc) {
  return (a: ZoomSpan, b: ZoomSpan): number =>
    ms(playedSeconds(doc, b)) - ms(playedSeconds(doc, a)) ||
    ms(b.out - b.in) - ms(a.out - a.in) ||
    b.level - a.level ||
    a.in - b.in
}

/** A beat as the report names it: its caption and its action step. */
export interface BeatWords {
  media: string
  step: string | number | null
  caption: string | null
  /** The action step's index and verb; absent for the opening and a beat with none. */
  action?: { step: number; do: string }
}

export interface PerBeatReport {
  /** Beats that kept one proposal: the beat, the span kept. */
  kept: (BeatWords & { id: string })[]
  /** Beats none of whose proposals is on the action step (or with no action step): every one was rejected. */
  none: (BeatWords & { ids: string[] })[]
  /** Beats that hold a manual zoom already; their proposals were rejected. */
  manual: { media: string; step: string | number | null; ids: string[] }[]
  /** How many proposals went into `doc.rejected`. */
  rejected: number
  /** Media keys whose steps carry no caption: their zooms are untouched. */
  uncaptioned: string[]
  /** How many beats held a zoom, over every media looked at. */
  beats: number
}

/**
 * Keep at most one zoom per beat on every media (or only on `only`, the
 * media keys a join just added). `actions` maps a media key to the
 * actions.json that recorded it; a media's embedded script is read when it
 * has none.
 */
export function oneZoomPerBeat(
  doc: ProjectDoc,
  actions: ReadonlyMap<string, ActionsFile | null>,
  opts: { only?: ReadonlySet<string> } = {},
): PerBeatReport {
  const report: PerBeatReport = {
    kept: [],
    none: [],
    manual: [],
    rejected: 0,
    uncaptioned: [],
    beats: 0,
  }
  const drop = new Set<ZoomSpan>()
  const order = stronger(doc)
  for (const { id: media, source } of docMediaList(doc)) {
    if (opts.only && !opts.only.has(media)) continue
    const beats = mediaBeats(media, source, actions.get(media))
    const spans = doc.zoom.filter((z) => mediaKey(z.media) === media)
    if (!beats.length) {
      if (spans.length) report.uncaptioned.push(media)
      continue
    }
    for (const beat of beats) {
      const inBeat = spans.filter((z) => {
        const mid = (z.in + z.out) / 2
        return mid >= beat.in && mid < beat.out
      })
      if (inBeat.length) report.beats++
      const manual = inBeat.filter((z) => z.source === 'manual')
      const auto = inBeat.filter((z) => z.source !== 'manual')
      if (!auto.length) continue
      if (manual.length) {
        for (const z of auto) drop.add(z)
        report.manual.push({
          media,
          step: beat.step,
          ids: manual.map((z) => z.id),
        })
        continue
      }
      const words: BeatWords = {
        media,
        step: beat.step,
        caption: beat.caption,
        ...(beat.action
          ? { action: { step: beat.action.step, do: beat.action.do } }
          : {}),
      }
      const onAction = auto.filter((z) => actionOverlap(z, beat.action) > 0)
      if (!onAction.length) {
        for (const z of auto) drop.add(z)
        report.none.push({ ...words, ids: auto.map((z) => z.id) })
        continue
      }
      const [best] = [...onAction].sort(
        (a, b) =>
          ms(actionOverlap(b, beat.action)) -
            ms(actionOverlap(a, beat.action)) || order(a, b),
      )
      best.source = 'manual'
      for (const z of auto) if (z !== best) drop.add(z)
      report.kept.push({ ...words, id: best.id })
    }
  }
  if (!drop.size) return report
  const rejected = [...(doc.rejected ?? [])]
  for (const z of doc.zoom) {
    if (!drop.has(z)) continue
    const entry = rejectSpan(rejected, 'zoom', z, PER_BEAT_NOTE)
    if (z.media) entry.media = z.media
    rejected.push(entry)
  }
  doc.rejected = rejected
  doc.zoom = doc.zoom.filter((z) => !drop.has(z))
  report.rejected = drop.size
  return report
}

/** The report in words, one line, for a done line. */
export function perBeatLine(
  r: PerBeatReport,
  name: (media: string) => string = (m) => (m ? `media ${m}` : 'the primary'),
): string {
  const parts = [
    `one zoom per beat: ${r.beats} beat${r.beats === 1 ? '' : 's'} held zooms, ${r.kept.length} proposal${r.kept.length === 1 ? '' : 's'} on a beat's action kept (now manual), ${r.rejected} rejected into doc.rejected (no re-plan brings them back)`,
  ]
  // Each beat that held proposals: the ones that kept a zoom, then the rest.
  const said = [
    ...r.kept.map((b) => ({ b, end: `kept ${b.id}` })),
    ...r.none.map((b) => ({
      b,
      end:
        b.step === null
          ? 'no zoom'
          : b.action
            ? 'no zoom on it'
            : 'no acting step, no zoom',
    })),
  ]
  for (const { b, end } of said) {
    const beat =
      b.step === null
        ? `the opening${b.media ? ` of ${name(b.media)}` : ''}`
        : `beat ${b.caption ? JSON.stringify(b.caption) : String(b.step)}${b.media ? ` (${name(b.media)})` : ''}`
    parts.push(
      `${beat}: ${b.action ? `action #${b.action.step} ${b.action.do}, ` : ''}${end}`,
    )
  }
  if (r.manual.length)
    parts.push(
      `${r.manual.length} beat${r.manual.length === 1 ? '' : 's'} kept ${r.manual.length === 1 ? 'its' : 'their'} manual zoom${r.manual.some((m) => m.ids.length > 1) ? 's' : ''}`,
    )
  if (r.uncaptioned.length)
    parts.push(
      `no captioned step in ${r.uncaptioned.map(name).join(', ')}, so ${r.uncaptioned.length === 1 ? 'its' : 'their'} zooms stay as planned`,
    )
  return parts.join('; ')
}
