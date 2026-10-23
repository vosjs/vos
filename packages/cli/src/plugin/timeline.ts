/**
 * `vos info <take> [--json]`: where everything in a take is, in both
 * clocks. `vos info` inspects a program config; given a take directory it
 * reads the take instead, the way every engine verb takes a take.
 *
 * Per media, every recorder step with its id, its SOURCE seconds
 * (`meta.steps[].tStart`/`tEnd`), its caption and where it plays in the
 * cut. Then the OUTPUT timeline as the lowering resolves it, read through
 * studio-core's own functions (`ratedSegments`, `segmentOutputExtents`,
 * `spanOutputExtents`, `longestOutputExtent`, `cameraSpanExtents`,
 * `resolveOverlayAnchors`, `docOutputDuration`): every
 * segment, speed span, freeze, zoom and tilt with its output extent (or
 * cut, when the trims leave it out), every layer with its anchor resolved,
 * every sound clip, the still and the end. Read-only.
 */
import { join, resolve } from 'node:path'
import {
  docFreezes,
  docMediaList,
  docOutputDuration,
  cameraSpanExtents,
  docStillTime,
  freezeOutputExtents,
  mediaKey,
  migrateMotion,
  overlayPlainText,
  longestOutputExtent,
  ratedSegments,
  resolveOverlayAnchors,
  segmentOutputExtents,
  spanOutputExtents,
} from '@vosjs/studio-core'
import { totalDuration } from '@vosjs/timeline'
import { UsageError, parseArgs } from './args'
import { EXIT_OK, createReporter } from './output'
import { captionOf } from './stepCaptions'
import { loadTake } from './take'
import { scriptDrift, scriptDriftLine } from './scriptStep'
import type {
  OverlayAnchor,
  OverlayClip,
  ProjectDoc,
  Segment,
} from '@vosjs/studio-core'
import type { ActionsFile } from './actions'

type Extent = { start: number; end: number } | null

const r3 = (v: number): number => Math.round(v * 1000) / 1000
const ext = (e: Extent): Extent =>
  e ? { start: r3(e.start), end: r3(e.end) } : null
/**
 * Every other place a source span plays, beside `output`: a cut that
 * replays seconds (a cold open) plays the span in each pass. For a step,
 * `output` is the pass an anchor on it lands in (its longest); for a
 * camera span, the passes where it moves the camera.
 */
type Also = { start: number; end: number }[]

export interface TimelineStep {
  step: number
  id?: string
  do: string
  /** SOURCE seconds. */
  in: number
  out: number
  caption?: string
  skipped?: boolean
  /** Where the step plays in the cut; null when the trims leave it out. */
  output: Extent
  also?: Also
}

export interface TimelineMedia {
  /** `''` = the primary. */
  id: string
  file: string
  /** Source seconds. */
  duration: number
  steps: TimelineStep[]
}

export interface TakeTimeline {
  media: TimelineMedia[]
  segments: {
    index: number
    media: string
    in: number
    out: number
    start: number
    end: number
  }[]
  speed: {
    id: string
    media: string
    in: number
    out: number
    rate: number
    source?: string
    output: Extent
    also?: Also
  }[]
  freeze: {
    id: string
    media: string
    at: number
    seconds: number
    output: Extent
  }[]
  zoom: {
    id: string
    media: string
    in: number
    out: number
    level: number
    source?: string
    output: Extent
    also?: Also
    /** Where it plays in a clip that rests the camera, so moves nothing. */
    rests?: Also
  }[]
  tilt: {
    id: string
    media: string
    in: number
    out: number
    output: Extent
    also?: Also
    rests?: Also
  }[]
  overlays: {
    id: string
    kind: string
    text?: string
    start: number
    end: number
    anchor?: OverlayAnchor
    from?: string
  }[]
  objects: { id: string; start: number; end: number | null }[]
  audio: {
    id: string
    name?: string
    start: number
    end: number
    in: number
    out: number
  }[]
  /** The kept footage's output length (speed and freezes applied). */
  footage: number
  /** The film's output length: the footage, or the last layer past it. */
  end: number
  /** The cover moment, output seconds. */
  still: number
}

/** The rated pieces without freezes: what a freeze is placed into. */
function ratedWithoutFreezes(doc: ProjectDoc): Segment[] {
  return ratedSegments({
    ...doc,
    freeze: undefined,
    segments: doc.segments.map((s) => {
      const { hold: _hold, ...rest } = s as typeof s & { hold?: unknown }
      void _hold
      return rest
    }),
  })
}

