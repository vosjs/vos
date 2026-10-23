/**
 * One zoom per beat (`vos plan --zooms per-beat`, `vos join --zooms
 * per-beat`), and the script's `zoom` marks (`applyZoomMarks`).
 *
 * The zoom planner proposes a span per gesture, which is right for a form
 * and far too busy for a canvas, where every drag, label and copy is a
 * gesture. The script already says where the beats are: a step that
 * carries a `caption` (the words `--captions` lands) starts one. A beat
 * runs from its captioned step's start until the next captioned step of
 * the same media starts, the last one to the media's end; what plays
 * before the first captioned step is one more beat, the opening.
 *
 * Which zoom a beat keeps is the SCRIPT's to say, because no rule read off
 * the steps finds the payoff a person picks (it is sometimes the first
 * gesture, sometimes the last, sometimes the typing between): a step
 * marked `"zoom": true` is a beat's payoff. A beat keeps, for each marked
 * step, the proposal that overlaps it most (ties: the one the cut plays
 * longest, then the longer, then the higher level, then the earlier),
 * never two that overlap; a beat with no marked step keeps NO zoom. When
 * no step of the take is marked at all, each beat's LAST gesture (a
 * click, a drag, typing or a paste; never a key press, which closes a beat
 * more often than it pays it off) stands in for the mark, the opening
 * keeps none, and the report says so. A step marked `"zoom": false` is
 * never zoomed on, in either case. A mark never invents a zoom: a marked
 * step the planner proposed nothing for is named.
 *
 * A span belongs to the beat its midpoint falls in. The others are
 * deleted the way a person deletes a proposal: each becomes a
 * `doc.rejected` entry, so no re-plan proposes it again. The one kept is
 * promoted to `manual`, because a rejected extent can overlap it by half
 * and would otherwise take it too on the next re-plan. A beat that already
 * holds a manual zoom keeps every manual one and loses its proposals. A
 * media none of whose steps carries a caption has no beats: its zooms stay
 * as the planner proposed them, and the report names it.
 *
 * A mark is read from the take's actions.json first (edited after the
 * recording, it takes effect on the next plan, no re-record), then from
 * the step the recorder kept (`meta.steps[].zoom`), then from the script a
 * pushed or joined take carries (`script`). Pure; mutates the document it
 * is handed.
 */
import { docMediaList, mediaKey, rejectSpan } from '@vosjs/studio-core'
import { scriptStepOf } from './scriptStep'
import { captionOf } from './stepCaptions'
import type { ProjectDoc, StepSpan, ZoomSpan } from '@vosjs/studio-core'
import type { ActionsFile } from './actions'

/** The note a per-beat rejection carries. */
export const PER_BEAT_NOTE = 'one zoom per beat'

/** The note a rejection carries when the script says never to zoom on a step. */
export const ZOOM_FALSE_NOTE = 'zoom: false in the script'

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

/** The gestures a beat's last one is read from when the script marks none: no key press. */
export const LAST_GESTURE_VERBS: readonly string[] = [
  'click',
  'drag',
  'type',
  'paste',
]

/** A step of one media as a beat names it: its index, id, verb and own span. */
export interface BeatStep {
  step: number
  id?: string
  do: string
  in: number
  out: number
}

/** One beat of one media, in that media's SOURCE seconds. */
export interface Beat {
  /** The media key (`''` = the primary). */
  media: string
  /** The captioned step that starts it (its id, else its index); null for the opening. */
  step: string | number | null
  caption: string | null
  in: number
  out: number
  /** Its steps marked `"zoom": true`, in order. */
  marked: BeatStep[]
  /** Its last click, drag, typing or paste not marked `"zoom": false`: the stand-in when the take marks nothing. */
  lastGesture?: BeatStep
}

/** The script's `zoom` mark on a recorded step: actions.json, then the step, then the carried script. */
export function zoomMarkOf(
  step: StepSpan,
  actions: ActionsFile | null | undefined,
  script: Record<string, unknown> | undefined,
  recorded: readonly StepSpan[] = [],
): boolean | undefined {
  const inList = (list: unknown): boolean | undefined => {
    const raw = scriptStepOf(step, list, recorded)
    return typeof raw?.zoom === 'boolean' ? raw.zoom : undefined
  }
  return (
    inList(actions?.steps) ??
    (typeof step.zoom === 'boolean' ? step.zoom : undefined) ??
    inList(script?.steps)
  )
}

