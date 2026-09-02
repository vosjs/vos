/**
 * The take digest's MOMENTS: the instants the cursor telemetry
 * says matter, each in the doc's own units so an agent's decision is a copy,
 * never a conversion. One grouping, shared with the planners (groupTrack,
 * dwellSpans, scrollRuns, idleGaps) — the digest lists exactly what the
 * planners zoom, speed and tilt over, plus the head, the tail, and the visual
 * scene changes a frame-diff pass finds. Pure and deterministic: same doc →
 * same moments, same ids.
 *
 * Time: `source` extents are footage seconds (SOURCE-anchored like the spans
 * they sit on); `output` is the same window mapped through the rate map, or
 * null when a trim cut it away. `at` is the source instant the digest frames.
 */
import {
  clusterFocus,
  dwellSpans,
  groupTrack,
  planAutoZoom,
} from '../planner/autoZoom'
import {
  DEFAULT_SPEED_PARAMS,
  idleGaps,
  planAutoSpeed,
  scrollRuns,
} from '../planner/autoSpeed'
import { planAutoTilt } from '../planner/autoTilt'
import { resolveZoomStyle } from '../zoomStyle'
import { ratedSegments, spanOutputExtent } from '../lower/lowerToComposition'
import type { Click } from '../planner/autoZoom'
import type { ProjectDoc, SpeedSpan, TiltSpan, ZoomSpan } from '../types'

export type MomentKind =
  | 'head'
  | 'tail'
  | 'click'
  | 'typing'
  | 'scroll'
  | 'dwell'
  | 'idle'
  | 'scene'

/** A rect in normalized [0..1] frame fractions (the zoom cx/cy convention). */
export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Moment {
  id: string
  kind: MomentKind
  /** Footage seconds. Instants (scene/head/tail) have in === out. */
  source: { in: number; out: number }
  /** The same window in OUTPUT seconds, null when trimmed away. */
  output: { in: number; out: number } | null
  /** The source instant the digest frames (null = no frame, e.g. idle). */
  at: number | null
  /** `at` mapped to output time (null when cut or frameless). */
  outputAt: number | null
  /** Normalized focus — copy into a ZoomSpan's cx/cy. */
  focus: { cx: number; cy: number } | null
  /** Normalized target bounds (element rect union), when the events had one. */
  rect: NormRect | null
  clicks?: number
  pings?: number
  /** Motion in the window, 0..1 (fraction of changed pixels), null without frames. */
  activity: number | null
  /** Planner spans (from `plan`) that cover this moment, by id. */
  proposed: { zoom?: string; speed?: string; tilt?: string }
  /** Transcript text over the window, when a transcript was merged. */
  said: string | null
}

export interface DigestPlan {
  zoom: ZoomSpan[]
  speed: SpeedSpan[]
  tilt: TiltSpan[]
}

export interface TranscriptSegment {
  /** SOURCE seconds (the recording's own clock). */
  start: number
  end: number
  text: string
}

export interface MomentsOptions {
  /** Per-SOURCE-second motion bins (0..1) from the frame-diff pass. */
  bins?: readonly number[] | null
  /** Source seconds of visual scene changes (see scenes.ts). */
  scenes?: readonly number[]
  transcript?: readonly TranscriptSegment[] | null
  /** Idle threshold (seconds); defaults to the speed planner's. */
  idleMin?: number
}

/**
 * The three planners, run fresh under the doc's own style — the proposals.
 * With activity bins (a digest's decode pass), the speed planner can tell
 * playback from idle.
 */
export function planForDigest(
  doc: ProjectDoc,
  activity?: readonly number[] | null,
): DigestPlan {
  const { cursor, meta } = doc.source
  const zoom = planAutoZoom(cursor, {
    width: meta.width,
    height: meta.height,
    style: doc.zoomStyle,
    params: doc.zoomParams,
  })
  const speed = planAutoSpeed(cursor, {
    durationMs: meta.durationMs,
    params: doc.speedParams,
    activity,
  })
  const style = resolveZoomStyle(doc.zoomStyle, doc.zoomParams)
  const intensity = doc.tiltStyle ?? style.tilt.intensity
  const tilt =
    intensity === 'off'
      ? []
      : planAutoTilt(zoom, ratedSegments(doc), { intensity })
  return { zoom, speed, tilt }
}

interface Draft {
  kind: MomentKind
  in: number
  out: number
  at: number | null
  focus: { cx: number; cy: number } | null
  rect: NormRect | null
  clicks?: number
  pings?: number
}