/**
 * The take's two clocks, resolved. `actions` maps a media key (`''` = the
 * primary) to the actions.json that recorded it, for the step captions; a
 * media's embedded script is read when it has none.
 */
export function takeTimeline(
  rawDoc: ProjectDoc,
  actions: ReadonlyMap<string, ActionsFile | null> = new Map(),
): TakeTimeline {
  const doc = migrateMotion(rawDoc)
  const rated = ratedSegments(doc)
  // Where a source span plays: its first place and, on a cut that replays
  // it, every other place.
  const round = (e: { start: number; end: number }) => ({
    start: r3(e.start),
    end: r3(e.end),
  })
  const span = (
    sIn: number,
    sOut: number,
    media?: string,
  ): { output: Extent; also?: Also } => {
    const all = spanOutputExtents(rated, sIn, sOut, media).map(round)
    return {
      output: all[0] ?? null,
      ...(all.length > 1 ? { also: all.slice(1) } : {}),
    }
  }
  // A step plays where an anchor on it lands, the pass it plays longest
  // (`resolveAnchor`), and is seen in the others too.
  const stepSpan = (
    sIn: number,
    sOut: number,
    media?: string,
  ): { output: Extent; also?: Also } => {
    const all = spanOutputExtents(rated, sIn, sOut, media).map(round)
    const longest = longestOutputExtent(rated, sIn, sOut, media)
    const main = longest
      ? all.find(
          (e) =>
            Math.abs(e.start - r3(longest.start)) < 1e-6 &&
            Math.abs(e.end - r3(longest.end)) < 1e-6,
        )
      : undefined
    const others = all.filter((e) => e !== main)
    return {
      output: main ?? null,
      ...(others.length ? { also: others } : {}),
    }
  }
  // A camera span moves the camera only in the passes whose clip does not
  // rest it (`segments[].camera: "rest"`); where it rests is said apart.
  const cameraSpan = (
    sIn: number,
    sOut: number,
    media?: string,
  ): { output: Extent; also?: Also; rests?: Also } => {
    const moves = cameraSpanExtents(rated, sIn, sOut, media).map(round)
    const rests = spanOutputExtents(rated, sIn, sOut, media)
      .map(round)
      .filter(
        (e) =>
          !moves.some(
            (m) => m.start >= e.start - 1e-6 && m.end <= e.end + 1e-6,
          ),
      )
    return {
      output: moves[0] ?? null,
      ...(moves.length > 1 ? { also: moves.slice(1) } : {}),
      ...(rests.length ? { rests } : {}),
    }
  }

  const media: TimelineMedia[] = docMediaList(doc).map(({ id, source }) => ({
    id,
    file: source.videoKey,
    duration: r3((source.meta.durationMs || 0) / 1000),
    steps: (source.meta.steps ?? []).map((s) => {
      const caption = captionOf(
        s,
        actions.get(id),
        source.script,
        source.meta.steps ?? [],
      )
      // A step is an instant as often as a stretch (a press, a key): it
      // plays where its first moment does.
      const out = Math.max(s.tEnd, s.tStart + 1e-3)
      return {
        step: s.step,
        ...(s.id !== undefined ? { id: s.id } : {}),
        do: s.do,
        in: r3(s.tStart),
        out: r3(s.tEnd),
        ...(caption ? { caption } : {}),
        ...(s.skipped ? { skipped: true } : {}),
        ...stepSpan(s.tStart, out, id || undefined),
      }
    }),
  }))

  const docSegments = doc.segments.length
    ? doc.segments
    : [{ in: 0, out: doc.source.meta.durationMs / 1000 }]
  const extents = segmentOutputExtents(doc)
  const segments = docSegments.map((s, index) => ({
    index,
    media: mediaKey((s as { media?: string }).media),
    in: r3(s.in),
    out: r3(s.out),
    start: r3(extents[index]?.start ?? 0),
    end: r3(extents[index]?.end ?? 0),
  }))

  const freezeMarks = freezeOutputExtents(
    ratedWithoutFreezes(doc),
    docFreezes(doc),
  )
  const freeze = docFreezes(doc).map((f) => {
    const m = freezeMarks.get(f.id)
    return {
      id: f.id,
      media: mediaKey(f.media),
      at: r3(f.at),
      seconds: r3(f.seconds),
      output: m ? ext({ start: m.t, end: m.t + m.duration }) : null,
    }
  })

  // Resolved layers come back without the ones placed nowhere (an anchor
  // that resolves to no step, and no start), so the raw layer is found by
  // id, never by index.
  const resolved = resolveOverlayAnchors(doc, rated)
  const rawById = new Map((doc.overlays ?? []).map((o) => [o.id, o]))
  const overlays = (resolved.overlays ?? []).flatMap((o: OverlayClip) => {
    const start = o.start
    if (start === undefined) return []
    const raw = rawById.get(o.id)
    const text =
      o.kind === 'text'
        ? overlayPlainText(o)
        : o.kind === 'html'
          ? undefined
          : (o as { key?: string }).key
    return [
      {
        id: o.id,
        kind: o.kind ?? 'text',
        ...(text !== undefined ? { text } : {}),
        start: r3(start),
        end: r3(start + o.duration),
        ...(raw?.anchor ? { anchor: raw.anchor } : {}),
        ...(o.from ? { from: o.from } : {}),
      },
    ]
  })

  const footage = totalDuration(rated)
  return {
    media,
    segments,
    speed: (doc.speed ?? []).map((s) => ({
      id: s.id,
      media: mediaKey(s.media),
      in: r3(s.in),
      out: r3(s.out),
      rate: s.rate,
      ...(s.source ? { source: s.source } : {}),
      ...span(s.in, s.out, s.media),
    })),
    freeze,
    zoom: doc.zoom.map((z) => ({
      id: z.id,
      media: mediaKey(z.media),
      in: r3(z.in),
      out: r3(z.out),
      level: z.level,
      ...(z.source ? { source: z.source } : {}),
      ...cameraSpan(z.in, z.out, z.media),
    })),
    tilt: (doc.tilt ?? []).map((t) => ({
      id: t.id,
      media: mediaKey(t.media),
      in: r3(t.in),
      out: r3(t.out),
      ...cameraSpan(t.in, t.out, t.media),
    })),
    overlays,
    objects: (doc.objects ?? []).map((ob) => ({
      id: ob.id,
      start: r3(ob.span?.start ?? 0),
      end: ob.span ? r3(ob.span.start + ob.span.duration) : null,
    })),
    audio: doc.audio.map((a) => {
      const len = a.loop && a.loopLen ? a.loopLen : a.out - a.in
      return {
        id: a.id,
        ...(a.name ? { name: a.name } : {}),
        start: r3(a.start),
        end: r3(a.start + len),
        in: r3(a.in),
        out: r3(a.out),
      }
    }),
    footage: r3(footage),
    end: r3(docOutputDuration(doc)),
    still: docStillTime(doc),
  }
}