const beatStep = (s: StepSpan): BeatStep => ({
  step: s.step,
  ...(s.id ? { id: s.id } : {}),
  do: s.do,
  in: s.tStart,
  out: Math.max(s.tStart, s.tEnd),
})

/** A media's steps that ran, in time order, each with its `zoom` mark. */
function markedSteps(
  source: ProjectDoc['source'],
  actions: ActionsFile | null | undefined,
): { s: StepSpan; mark: boolean | undefined }[] {
  return [...(source.meta.steps ?? [])]
    .filter((s) => typeof s.tStart === 'number' && !s.skipped)
    .sort((a, b) => a.tStart - b.tStart || a.step - b.step)
    .map((s) => ({
      s,
      mark: zoomMarkOf(s, actions, source.script, source.meta.steps ?? []),
    }))
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
    const caption = captionOf(
      step,
      actions,
      source.script,
      source.meta.steps ?? [],
    )
    if (caption) starts.push({ step, caption })
  }
  if (!starts.length) return []
  starts.sort((a, b) => a.step.tStart - b.step.tStart)
  const steps = markedSteps(source, actions)
  const beat = (
    step: string | number | null,
    caption: string | null,
    from: number,
    to: number,
    last: boolean,
  ): Beat => {
    const mine = steps.filter(
      (x) => x.s.tStart >= from && (x.s.tStart < to || last),
    )
    const gesture = mine
      .filter((x) => LAST_GESTURE_VERBS.includes(x.s.do) && x.mark !== false)
      .at(-1)
    return {
      media,
      step,
      caption,
      in: from,
      out: to,
      marked: mine.filter((x) => x.mark === true).map((x) => beatStep(x.s)),
      ...(gesture ? { lastGesture: beatStep(gesture.s) } : {}),
    }
  }
  const beats: Beat[] = []
  if (starts[0].step.tStart > 0)
    beats.push(beat(null, null, 0, starts[0].step.tStart, false))
  starts.forEach(({ step, caption }, i) => {
    const next = starts[i + 1]
    beats.push(
      beat(
        step.id ?? step.step,
        caption,
        step.tStart,
        next ? next.step.tStart : Math.max(end, step.tStart),
        !next,
      ),
    )
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
 * How much of a step a span covers, seconds; an instant step (an
 * `expect`) inside the span counts as covered, by a hair.
 */
export function stepOverlap(
  z: { in: number; out: number },
  step: { in: number; out: number } | undefined,
): number {
  if (!step) return 0
  const shared = Math.min(z.out, step.out) - Math.max(z.in, step.in)
  if (shared > 0) return shared
  return step.out - step.in < 1e-3 && z.in <= step.in && step.in <= z.out
    ? 1e-6
    : 0
}

/** A span is ON a step when they share more than half of the shorter of the two. */
export function onStep(
  z: { in: number; out: number },
  step: { in: number; out: number },
): boolean {
  const shorter = Math.min(z.out - z.in, step.out - step.in)
  return shorter > 0
    ? stepOverlap(z, step) > shorter / 2
    : stepOverlap(z, step) > 0
}

/** Among the proposals on a step: played longest, then longest, then higher, then earlier. */
function stronger(doc: ProjectDoc) {
  return (a: ZoomSpan, b: ZoomSpan): number =>
    ms(playedSeconds(doc, b)) - ms(playedSeconds(doc, a)) ||
    ms(b.out - b.in) - ms(a.out - a.in) ||
    b.level - a.level ||
    a.in - b.in
}

const overlaps = (a: ZoomSpan, b: ZoomSpan) => a.in < b.out && b.in < a.out

/** A beat as the report names it: its caption. */
export interface BeatWords {
  media: string
  step: string | number | null
  caption: string | null
}

/** A step a beat zoomed on, or meant to: its index and verb. */
export interface BeatTarget {
  step: number
  do: string
}

export interface PerBeatReport {
  /** No step of the take carries `"zoom": true`: each beat's last gesture stood in. */
  fallback: boolean
  /** One per kept zoom: the beat, the step it is on, the span. */
  kept: (BeatWords & { action: BeatTarget; id: string })[]
  /**
   * Beats, or marked steps, that kept nothing: no step marked (`unmarked`),
   * the opening under the fallback (`opening`), no gesture to stand in
   * (`no-gesture`), or a marked step with no proposal on it (`no-proposal`).
   */
  none: (BeatWords & {
    why: 'unmarked' | 'opening' | 'no-gesture' | 'no-proposal'
    action?: BeatTarget
    ids: string[]
  })[]
  /** Beats that hold a manual zoom already; their proposals were rejected. */
  manual: { media: string; step: string | number | null; ids: string[] }[]
  /** How many proposals went into `doc.rejected`. */
  rejected: number
  /** Media keys whose steps carry no caption: their zooms are untouched. */
  uncaptioned: string[]
  /** How many beats held a zoom, over every media looked at. */
  beats: number
}

/** Whether any step of the document's media carries `"zoom": true`. */
export function takeMarksZoom(
  doc: ProjectDoc,
  actions: ReadonlyMap<string, ActionsFile | null>,
): boolean {
  return docMediaList(doc).some(({ id, source }) =>
    markedSteps(source, actions.get(id)).some((x) => x.mark === true),
  )
}

/** Reject a set of zooms into `doc.rejected` with a note; returns how many. */
function rejectAll(doc: ProjectDoc, drop: Set<ZoomSpan>, note: string): number {
  if (!drop.size) return 0
  const rejected = [...(doc.rejected ?? [])]
  for (const z of doc.zoom) {
    if (!drop.has(z)) continue
    const entry = rejectSpan(rejected, 'zoom', z, note)
    if (z.media) entry.media = z.media
    rejected.push(entry)
  }
  doc.rejected = rejected
  doc.zoom = doc.zoom.filter((z) => !drop.has(z))
  return drop.size
}

/**
 * Keep at most one zoom per marked step of each beat on every media (or
 * only on `only`, the media keys a join just added). `actions` maps a
 * media key to the actions.json that recorded it; a media's embedded
 * script is read when it has none.
 */
export function oneZoomPerBeat(
  doc: ProjectDoc,
  actions: ReadonlyMap<string, ActionsFile | null>,
  opts: { only?: ReadonlySet<string> } = {},
): PerBeatReport {
  const fallback = !takeMarksZoom(doc, actions)
  const report: PerBeatReport = {
    fallback,
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
    // Never zoom on a step marked so.
    const never = markedSteps(source, actions.get(media))
      .filter((x) => x.mark === false)
      .map((x) => beatStep(x.s))
    for (const beat of beats) {
      const inBeat = spans.filter((z) => {
        const mid = (z.in + z.out) / 2
        return mid >= beat.in && mid < beat.out
      })
      if (inBeat.length) report.beats++
      const manual = inBeat.filter((z) => z.source === 'manual')
      const auto = inBeat.filter((z) => z.source !== 'manual')
      if (manual.length) {
        for (const z of auto) drop.add(z)
        if (auto.length)
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
      }
      const targets = fallback
        ? beat.step === null || !beat.lastGesture
          ? []
          : [beat.lastGesture]
        : beat.marked
      if (!targets.length) {
        for (const z of auto) drop.add(z)
        if (auto.length)
          report.none.push({
            ...words,
            why: !fallback
              ? 'unmarked'
              : beat.step === null
                ? 'opening'
                : 'no-gesture',
            ids: auto.map((z) => z.id),
          })
        continue
      }
      const candidates = auto.filter((z) => !never.some((s) => onStep(z, s)))
      const chosen: ZoomSpan[] = []
      for (const target of targets) {
        const action = { step: target.step, do: target.do }
        const [best] = candidates
          .filter(
            (z) =>
              stepOverlap(z, target) > 0 &&
              !chosen.some((c) => c === z || overlaps(c, z)),
          )
          .sort(
            (a, b) =>
              ms(stepOverlap(b, target)) - ms(stepOverlap(a, target)) ||
              order(a, b),
          )
        if (!best) {
          report.none.push({ ...words, why: 'no-proposal', action, ids: [] })
          continue
        }
        chosen.push(best)
        report.kept.push({ ...words, action, id: best.id })
      }
      for (const z of chosen) z.source = 'manual'
      for (const z of auto) if (!chosen.includes(z)) drop.add(z)
    }
  }
  report.rejected = rejectAll(doc, drop, PER_BEAT_NOTE)
  return report
}

/** What the script's `zoom` marks did to a plan. */
export interface ZoomMarkReport {
  /** Proposals rejected because they sat on a step marked `"zoom": false`. */
  rejected: { media: string; step: number; ids: string[] }[]
  /** Steps marked `"zoom": true` the planner proposed no zoom on: none is invented. */
  unproposed: { media: string; step: number; id?: string; do: string }[]
}

/**
 * The marks on a plain plan: every proposal ON a step marked
 * `"zoom": false` is rejected like a person's delete (so no re-plan
 * proposes it again), and every step marked `"zoom": true` with no zoom
 * on it is named. A manual zoom is the person's and is never touched.
 */
export function applyZoomMarks(
  doc: ProjectDoc,
  actions: ReadonlyMap<string, ActionsFile | null>,
): ZoomMarkReport {
  const report: ZoomMarkReport = { rejected: [], unproposed: [] }
  const drop = new Set<ZoomSpan>()
  for (const { id: media, source } of docMediaList(doc)) {
    const spans = doc.zoom.filter((z) => mediaKey(z.media) === media)
    for (const { s, mark } of markedSteps(source, actions.get(media))) {
      const step = beatStep(s)
      if (mark === false) {
        const on = spans.filter(
          (z) => z.source !== 'manual' && !drop.has(z) && onStep(z, step),
        )
        for (const z of on) drop.add(z)
        if (on.length)
          report.rejected.push({
            media,
            step: s.step,
            ids: on.map((z) => z.id),
          })
      } else if (
        mark === true &&
        !spans.some((z) => !drop.has(z) && stepOverlap(z, step) > 0)
      ) {
        report.unproposed.push({
          media,
          step: s.step,
          ...(s.id ? { id: s.id } : {}),
          do: s.do,
        })
      }
    }
  }
  rejectAll(doc, drop, ZOOM_FALSE_NOTE)
  return report
}

/** The marks' report in words, or null when they did nothing. */
export function zoomMarkLine(
  r: ZoomMarkReport,
  name: (media: string) => string = (m) => (m ? `media ${m}` : 'the primary'),
): string | null {
  const at = (x: { media: string; step: number }) =>
    `#${x.step}${x.media ? ` of ${name(x.media)}` : ''}`
  const parts: string[] = []
  if (r.rejected.length)
    parts.push(
      `zoom: false rejected ${r.rejected.map((x) => `${x.ids.join(', ')} on step ${at(x)}`).join('; ')}`,
    )
  if (r.unproposed.length)
    parts.push(
      `zoom: true on ${r.unproposed.map((x) => `step ${at(x)} ${x.id ? `${x.id} ` : ''}${x.do}`).join(', ')}, but the planner proposed no zoom there (none is invented)`,
    )
  return parts.length ? parts.join('; ') : null
}

/** The report in words, one line, for a done line. */
export function perBeatLine(
  r: PerBeatReport,
  name: (media: string) => string = (m) => (m ? `media ${m}` : 'the primary'),
): string {
  const parts = [
    `one zoom per beat: ${r.beats} beat${r.beats === 1 ? '' : 's'} held zooms, ${r.kept.length} kept (now manual), ${r.rejected} rejected into doc.rejected (no re-plan brings them back)`,
  ]
  if (r.fallback)
    parts.push(
      'no step is marked "zoom": falling back to each beat\'s last gesture',
    )
  const beatName = (b: BeatWords) =>
    b.step === null
      ? `the opening${b.media ? ` of ${name(b.media)}` : ''}`
      : `beat ${b.caption ? JSON.stringify(b.caption) : String(b.step)}${b.media ? ` (${name(b.media)})` : ''}`
  const target = (a: BeatTarget) =>
    `${r.fallback ? 'last gesture' : 'marked'} #${a.step} ${a.do}`
  // The beats that kept a zoom first, then the rest.
  for (const b of r.kept)
    parts.push(`${beatName(b)}: ${target(b.action)}, kept ${b.id}`)
  for (const b of r.none)
    parts.push(
      `${beatName(b)}: ${
        b.why === 'no-proposal' && b.action
          ? `${target(b.action)}, but no proposal on it`
          : b.why === 'unmarked'
            ? 'no step marked "zoom", no zoom'
            : b.why === 'no-gesture'
              ? 'no gesture to stand in, no zoom'
              : 'no zoom'
      }`,
    )
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