export function momentsFromDoc(
  doc: ProjectDoc,
  plan: DigestPlan,
  opts: MomentsOptions = {},
): Moment[] {
  const { cursor: track, meta } = doc.source
  const width = meta.width
  const height = meta.height
  const dur = meta.durationMs / 1000
  if (!(dur > 0)) return []
  const style = resolveZoomStyle(doc.zoomStyle, doc.zoomParams)
  const drafts: Draft[] = []

  const edge = Math.min(0.1, dur / 4)
  drafts.push({
    kind: 'head',
    in: 0,
    out: 0,
    at: edge,
    focus: null,
    rect: null,
  })
  drafts.push({
    kind: 'tail',
    in: dur,
    out: dur,
    at: Math.max(0, dur - edge),
    focus: null,
    rect: null,
  })

  if (track.length) {
    const { sessions, clusters } = groupTrack(track, {
      width,
      height,
      clusterGap: style.clusterGap,
      typingGap: style.typingGap,
      typingZoom: style.typingZoom,
    })
    for (const c of clusters) {
      const f = clusterFocus(c, width, height)
      drafts.push({
        kind: 'click',
        in: c[0].t,
        out: c[c.length - 1].t,
        // The frame AT the press shows what was clicked; the consequence is
        // the next moment's (or a scene) frame.
        at: c[0].t,
        focus: { cx: f.cx, cy: f.cy },
        rect: f.rect,
        clicks: c.length,
      })
    }
    for (const s of sessions) {
      const f = clusterFocus(s.events, width, height)
      drafts.push({
        kind: 'typing',
        in: s.start,
        out: s.last,
        // The filled field: the last ping, after the caret stopped.
        at: s.last,
        focus: { cx: f.cx, cy: f.cy },
        rect: f.rect,
        pings: s.events.filter((e) => e.t >= s.first).length,
      })
    }
    const scrollEvents: Click[] = track
      .filter((e) => e.type === 'scroll')
      .map((e) => ({ t: e.t / 1000, x: e.x, y: e.y, rect: e.rect }))
    for (const [a, b] of scrollRuns(track, 1)) {
      const evs = scrollEvents.filter((e) => e.t >= a && e.t <= b)
      const f = clusterFocus(evs, width, height)
      drafts.push({
        kind: 'scroll',
        in: a,
        out: b,
        at: (a + b) / 2,
        focus: { cx: f.cx, cy: f.cy },
        rect: f.rect,
      })
    }
    // Dwells only where no click/typing moment already is (the planner's rule).
    const reserved: ZoomSpan[] = drafts
      .filter((d) => d.kind === 'click' || d.kind === 'typing')
      .map((d, i) => ({
        id: `r${i}`,
        in: d.in,
        out: d.out,
        level: 1,
        cx: 0.5,
        cy: 0.5,
      }))
    for (const d of dwellSpans(
      track,
      width,
      height,
      style.maxLevel,
      reserved,
    )) {
      drafts.push({
        kind: 'dwell',
        in: d.in,
        out: d.out,
        at: (d.in + d.out) / 2,
        focus: { cx: d.cx, cy: d.cy },
        rect: null,
      })
    }
    for (const [a, b] of idleGaps(
      track,
      dur,
      opts.idleMin ?? DEFAULT_SPEED_PARAMS.idleMin,
    )) {
      drafts.push({
        kind: 'idle',
        in: a,
        out: b,
        at: null,
        focus: null,
        rect: null,
      })
    }
  }

  for (const t of opts.scenes ?? []) {
    if (t <= edge || t >= dur - edge) continue
    drafts.push({
      kind: 'scene',
      in: t,
      out: t,
      // A hair past the change so a cold seek lands on the new frame.
      at: Math.min(dur, t + 0.04),
      focus: null,
      rect: null,
    })
  }

  const order: Record<MomentKind, number> = {
    head: 0,
    click: 1,
    typing: 2,
    scroll: 3,
    dwell: 4,
    scene: 5,
    idle: 6,
    tail: 7,
  }
  drafts.sort((a, b) => a.in - b.in || order[a.kind] - order[b.kind])

  const rated = ratedSegments(doc)
  // An instant is a hair-wide window; at the very end it leans back inside.
  const outputOf = (a: number, b: number) => {
    const lo = a >= dur ? Math.max(0, dur - 0.001) : a
    return spanOutputExtent(rated, lo, Math.max(b, lo + 0.001))
  }
  const covers = (s: { in: number; out: number }, d: Draft) =>
    d.in === d.out ? s.in <= d.in && d.in < s.out : s.in < d.out && s.out > d.in

  return drafts.map((d, i) => {
    const output = outputOf(d.in, d.out)
    const outAt = d.at === null ? null : outputOf(d.at, d.at)
    const proposed: Moment['proposed'] = {}
    const z = plan.zoom.find((s) => covers(s, d))
    if (z) proposed.zoom = z.id
    const sp = plan.speed.find((s) => covers(s, d))
    if (sp) proposed.speed = sp.id
    const tl = plan.tilt.find((s) => covers(s, d))
    if (tl) proposed.tilt = tl.id
    return {
      id: `m${String(i + 1).padStart(2, '0')}`,
      kind: d.kind,
      source: { in: round(d.in), out: round(d.out) },
      output: output
        ? { in: round(output.start), out: round(output.end) }
        : null,
      at: d.at === null ? null : round(d.at),
      outputAt: outAt ? round(outAt.start) : null,
      focus: d.focus ? { cx: round(d.focus.cx), cy: round(d.focus.cy) } : null,
      rect: d.rect
        ? {
            x: round(d.rect.x),
            y: round(d.rect.y),
            w: round(d.rect.w),
            h: round(d.rect.h),
          }
        : null,
      ...(d.clicks !== undefined ? { clicks: d.clicks } : {}),
      ...(d.pings !== undefined ? { pings: d.pings } : {}),
      activity: activityOf(opts.bins, d),
      proposed,
      said: saidOver(opts.transcript, d),
    }
  })
}

/** Mean motion of the bins a window touches (or the bin at an instant). */
function activityOf(
  bins: readonly number[] | null | undefined,
  d: Draft,
): number | null {
  if (!bins || !bins.length) return null
  const a = Math.max(0, Math.floor(d.in))
  const b = Math.min(bins.length - 1, Math.max(a, Math.ceil(d.out) - 1))
  let sum = 0
  let n = 0
  for (let i = a; i <= b; i++) {
    sum += bins[i]
    n++
  }
  return n ? round(sum / n) : null
}

function saidOver(
  transcript: readonly TranscriptSegment[] | null | undefined,
  d: Draft,
): string | null {
  if (!transcript?.length) return null
  const lo = d.in
  const hi = d.in === d.out ? d.in + 0.5 : d.out
  const text = transcript
    .filter((s) => s.start < hi && s.end > lo)
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(' ')
  return text || null
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