const f2 = (v: number): string => v.toFixed(2)
const range = (a: number, b: number): string => `${f2(a)}–${f2(b)}`
const ranges = (list: Also): string =>
  list.map((a) => range(a.start, a.end)).join(', ')
const outText = (e: Extent, also?: Also, rests?: Also): string =>
  `${e ? range(e.start, e.end) : rests?.length ? '(camera at rest)' : '(cut)'}${also?.length ? `, also ${ranges(also)}` : ''}${rests?.length ? `${e ? ',' : ''} at rest in ${ranges(rests)}` : ''}`
const mediaName = (m: string): string => m || 'primary'

/** The timeline in words, one thing a line. */
export function formatTimeline(t: TakeTimeline, label: string): string {
  const lines: string[] = []
  const pad = (s: string, n: number) => s.padEnd(n)
  lines.push(
    `${label}: output ${f2(t.end)} s (footage ${f2(t.footage)} s), ${t.media.length} media`,
  )
  for (const m of t.media) {
    lines.push('')
    lines.push(
      `${mediaName(m.id)}  ${m.file}  ${f2(m.duration)} s source, ${m.steps.length} step${m.steps.length === 1 ? '' : 's'}`,
    )
    if (m.steps.length)
      lines.push(
        `  ${pad('step', 5)} ${pad('id', 16)} ${pad('do', 8)} ${pad('source', 14)} ${pad('output', 14)} caption`,
      )
    for (const s of m.steps)
      lines.push(
        `  ${pad(String(s.step), 5)} ${pad(s.id ?? '-', 16)} ${pad(s.do, 8)} ${pad(range(s.in, s.out), 14)} ${pad(s.skipped ? '(skipped)' : outText(s.output), 14)} ${s.caption ? JSON.stringify(s.caption) : ''}${s.also?.length && !s.skipped ? ` (also ${ranges(s.also)})` : ''}`.trimEnd(),
      )
  }
  lines.push('')
  lines.push('output timeline (source → output seconds)')
  lines.push('  segments')
  for (const s of t.segments)
    lines.push(
      `    #${pad(String(s.index), 4)} ${pad(mediaName(s.media), 8)} ${pad(range(s.in, s.out), 14)} → ${range(s.start, s.end)}`,
    )
  if (t.speed.length) {
    lines.push('  speed')
    for (const s of t.speed)
      lines.push(
        `    ${pad(s.id, 12)} ${pad(mediaName(s.media), 8)} ${pad(range(s.in, s.out), 14)} ×${pad(String(s.rate), 5)} ${pad(s.source ?? '', 6)} → ${outText(s.output, s.also)}`,
      )
  }
  if (t.freeze.length) {
    lines.push('  freeze')
    for (const f of t.freeze)
      lines.push(
        `    ${pad(f.id, 12)} ${pad(mediaName(f.media), 8)} at ${pad(f2(f.at), 11)} ${f2(f.seconds)} s → ${outText(f.output)}`,
      )
  }
  if (t.zoom.length) {
    lines.push('  zoom')
    for (const z of t.zoom)
      lines.push(
        `    ${pad(z.id, 12)} ${pad(mediaName(z.media), 8)} ${pad(range(z.in, z.out), 14)} L${pad(String(z.level), 5)} ${pad(z.source ?? '', 6)} → ${outText(z.output, z.also, z.rests)}`,
      )
  }
  if (t.tilt.length) {
    lines.push('  tilt')
    for (const z of t.tilt)
      lines.push(
        `    ${pad(z.id, 12)} ${pad(mediaName(z.media), 8)} ${pad(range(z.in, z.out), 14)} → ${outText(z.output, z.also, z.rests)}`,
      )
  }
  if (t.overlays.length) {
    lines.push('  layers')
    for (const o of t.overlays) {
      const anchor = o.anchor
        ? ` anchor ${o.anchor.media ? `${o.anchor.media}:` : ''}${String(o.anchor.step)}${o.anchor.at === 'end' ? ' end' : ''}${o.anchor.offset ? ` ${o.anchor.offset > 0 ? '+' : ''}${o.anchor.offset}` : ''}`
        : ''
      const words = o.text !== undefined ? ` ${JSON.stringify(o.text)}` : ''
      lines.push(
        `    ${pad(o.id, 12)} ${pad(o.kind, 6)} ${range(o.start, o.end)}${anchor}${o.from ? ` (from ${o.from})` : ''}${words}`,
      )
    }
  }
  if (t.objects.length) {
    lines.push('  3D')
    for (const o of t.objects)
      lines.push(
        `    ${pad(o.id, 12)} ${o.end === null ? 'always' : range(o.start, o.end)}`,
      )
  }
  if (t.audio.length) {
    lines.push('  sound')
    for (const a of t.audio)
      lines.push(
        `    ${pad(a.id, 12)} ${range(a.start, a.end)} (its file ${range(a.in, a.out)})${a.name ? ` ${a.name}` : ''}`,
      )
  }
  lines.push(`  still ${f2(t.still)}`)
  lines.push(`  end   ${f2(t.end)}`)
  return lines.join('\n')
}

/** `vos info <take> [--json]`. */
export async function cmdTakeInfo(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, new Set(['json', 'help']))
  const dir = positionals[0]
  if (!dir) throw new UsageError('vos info <take> [--json]')
  const r = createReporter(flags.json === true)
  const take = await loadTake(dir)
  if (!take.doc)
    throw new UsageError(
      `${dir} has no doc.json yet; vos plan ${dir} writes one`,
    )
  // A script edited since the take was recorded: said, never refused.
  const drift = scriptDrift(take.meta.steps ?? [], take.actions?.steps)
  if (drift) r.warn(scriptDriftLine(drift))
  const timeline = takeTimeline(take.doc, new Map([['', take.actions]]))
  r.done(
    { take: resolve(dir), doc: join(resolve(dir), 'doc.json'), ...timeline },
    formatTimeline(timeline, dir),
  )
  return EXIT_OK
}
