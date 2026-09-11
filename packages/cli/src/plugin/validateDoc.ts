/**
 * Semantic lints for a take's doc.json — the agent-editable ProjectDoc surface.
 * Mirrors schema/doc.schema.json (keep the two in sync): the schema documents
 * the shape for agents/editors; these lints enforce the semantic contracts a
 * schema can't (overlap, footage bounds, the normalized-coords trap).
 *
 * The input is UNTRUSTED JSON an agent may have hand-edited — every access is
 * guarded, hence the `unknown`-based reads despite the ProjectDoc signature.
 *
 * `problems` break or visibly corrupt a render; `warnings` are honesty/taste
 * notes (footage upscaling, sub-minimum spans) that still render fine.
 */
import {
  CAM_SIZE_MAX,
  CAM_SIZE_MIN,
  CAM_SPAN_MIN,
  CARD_ENTER_KINDS,
  SEGMENT_ENTER_KINDS,
  SEGMENT_EXIT_KINDS,
  enterOf,
  exitOf,
  htmlLayerProblems,
  segmentOutputExtents,
  transitionSeconds,
  CARD_EXIT_KINDS,
  EXPORT_RESOLUTION_OPTIONS,
  FREEZE_SECONDS_MAX,
  FREEZE_SECONDS_MIN,
  IDLE_KINDS,
  MEDIA_ENTER_KINDS,
  MEDIA_EXIT_KINDS,
  MEDIA_FRAME_KEYS,
  SPEED_RATE_MAX,
  SPEED_RATE_MIN,
  TEXT_ENTER_KINDS,
  TEXT_EXIT_KINDS,
  TILT_DEG_MAX,
  TILT_SPAN_MIN,
  ZOOM_LEVEL_MAX,
  ZOOM_LEVEL_MIN,
  ZOOM_SPAN_MIN,
  docCardLayout,
  outputEnd,
  ratedSegments,
  recommendedExportResolution,
  spanOutputExtent,
  zoomCoversRect,
} from '@vosjs/studio-core'
import { TYPEFACE_CATALOG, findFontFamily, findTypeface } from '@vosjs/shared'
import type {
  ExportResolution,
  ProjectDoc,
  StudioDoc,
} from '@vosjs/studio-core'

const STEP_KINDS_ALL = [
  'none',
  'fade',
  'rise',
  'pop',
  'blur',
  'typewriter',
  'tilt-in',
  'pull-out',
  'recede',
  'slide',
  'scale',
]
const STEP_SIDES = ['left', 'right', 'up', 'down']
const STEP_UNITS = ['block', 'line', 'word', 'char']
const STEP_DIRS = ['forward', 'reverse', 'center']

/**
 * The one vocabulary, checked per primitive: which kinds a thing accepts
 * is its own (the card cannot typewrite, a word cannot tilt in), the
 * per-unit grammar belongs to words, and idle belongs to props.
 */
function lintAnim(
  name: string,
  anim: unknown,
  kinds: {
    enter: readonly string[]
    exit: readonly string[]
    idle: readonly string[] | null
    words: boolean
  },
  problems: string[],
): void {
  if (anim === undefined) return
  if (typeof anim !== 'object' || anim === null || Array.isArray(anim)) {
    problems.push(`${name}.anim must be { enter?, exit?, idle? }`)
    return
  }
  const a = anim as Record<string, unknown>
  for (const side of ['enter', 'exit'] as const) {
    const step = a[side]
    if (step === undefined) continue
    const allowed = kinds[side]
    const spelled = typeof step === 'string' ? step : null
    const obj =
      typeof step === 'object' && step !== null && !Array.isArray(step)
        ? (step as Record<string, unknown>)
        : null
    const kind = spelled ?? (obj ? obj.kind : undefined)
    if (typeof kind !== 'string' || !STEP_KINDS_ALL.includes(kind)) {
      problems.push(
        `${name}.anim.${side} must be a kind or { kind, seconds?${kinds.words ? ', unit?, direction?, stagger?' : ''} } (got ${JSON.stringify(step)})`,
      )
      continue
    }
    if (!allowed.includes(kind)) {
      problems.push(
        `${name}.anim.${side} cannot be "${kind}" here; one of ${allowed.join(' | ')}`,
      )
    }
    if (!obj) continue
    const secs = obj.seconds
    if (
      secs !== undefined &&
      (typeof secs !== 'number' ||
        !Number.isFinite(secs) ||
        secs < 0.05 ||
        secs > 3)
    ) {
      problems.push(`${name}.anim.${side}.seconds must be 0.05..3`)
    }
    for (const key of ['unit', 'direction', 'stagger'] as const) {
      if (obj[key] === undefined) continue
      if (!kinds.words) {
        problems.push(`${name}.anim.${side}.${key} is for words only`)
        continue
      }
      if (
        key === 'unit' &&
        (typeof obj.unit !== 'string' || !STEP_UNITS.includes(obj.unit))
      )
        problems.push(
          `${name}.anim.${side}.unit must be ${STEP_UNITS.join('|')}`,
        )
      if (
        key === 'direction' &&
        (typeof obj.direction !== 'string' ||
          !STEP_DIRS.includes(obj.direction))
      )
        problems.push(
          `${name}.anim.${side}.direction must be ${STEP_DIRS.join('|')}`,
        )
      if (
        key === 'stagger' &&
        (typeof obj.stagger !== 'number' || obj.stagger < 0 || obj.stagger > 2)
      )
        problems.push(`${name}.anim.${side}.stagger must be seconds in 0..2`)
    }
    if (obj.side !== undefined) {
      if (kind !== 'slide')
        problems.push(`${name}.anim.${side}.side is for a slide`)
      else if (typeof obj.side !== 'string' || !STEP_SIDES.includes(obj.side))
        problems.push(
          `${name}.anim.${side}.side must be ${STEP_SIDES.join(' | ')}`,
        )
    }
  }
  if (a.idle !== undefined && a.idle !== null) {
    if (!kinds.idle) problems.push(`${name}.anim.idle is for props only`)
    else if (typeof a.idle !== 'string' || !kinds.idle.includes(a.idle))
      problems.push(
        `${name}.anim.idle must be ${kinds.idle.join(' | ')} | null`,
      )
  }
}

function lintFrom(name: string, from: unknown, problems: string[]): void {
  if (from !== undefined && (typeof from !== 'string' || !from.length))
    problems.push(`${name}.from must be the id of the template that placed it`)
}

export interface DocLintResult {
  problems: string[]
  warnings: string[]
}

const EPS = 1e-3

type Json = Record<string, unknown>

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null

/** Array field → object entries (non-arrays/non-objects handled by callers). */
const entries = (v: unknown): Json[] =>
  Array.isArray(v) ? v.filter(isObj) : []

const spanName = (label: string, s: Json): string =>
  `${label} ${typeof s.id === 'string' ? s.id : `@${String(s.in)}`}`

/** Per-span transition speed (zoom/tilt/camMotion). */
const TRANSITION_SPEEDS = ['instant', 'fast', 'smooth', 'slow']
function checkTransition(s: Json, name: string, problems: string[]): void {
  if (
    s.transition !== undefined &&
    !TRANSITION_SPEEDS.includes(s.transition as string)
  ) {
    problems.push(
      `${name}: transition must be ${TRANSITION_SPEEDS.join('|')} (got ${String(s.transition)})`,
    )
  }
}

/**
 * A step anchor is metadata for `vos plan --reuse` — never read by
 * lowering — but a malformed one silently loses the re-record tie, so it
 * lints like everything else: in words, at the span that carries it.
 */
function checkAnchor(s: Json, name: string, problems: string[]): void {
  if (s.anchor === undefined) return
  if (!isObj(s.anchor)) {
    problems.push(`${name}: anchor must be { step, at?, offset? }`)
    return
  }
  const a = s.anchor
  if (
    typeof a.step !== 'string' &&
    !(isNum(a.step) && Number.isInteger(a.step) && a.step >= 0)
  ) {
    problems.push(
      `${name}: anchor.step must be a step id (string) or index (integer ≥ 0)`,
    )
  }
  if (a.at !== undefined && a.at !== 'start' && a.at !== 'end') {
    problems.push(`${name}: anchor.at must be "start" or "end"`)
  }
  if (a.offset !== undefined && !isNum(a.offset)) {
    problems.push(`${name}: anchor.offset must be a number (seconds)`)
  }
}

function checkSpanList(
  list: Json[],
  label: string,
  duration: number,
  problems: string[],
): void {
  const sorted = [...list].sort(
    (a, b) => (isNum(a.in) ? a.in : 0) - (isNum(b.in) ? b.in : 0),
  )
  for (const s of sorted) {
    const name = spanName(label, s)
    checkAnchor(s, name, problems)
    if (!isNum(s.in) || !isNum(s.out)) {
      problems.push(`${name}: in/out must be finite numbers (SOURCE seconds)`)
      continue
    }
    if (s.out - s.in <= 0)
      problems.push(`${name}: out (${s.out}) must be > in (${s.in})`)
    if (s.in < -EPS || (duration > 0 && s.in > duration + EPS)) {
      problems.push(
        `${name}: in=${s.in}s is outside the footage (0..${duration.toFixed(2)}s)`,
      )
    }
    if (duration > 0 && s.out > duration + EPS) {
      problems.push(
        `${name}: out=${s.out}s exceeds the footage (${duration.toFixed(2)}s)`,
      )
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (isNum(prev.out) && isNum(curr.in) && curr.in < prev.out - EPS) {
      problems.push(
        `${spanName(label, curr)} overlaps ${spanName(label, prev)} (spans must not overlap)`,
      )
    }
  }
}

export function lintDoc(docIn: StudioDoc): DocLintResult {
  const doc = docIn as unknown as Json
  const problems: string[] = []
  const warnings: string[] = []
  // The anchor: a recording document carries `source` and lints its
  // footage-anchored tracks against the footage's length; a program
  // document lints the shared layers against the program's length.
  const recording = isObj(doc.source)
  const source = isObj(doc.source) ? doc.source : {}
  const meta = isObj(source.meta) ? source.meta : {}
  const program = isObj(doc.program) ? doc.program : undefined
  const programConfig =
    program && isObj(program.config) ? program.config : undefined
  const duration = recording
    ? (isNum(meta.durationMs) ? meta.durationMs : 0) / 1000
    : program && isNum(program.duration)
      ? program.duration
      : programConfig && isNum(programConfig.duration)
        ? programConfig.duration
        : 0
  // The take's other media (concat): a span that names one is measured
  // against THAT media's length, never the primary's.
  const mediaLen = new Map<string, number>()
  if (recording && doc.media !== undefined) {
    if (!Array.isArray(doc.media)) problems.push('media must be an array')
    for (const [i, raw] of (Array.isArray(doc.media)
      ? (doc.media as unknown[])
      : []
    ).entries()) {
      const m = isObj(raw) ? raw : {}
      const id = typeof m.id === 'string' ? m.id : ''
      if (!id) problems.push(`media[${i}]: id must be a string`)
      else if (mediaLen.has(id))
        problems.push(`media[${i}] (${id}): duplicate id`)
      // A media's own card: card-owned fields only (the frame-wide ones,
      // the aspect, the padding, the ground, the backdrop, the card's
      // animation, are the take's and read wrong on a media).
      const mf = (m as { frame?: unknown }).frame
      if (mf !== undefined) {
        if (!isObj(mf)) {
          problems.push(
            `media[${i}]${id ? ` (${id})` : ''}: frame must be an object`,
          )
        } else {
          for (const k of Object.keys(mf)) {
            if (!(MEDIA_FRAME_KEYS as readonly string[]).includes(k))
              problems.push(
                `media[${i}]${id ? ` (${id})` : ''}.frame.${k}: not a card field (a media's frame carries ${MEDIA_FRAME_KEYS.join(', ')}; the rest is the take's frame)`,
              )
          }
        }
      }
      if (typeof m.videoKey !== 'string')
        problems.push(
          `media[${i}]${id ? ` (${id})` : ''}: videoKey must be a string`,
        )
      const mm = isObj(m.meta) ? m.meta : {}
      const ms = isNum(mm.durationMs) ? mm.durationMs : 0
      if (id) mediaLen.set(id, ms / 1000)
    }
  }
  /** Check a span list media by media: each against its own footage. */
  const checkByMedia = (list: Json[], label: string): void => {
    const groups = new Map<string, Json[]>()
    for (const s of list) {
      const m = typeof s.media === 'string' ? s.media : ''
      if (m && !mediaLen.has(m)) {
        problems.push(
          `${spanName(label, s)}: media "${m}" is not one of media[].id`,
        )
        continue
      }
      groups.set(m, [...(groups.get(m) ?? []), s])
    }
    for (const [m, group] of groups)
      checkSpanList(
        group,
        label,
        m ? (mediaLen.get(m) ?? 0) : duration,
        problems,
      )
  }
  if (!recording) {
    if (!program)
      problems.push(
        'doc must carry `source` (a recording) or `program` (a program)',
      )
    else if (!programConfig)
      problems.push(
        'program.config must be the config object (functions as strings)',
      )
    if (
      program &&
      program.tweenEdits !== undefined &&
      !isObj(program.tweenEdits)
    )
      problems.push('program.tweenEdits must be an object keyed by spec index')
  }

  // --- zoom spans (the highest-traffic agent surface) ---
  if (recording && !Array.isArray(doc.zoom))
    problems.push('zoom must be an array of spans')
  const zoom = recording ? entries(doc.zoom) : []
  if (recording) {
    checkByMedia(zoom, 'zoom')
    for (const z of zoom) {
      const name = spanName('zoom', z)
      if (
        !isNum(z.level) ||
        z.level < ZOOM_LEVEL_MIN - EPS ||
        z.level > ZOOM_LEVEL_MAX + EPS
      ) {
        problems.push(
          `${name}: level=${String(z.level)} out of range (${ZOOM_LEVEL_MIN}..${ZOOM_LEVEL_MAX})`,
        )
      }
      for (const axis of ['cx', 'cy'] as const) {
        const v = z[axis]
        if (!isNum(v) || v < 0 || v > 1) {
          problems.push(
            `${name}: ${axis}=${String(v)} — focus coords are NORMALIZED [0..1] video-frame fractions (0.5 = center), not pixels`,
          )
        }
      }
      checkTransition(z, name, problems)
      if (
        z.focusMode !== undefined &&
        z.focusMode !== 'manual' &&
        z.focusMode !== 'auto'
      ) {
        problems.push(`${name}: focusMode must be 'manual' or 'auto'`)
      }
      if (
        z.source !== undefined &&
        z.source !== 'manual' &&
        z.source !== 'auto'
      ) {
        problems.push(`${name}: source must be 'manual' or 'auto'`)
      }
      if (
        isNum(z.in) &&
        isNum(z.out) &&
        z.out - z.in > 0 &&
        z.out - z.in < ZOOM_SPAN_MIN
      ) {
        warnings.push(
          `${name}: span ${(z.out - z.in).toFixed(2)}s is under the ${ZOOM_SPAN_MIN}s minimum the studio enforces`,
        )
      }
    }

    // --- the still: the frame that stands for the take, output seconds ---
    if (recording && doc.still !== undefined) {
      const st = doc.still
      if (!isNum(st) || st < 0) {
        problems.push('still must be a number ≥ 0 (OUTPUT seconds)')
      } else {
        const rated = ratedSegments(doc as unknown as ProjectDoc)
        const end = outputEnd(
          doc as unknown as ProjectDoc,
          rated.reduce((a, s) => a + (s.out - s.in) / (s.rate ?? 1), 0),
        )
        if (st > end + 1e-6)
          problems.push(
            `still=${String(st)} is past the output's end (${end.toFixed(2)}s)`,
          )
      }
    }
    // --- freezes and the end card: a freeze is output seconds, never long ---
    for (const [i, seg] of (Array.isArray(doc.segments)
      ? (doc.segments as unknown[])
      : []
    ).entries()) {
      const hold = (seg as { hold?: unknown }).hold
      if (hold === undefined) continue
      if (!isNum(hold) || hold < 0 || hold > FREEZE_SECONDS_MAX) {
        problems.push(
          `segments[${i}].hold must be 0..${FREEZE_SECONDS_MAX} output seconds (got ${String(hold)})`,
        )
      } else if (hold > 0) {
        warnings.push(
          `segments[${i}].hold is a legacy spelling, read as a freeze at ${String((seg as { out?: unknown }).out)}s (doc.freeze); vos plan writes that shape`,
        )
      }
    }
    if (doc.freeze !== undefined && !Array.isArray(doc.freeze)) {
      problems.push('freeze must be an array of {id, at, seconds}')
    }
    const freezes = Array.isArray(doc.freeze) ? (doc.freeze as unknown[]) : []
    const freezeIds = new Set<string>()
    for (const [i, raw] of freezes.entries()) {
      const f = raw as { id?: unknown; at?: unknown; seconds?: unknown }
      const name = `freeze[${i}]${typeof f.id === 'string' ? ` (${f.id})` : ''}`
      if (typeof f.id !== 'string' || !f.id)
        problems.push(`${name}: id must be a string`)
      else if (freezeIds.has(f.id)) problems.push(`${name}: duplicate id`)
      else freezeIds.add(f.id)
      const fm =
        typeof (f as { media?: unknown }).media === 'string'
          ? ((f as { media?: string }).media as string)
          : ''
      const fLen = fm ? mediaLen.get(fm) : duration
      if (fm && fLen === undefined) {
        problems.push(`${name}: media "${fm}" is not one of media[].id`)
      } else if (!isNum(f.at) || f.at < 0 || f.at > (fLen ?? duration) + EPS) {
        problems.push(
          `${name}: at must be a SOURCE moment inside the recording (0..${(fLen ?? duration).toFixed(2)}s, got ${String(f.at)})`,
        )
      }
      if (
        !isNum(f.seconds) ||
        f.seconds < FREEZE_SECONDS_MIN - EPS ||
        f.seconds > FREEZE_SECONDS_MAX + EPS
      ) {
        problems.push(
          `${name}: seconds must be ${FREEZE_SECONDS_MIN}..${FREEZE_SECONDS_MAX} output seconds (got ${String(f.seconds)})`,
        )
      }
    }
    const endCard = (doc as { endCard?: unknown }).endCard
    if (endCard !== undefined) {
      warnings.push(
        'endCard is a legacy spelling, read as clips after the footage plus a card exit (frame.anim.exit); vos plan writes that shape',
      )
      if (typeof endCard !== 'object' || endCard === null) {
        problems.push(
          'endCard must be an object: {seconds?, headline?, sub?, wordmark?}',
        )
      } else {
        const ec = endCard as {
          seconds?: unknown
          headline?: unknown
          sub?: unknown
          wordmark?: unknown
        }
        if (
          ec.seconds !== undefined &&
          (!isNum(ec.seconds) || ec.seconds < 1 || ec.seconds > 8)
        ) {
          problems.push(
            `endCard.seconds must be 1..8 (got ${String(ec.seconds)}); absent = 2.5`,
          )
        }
        for (const k of ['headline', 'sub', 'wordmark'] as const) {
          if (ec[k] !== undefined && typeof ec[k] !== 'string') {
            problems.push(`endCard.${k} must be a string`)
          }
        }
        if (
          !['headline', 'sub', 'wordmark'].some(
            (k) =>
              typeof ec[k as keyof typeof ec] === 'string' &&
              (ec[k as keyof typeof ec] as string).trim(),
          )
        ) {
          warnings.push(
            'endCard carries no words: it holds the last frame and recedes the card over nothing',
          )
        }
      }
    }
    // --- segments (kept footage) ---
    if (doc.segments !== undefined && !Array.isArray(doc.segments)) {
      problems.push('segments must be an array of {in, out} spans')
    }
    checkByMedia(entries(doc.segments), 'segment')
    // A clip's transitions: the vocabulary a footage clip accepts, never
    // longer than half the shorter clip at its boundary (the clip must be
    // seen still before it moves), and the outer edges are the card's.
    const segs = Array.isArray(doc.segments)
      ? (doc.segments as Record<string, unknown>[]).filter(isObj)
      : []
    segs.forEach((seg, i) => {
      lintAnim(
        `segments[${i}]`,
        seg.anim,
        {
          enter: SEGMENT_ENTER_KINDS,
          exit: SEGMENT_EXIT_KINDS,
          idle: null,
          words: false,
        },
        problems,
      )
    })
    if (segs.length && segs.every((s) => isNum(s.in) && isNum(s.out))) {
      const anims = segs.map(
        (s) => s.anim as ProjectDoc['segments'][number]['anim'],
      )
      if (enterOf(anims[0]) && enterOf(anims[0])!.kind !== 'none')
        warnings.push(
          'segments[0].anim.enter is ignored: the first clip arrives with the card (frame.anim.enter)',
        )
      const last = segs.length - 1
      if (
        last > 0 &&
        exitOf(anims[last]) &&
        exitOf(anims[last])!.kind !== 'none'
      )
        warnings.push(
          `segments[${last}].anim.exit is ignored: the last clip leaves with the card (frame.anim.exit)`,
        )
      let extents: { start: number; end: number }[] = []
      try {
        extents = segmentOutputExtents(doc as unknown as ProjectDoc)
      } catch {
        extents = []
      }
      for (
        let i = 0;
        i + 1 < segs.length && extents.length === segs.length;
        i++
      ) {
        const cap =
          Math.min(
            extents[i].end - extents[i].start,
            extents[i + 1].end - extents[i + 1].start,
          ) / 2
        const exitS = transitionSeconds(exitOf(anims[i]))
        const enterS = transitionSeconds(enterOf(anims[i + 1]))
        if (exitS > cap + EPS)
          problems.push(
            `segments[${i}].anim.exit: ${exitS}s is longer than half the shorter clip at that boundary (${cap.toFixed(2)}s); the clip must be seen still before it moves`,
          )
        if (enterS > cap + EPS)
          problems.push(
            `segments[${i + 1}].anim.enter: ${enterS}s is longer than half the shorter clip at that boundary (${cap.toFixed(2)}s); the clip must be seen still before it moves`,
          )
      }
    }
  }

  // --- speed spans ---
  const speed = entries(doc.speed)
  checkByMedia(speed, 'speed')
  for (const s of speed) {
    if (
      !isNum(s.rate) ||
      s.rate < SPEED_RATE_MIN - EPS ||
      s.rate > SPEED_RATE_MAX + EPS
    ) {
      problems.push(
        `${spanName('speed', s)}: rate=${String(s.rate)} out of range (${SPEED_RATE_MIN}..${SPEED_RATE_MAX})`,
      )
    }
  }

  if (recording) {
    // --- tilt spans (card pose regions — DEGREES, footage-anchored) ---
    if (doc.tilt !== undefined && !Array.isArray(doc.tilt)) {
      problems.push('tilt must be an array of spans')
    }
    const tilt = entries(doc.tilt)
    checkByMedia(tilt, 'tilt')
    for (const t of tilt) {
      const name = spanName('tilt', t)
      for (const ax of ['rx', 'ry'] as const) {
        const v = t[ax]
        if (!isNum(v) || v < -TILT_DEG_MAX || v > TILT_DEG_MAX) {
          problems.push(
            `${name}: ${ax}=${String(v)} — pose angles are DEGREES in -${TILT_DEG_MAX}..${TILT_DEG_MAX} (not radians, not fractions)`,
          )
        }
      }
      checkTransition(t, name, problems)
      if (isNum(t.rx) && isNum(t.ry) && Math.abs(t.rx) + Math.abs(t.ry) > 25) {
        warnings.push(
          `${name}: combined lean ${(Math.abs(t.rx) + Math.abs(t.ry)).toFixed(0)}° reads dramatic — the premium band is ±5..18° per axis`,
        )
      }
      if (
        t.source !== undefined &&
        t.source !== 'manual' &&
        t.source !== 'auto'
      ) {
        problems.push(`${name}: source must be 'manual' or 'auto'`)
      }
      if (
        isNum(t.in) &&
        isNum(t.out) &&
        t.out - t.in > 0 &&
        t.out - t.in < TILT_SPAN_MIN
      ) {
        warnings.push(
          `${name}: span ${(t.out - t.in).toFixed(2)}s is under the ${TILT_SPAN_MIN}s minimum the studio enforces (a pose needs ~0.9s ramps to settle)`,
        )
      }
    }
    if (
      doc.tiltStyle !== undefined &&
      !['off', 'subtle', 'medium', 'strong'].includes(doc.tiltStyle as string)
    ) {
      problems.push(
        `tiltStyle must be "off" | "subtle" | "medium" | "strong" (got ${String(doc.tiltStyle)})`,
      )
    }

    // --- rejected proposals ("not this one": a deleted auto span, kept) ---
    if (doc.rejected !== undefined && !Array.isArray(doc.rejected)) {
      problems.push('rejected must be an array of {id, lane, in, out}')
    }
    for (const r of entries(doc.rejected)) {
      const name = spanName('rejected', r)
      if (!['zoom', 'tilt', 'speed'].includes(r.lane as string)) {
        problems.push(
          `${name}: lane must be "zoom" | "tilt" | "speed" (got ${String(r.lane)})`,
        )
      }
      if (!isNum(r.in) || !isNum(r.out) || r.out <= r.in) {
        problems.push(`${name}: needs SOURCE seconds in < out`)
      } else if (r.in >= duration) {
        problems.push(
          `${name}: starts at ${r.in}s, past the footage (${duration.toFixed(2)}s) — nothing to reject there`,
        )
      }
    }

    // --- cam pose spans (MO: animated cam layouts — fractions, footage-anchored) ---
    if (doc.camMotion !== undefined && !Array.isArray(doc.camMotion)) {
      problems.push('camMotion must be an array of spans')
    }
    const camMotion = entries(doc.camMotion)
    checkByMedia(camMotion, 'camMotion')
    if (camMotion.length && typeof source.camKey !== 'string') {
      warnings.push(
        'camMotion has spans but the take has no cam track (source.camKey) — nothing renders them',
      )
    }
    for (const m of camMotion) {
      const name = spanName('camMotion', m)
      for (const axis of ['x', 'y'] as const) {
        const v = m[axis]
        if (v !== undefined && (!isNum(v) || v < 0 || v > 1)) {
          problems.push(
            `${name}: ${axis}=${String(v)} — the bubble center is FRACTIONS of the frame [0..1] (the zoom cx/cy convention), not pixels`,
          )
        }
      }
      if (
        m.size !== undefined &&
        (!isNum(m.size) ||
          m.size < CAM_SIZE_MIN - EPS ||
          m.size > CAM_SIZE_MAX + EPS)
      ) {
        problems.push(
          `${name}: size=${String(m.size)} must be a fraction of the frame height in ${CAM_SIZE_MIN}..${CAM_SIZE_MAX}`,
        )
      }
      checkTransition(m, name, problems)
      if (m.x === undefined && m.y === undefined && m.size === undefined) {
        warnings.push(
          `${name}: no pose fields (x/y/size) — the span inherits the rest pose and changes nothing`,
        )
      }
      if (
        m.source !== undefined &&
        m.source !== 'manual' &&
        m.source !== 'auto'
      ) {
        problems.push(`${name}: source must be 'manual' or 'auto'`)
      }
      if (
        isNum(m.in) &&
        isNum(m.out) &&
        m.out - m.in > 0 &&
        m.out - m.in < CAM_SPAN_MIN
      ) {
        warnings.push(
          `${name}: span ${(m.out - m.in).toFixed(2)}s is under the ${CAM_SPAN_MIN}s minimum the studio enforces (a move needs its ~0.65s ramp to settle)`,
        )
      }
    }
  }

  // --- audio clips (OUTPUT-anchored) ---
  for (const a of entries(doc.audio)) {
    const name = `audio ${typeof a.id === 'string' ? a.id : `@${String(a.start)}`}`
    if (!isNum(a.start) || a.start < -EPS)
      problems.push(`${name}: start must be ≥ 0 (OUTPUT seconds)`)
    if (!isNum(a.in) || !isNum(a.out) || a.out - a.in <= 0) {
      problems.push(
        `${name}: in/out must be a positive span within the source file`,
      )
    }
    if (a.gain !== undefined && (!isNum(a.gain) || a.gain < 0 || a.gain > 1)) {
      problems.push(`${name}: gain must be 0..1`)
    }
  }

  if (recording) {
    // --- background media (frame.backgroundMedia) ---
    const frame = isObj(doc.frame) ? doc.frame : undefined
    const bgm =
      frame && isObj(frame.backgroundMedia) ? frame.backgroundMedia : undefined
    if (bgm) {
      if (bgm.kind !== 'video' && bgm.kind !== 'image') {
        problems.push(
          `frame.backgroundMedia.kind must be "video" or "image" (got ${String(bgm.kind)})`,
        )
      }
      if (typeof bgm.key !== 'string' || bgm.key.length === 0) {
        problems.push(
          'frame.backgroundMedia.key must be a non-empty URL or take-dir file (e.g. "/bg.webm")',
        )
      }
      if (
        bgm.dim !== undefined &&
        (!isNum(bgm.dim) || bgm.dim < 0 || bgm.dim > 1)
      ) {
        problems.push(
          `frame.backgroundMedia.dim must be 0..1 (got ${String(bgm.dim)})`,
        )
      }
      if (bgm.kind === 'video') {
        if (bgm.duration === undefined) {
          // A video background with no duration can't compute its modulo loop —
          // it would freeze on the first frame.
          warnings.push(
            'frame.backgroundMedia: a video background has no `duration` — the loop needs it (bgT = t % duration), else it freezes',
          )
        } else if (!isNum(bgm.duration) || bgm.duration <= 0) {
          problems.push(
            `frame.backgroundMedia.duration must be > 0 for a video background (got ${String(bgm.duration)})`,
          )
        }
      }
    }

    // --- frame depth dials (V2) ---
    if (frame) {
      for (const k of ['parallax'] as const) {
        const v = frame[k]
        if (v !== undefined && (!isNum(v) || v < 0 || v > 1)) {
          problems.push(`frame.${k} must be 0..1 (got ${String(v)})`)
        }
      }
    }

    // --- cover fit: fit is a closed pair, focus normalized fractions ---
    if (frame) {
      const fit = frame.fit
      if (fit !== undefined && fit !== 'contain' && fit !== 'cover') {
        problems.push(
          `frame.fit must be "contain" or "cover" (got ${String(fit)})`,
        )
      }
      const focus = frame.focus
      if (focus !== undefined) {
        if (!isObj(focus)) {
          problems.push('frame.focus must be { cx, cy } in 0..1')
        } else {
          for (const k of ['cx', 'cy'] as const) {
            const v = focus[k]
            if (v !== undefined && (!isNum(v) || v < 0 || v > 1)) {
              problems.push(
                `frame.focus.${k} must be a normalized video fraction 0..1 (got ${String(v)}) — the zoom cx/cy convention, never pixels`,
              )
            }
          }
        }
        if (fit !== 'cover') {
          warnings.push(
            'frame.focus only acts under frame.fit: "cover" (contain ignores it)',
          )
        }
      }
    }

    // --- the card stroke: a switch (alpha) with a width and a colour ---
    // ON_FRAME falls back to the 1.5px white hairline for a width it cannot
    // use, so an out-of-range number would render as the default and read as
    // "the field was ignored". Say so here instead.
    if (frame) {
      const bw = frame.borderWidth
      if (bw !== undefined && (!isNum(bw) || bw <= 0 || bw > 24)) {
        problems.push(
          `frame.borderWidth must be 0..24 design px (got ${String(bw)}); absent = the 1.5px hairline`,
        )
      }
      const bc = frame.borderColor
      if (bc !== undefined && (typeof bc !== 'string' || !bc.trim())) {
        problems.push(
          `frame.borderColor must be a CSS colour string (got ${String(bc)}); absent = #ffffff`,
        )
      }
      if ((bw !== undefined || bc !== undefined) && !frame.border) {
        problems.push(
          'frame.borderWidth/borderColor are set but frame.border is 0 — border is the switch AND the alpha, so nothing is drawn',
        )
      }
      // The border grows OUTWARD from the card's edge, into the padding ring,
      // and the frame crops whatever reaches past its own edge — so a border
      // wider than the padding renders cropped flat where the card meets the
      // frame (at padding 0, not at all on that axis). The doc still renders,
      // so this is honesty, not breakage.
      // --- the second shadow layer and its colour ---
      const sc = frame.shadowContact
      if (sc !== undefined && (!isNum(sc) || sc < 0 || sc > 1)) {
        problems.push(
          `frame.shadowContact must be 0..1 (got ${String(sc)}); absent = no contact layer`,
        )
      }
      const shc = frame.shadowColor
      if (shc !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(shc))) {
        problems.push(
          `frame.shadowColor must be a #rrggbb hex (got ${String(shc)}); absent = black`,
        )
      }
      // --- the entrance and the crop that follows the camera ---
      const ent = frame.entrance
      if (ent !== undefined) {
        warnings.push(
          'frame.entrance is a legacy spelling; write frame.anim.enter',
        )
        const kinds = ['tilt-in', 'pull-out', 'rise', 'none']
        if (
          typeof ent !== 'object' ||
          ent === null ||
          !kinds.includes(String((ent as { kind?: unknown }).kind))
        ) {
          problems.push(
            `frame.entrance.kind must be one of ${kinds.join(' | ')} (got ${JSON.stringify(ent)})`,
          )
        } else {
          const secs = (ent as { seconds?: unknown }).seconds
          if (secs !== undefined && (!isNum(secs) || secs < 0.2 || secs > 3)) {
            problems.push(
              `frame.entrance.seconds must be 0.2..3 (got ${String(secs)}); absent = 1.2`,
            )
          }
        }
      }
      lintAnim(
        'frame',
        frame.anim,
        {
          enter: CARD_ENTER_KINDS,
          exit: CARD_EXIT_KINDS,
          idle: null,
          words: false,
        },
        problems,
      )
      if (frame.focusFollow !== undefined && frame.focusFollow !== 'camera') {
        problems.push(
          `frame.focusFollow must be "camera" (got ${String(frame.focusFollow)}); it reads under fit: cover only`,
        )
      }
      // --- per-side placement: fractions, a negative side bleeds ---
      const ins = frame.inset
      if (ins !== undefined) {
        if (typeof ins !== 'object' || ins === null || Array.isArray(ins)) {
          problems.push(
            'frame.inset must be an object of {top, right, bottom, left} fractions',
          )
        } else {
          const sides = ins as Record<string, unknown>
          for (const side of ['top', 'right', 'bottom', 'left']) {
            const v = sides[side]
            if (v !== undefined && (!isNum(v) || v < -2 || v > 0.9)) {
              problems.push(
                `frame.inset.${side} must be a fraction of the frame in -2..0.9 (got ${String(v)}); negative bleeds the card past the edge`,
              )
            }
          }
          const l = isNum(sides.left) ? sides.left : 0
          const r = isNum(sides.right) ? sides.right : 0
          const t = isNum(sides.top) ? sides.top : 0
          const b = isNum(sides.bottom) ? sides.bottom : 0
          if (l + r >= 1 || t + b >= 1) {
            problems.push(
              `frame.inset leaves no room for the card (left+right ${l + r}, top+bottom ${t + b}; each pair must stay under 1)`,
            )
          }
        }
      }
      const ebw = isNum(bw) && bw > 0 && bw <= 24 ? bw : 1.5
      const pad = isNum(frame.padding) ? frame.padding : 0
      if (frame.border && ebw > pad && ins === undefined) {
        warnings.push(
          `frame.borderWidth (${ebw}) is wider than frame.padding (${pad}) — the border grows outward from the card, so the frame edge crops it; raise the padding to at least the width to show the whole stroke`,
        )
      }
    }
    if (
      bgm &&
      bgm.blur !== undefined &&
      (!isNum(bgm.blur) || bgm.blur < 0 || bgm.blur > 100)
    ) {
      problems.push(
        `frame.backgroundMedia.blur must be 0..100 design px (got ${String(bgm.blur)})`,
      )
    }

    // --- removed fields (decided 2026-08-03) ---
    // The card's static pose and its V2 effects are gone: a lean is a tilt SPAN
    // on the timeline, nothing else poses the card. Say so instead of ignoring
    // the field, or a doc written against the old schema renders silently
    // without what it asked for.
    if (doc.card !== undefined) {
      problems.push(
        'card was removed — lean the card with tilt spans (doc.tilt); entrance/exit/float/effect are gone',
      )
    }
    if (frame && frame.vignette !== undefined) {
      problems.push('frame.vignette was removed')
    }
  }

  // --- overlays (compositor v2 V1: text clips, OUTPUT-anchored) ---
  const overlays = Array.isArray(doc.overlays) ? doc.overlays : undefined
  if (doc.overlays !== undefined && !overlays) {
    problems.push('overlays must be an array of clips')
  }
  const TRANSITIONS = ['none', 'fade', 'rise']
  const PRESETS = ['title', 'caption', 'label']
  for (let i = 0; i < (overlays?.length ?? 0); i++) {
    const o = overlays![i]
    const name = `overlays[${i}]`
    if (!isObj(o)) {
      problems.push(`${name} must be an object`)
      continue
    }
    if (
      o.kind !== 'text' &&
      o.kind !== 'image' &&
      o.kind !== 'video' &&
      o.kind !== 'html'
    ) {
      problems.push(
        `${name}.kind must be "text" | "image" | "video" | "html" (got ${String(o.kind)})`,
      )
    }
    if (!isNum(o.start) || o.start < 0)
      problems.push(`${name}.start must be ≥ 0 (OUTPUT seconds)`)
    if (!isNum(o.duration) || o.duration <= 0) {
      problems.push(`${name}.duration must be > 0 (seconds)`)
    }
    if (o.kind === 'text') {
      if (typeof o.text !== 'string')
        problems.push(`${name}.text must be a string`)
      if (typeof o.preset === 'string' && !PRESETS.includes(o.preset)) {
        warnings.push(
          `${name}.preset "${String(o.preset)}" is not a known preset (${PRESETS.join('|')}) — falls back to "title"`,
        )
      }
      if (
        o.size !== undefined &&
        (!isNum(o.size) || o.size < 12 || o.size > 200)
      ) {
        problems.push(`${name}.size must be design px in 12..200`)
      }
      if (o.family !== undefined) {
        if (typeof o.family !== 'string' || o.family.length === 0) {
          problems.push(`${name}.family must be a font family name`)
        } else if (!findFontFamily(o.family)) {
          warnings.push(
            `${name}.family "${String(o.family)}" is not in the hosted catalog (GET https://vos.so/api/fonts) — the render fleet falls back to the preset font`,
          )
        }
      }
      if (
        o.weight !== undefined &&
        (!isNum(o.weight) || o.weight < 100 || o.weight > 900)
      ) {
        problems.push(`${name}.weight must be a CSS weight in 100..900`)
      }
      if (
        o.align !== undefined &&
        !['left', 'center', 'right'].includes(o.align as string)
      ) {
        problems.push(`${name}.align must be left|center|right`)
      }
      if (
        o.letterSpacing !== undefined &&
        (!isNum(o.letterSpacing) ||
          o.letterSpacing < -10 ||
          o.letterSpacing > 60)
      ) {
        problems.push(`${name}.letterSpacing must be design px in -10..60`)
      }
      if (
        o.lineHeight !== undefined &&
        (!isNum(o.lineHeight) || o.lineHeight < 0.8 || o.lineHeight > 3)
      ) {
        problems.push(`${name}.lineHeight must be a multiplier in 0.8..3`)
      }
      if (o.stroke !== undefined) {
        const rawStroke: unknown = o.stroke
        if (
          typeof rawStroke !== 'object' ||
          rawStroke === null ||
          Array.isArray(rawStroke)
        ) {
          problems.push(`${name}.stroke must be an object { color, width }`)
        } else {
          const sk = rawStroke as Record<string, unknown>
          if (typeof sk.color !== 'string' || sk.color.length === 0) {
            problems.push(`${name}.stroke.color must be a CSS color string`)
          }
          if (!isNum(sk.width) || sk.width < 0.5 || sk.width > 40) {
            problems.push(`${name}.stroke.width must be design px in 0.5..40`)
          }
        }
      }
      if (o.box !== undefined) {
        const raw: unknown = o.box
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          problems.push(`${name}.box must be an object { color, … }`)
        } else {
          const bx = raw as Record<string, unknown>
          if (typeof bx.color !== 'string' || bx.color.length === 0) {
            problems.push(`${name}.box.color must be a CSS color string`)
          }
          if (
            bx.opacity !== undefined &&
            (!isNum(bx.opacity) || bx.opacity < 0 || bx.opacity > 1)
          ) {
            problems.push(`${name}.box.opacity must be in 0..1`)
          }
          for (const k of ['paddingX', 'paddingY', 'radius'] as const) {
            const v = bx[k]
            if (v !== undefined && (!isNum(v) || v < 0 || v > 4)) {
              problems.push(
                `${name}.box.${k} must be EMs of the font size in 0..4`,
              )
            }
          }
        }
      }
      if (
        o.maxWidth !== undefined &&
        (!isNum(o.maxWidth) || o.maxWidth < 0.1 || o.maxWidth > 1)
      ) {
        problems.push(
          `${name}.maxWidth must be a FRACTION of the frame width in 0.1..1 (wrap budget; absent = no wrapping)`,
        )
      }
      // TX6 entrance animation: fx owns the entrance when present (`enter`
      // is ignored); exit stays clip-level. Pure f(t) — segmentation and
      // timing are baked at lowering.
      if (o.fx !== undefined) {
        if (!isObj(o.fx)) {
          problems.push(
            `${name}.fx must be { fx, unit?, direction?, stagger?, duration? }`,
          )
        } else {
          const fx = o.fx
          const FX_KINDS = ['fade', 'rise', 'pop', 'blur', 'typewriter']
          const FX_UNITS = ['block', 'line', 'word', 'char']
          const FX_DIRS = ['forward', 'reverse', 'center']
          if (typeof fx.fx !== 'string' || !FX_KINDS.includes(fx.fx)) {
            problems.push(
              `${name}.fx.fx must be ${FX_KINDS.join('|')} (got ${String(fx.fx)})`,
            )
          }
          if (
            fx.unit !== undefined &&
            (typeof fx.unit !== 'string' || !FX_UNITS.includes(fx.unit))
          ) {
            problems.push(`${name}.fx.unit must be ${FX_UNITS.join('|')}`)
          }
          if (
            fx.direction !== undefined &&
            (typeof fx.direction !== 'string' ||
              !FX_DIRS.includes(fx.direction))
          ) {
            problems.push(`${name}.fx.direction must be ${FX_DIRS.join('|')}`)
          }
          if (
            fx.stagger !== undefined &&
            (!isNum(fx.stagger) || fx.stagger < 0 || fx.stagger > 2)
          ) {
            problems.push(
              `${name}.fx.stagger must be seconds between unit starts in 0..2`,
            )
          }
          if (
            fx.duration !== undefined &&
            (!isNum(fx.duration) || fx.duration < 0.05 || fx.duration > 2)
          ) {
            problems.push(`${name}.fx.duration must be seconds in 0.05..2`)
          }
          if (
            fx.fx === 'typewriter' &&
            (fx.unit === undefined || fx.unit === 'block')
          ) {
            warnings.push(
              `${name}.fx: typewriter with unit "block" reveals everything at once — unit "char" or "word" is its nature`,
            )
          }
          if (o.enter !== undefined && o.enter !== 'none') {
            warnings.push(
              `${name}: fx owns the entrance — the "enter" transition is ignored while fx is set`,
            )
          }
        }
      }
    }
    if (o.kind === 'image' || o.kind === 'video') {
      if (o.fx !== undefined) {
        problems.push(`${name}.fx is text-only (media clips have enter/exit)`)
      }
      // A layer that shows a document media: the reference must name one
      // (`media:` alone is the primary), and its card carries card fields.
      if (typeof o.key === 'string' && o.key.startsWith('media:')) {
        const ref = o.key.slice('media:'.length)
        const ids = new Set(
          (Array.isArray((doc as { media?: unknown }).media)
            ? ((doc as { media: unknown[] }).media as { id?: unknown }[])
            : []
          ).map((m) => (typeof m.id === 'string' ? m.id : '')),
        )
        if (ref !== '' && !ids.has(ref))
          problems.push(
            `${name}.key names media "${ref}", which is not one of media[].id (media: alone is the primary)`,
          )
      }
      const lcf = (o as { frame?: unknown }).frame
      if (lcf !== undefined) {
        if (!isObj(lcf)) {
          problems.push(`${name}.frame must be an object (the layer's card)`)
        } else {
          const LCF = [
            'browserBar',
            'lean',
            'shadow',
            'shadowContact',
            'shadowColor',
            'cursor',
          ]
          for (const k of Object.keys(lcf))
            if (!LCF.includes(k))
              problems.push(
                `${name}.frame.${k}: not a layer card field (${LCF.join(', ')})`,
              )
          const lean = (lcf as { lean?: unknown }).lean
          if (
            lean !== undefined &&
            (!isObj(lean) ||
              !isNum((lean as { rx?: unknown }).rx) ||
              !isNum((lean as { ry?: unknown }).ry))
          )
            problems.push(`${name}.frame.lean must be { rx, ry } in degrees`)
        }
      }
      if (typeof o.key !== 'string' || o.key.length === 0) {
        problems.push(
          `${name}.key must be a non-empty media URL or take-dir file (e.g. "/logo.png")`,
        )
      }
      if (
        o.width !== undefined &&
        (!isNum(o.width) || o.width <= 0 || o.width > 1)
      ) {
        problems.push(
          `${name}.width must be a fraction of the frame width in (0..1] (got ${String(o.width)})`,
        )
      }
      if (o.radius !== undefined && (!isNum(o.radius) || o.radius < 0)) {
        problems.push(`${name}.radius must be ≥ 0 design px`)
      }
      if (
        o.opacity !== undefined &&
        (!isNum(o.opacity) || o.opacity < 0 || o.opacity > 1)
      ) {
        problems.push(`${name}.opacity must be 0..1`)
      }
    }
    if (o.kind === 'html') {
      // An HTML layer keeps its SOURCE: markup and CSS laid out in a design
      // box, rasterized in the page. The XML rules, the wall clock, the
      // faces and the media fields it refuses are the pure gate's
      // (`htmlLayerProblems`), the same words the studio panel shows.
      if (typeof o.html !== 'string') {
        problems.push(`${name}.html must be the layer's markup (a string)`)
      }
      if (o.css !== undefined && typeof o.css !== 'string') {
        problems.push(`${name}.css must be a string of CSS`)
      }
      const box = isObj(o.box) ? o.box : undefined
      if (
        !box ||
        !isNum(box.width) ||
        !isNum(box.height) ||
        box.width <= 0 ||
        box.height <= 0
      ) {
        problems.push(
          `${name}.box must be { width, height } in design px, both > 0 (the 1080p frame is 1920 wide)`,
        )
      }
      if (o.bleed !== undefined && (!isNum(o.bleed) || o.bleed < 0)) {
        problems.push(
          `${name}.bleed must be ≥ 0 design px (absent = derived from the CSS's shadows)`,
        )
      }
      if (o.fonts !== undefined) {
        if (!Array.isArray(o.fonts)) {
          problems.push(
            `${name}.fonts must be an array of { family, url, weight?, style? }`,
          )
        } else {
          o.fonts.forEach((f, fi) => {
            if (
              !isObj(f) ||
              typeof f.family !== 'string' ||
              typeof f.url !== 'string' ||
              !/^https?:\/\//.test(f.url)
            )
              problems.push(
                `${name}.fonts[${fi}] must be { family, url (https), weight?, style? }: a face the catalog does not host. A hosted family needs no entry; name it in the CSS`,
              )
          })
        }
      }
      if (
        o.width !== undefined &&
        (!isNum(o.width) || o.width <= 0 || o.width > 1)
      ) {
        problems.push(
          `${name}.width must be a fraction of the frame width in (0..1] (got ${String(o.width)}; absent = the design size)`,
        )
      }
      if (
        o.opacity !== undefined &&
        (!isNum(o.opacity) || o.opacity < 0 || o.opacity > 1)
      ) {
        problems.push(`${name}.opacity must be 0..1`)
      }
      if (typeof o.html === 'string') {
        for (const p of htmlLayerProblems(o as never)) {
          ;(p.level === 'problem' ? problems : warnings).push(
            `${name}: ${p.message}`,
          )
        }
      }
    }
    const tf = isObj(o.transform) ? o.transform : undefined
    if (!tf) {
      problems.push(
        `${name}.transform must be { x, y, scale, rotation } — x/y are FRACTIONS of the frame [0..1] (0.5/0.5 = center; the zoom cx/cy convention), aspect-stable`,
      )
    } else {
      if (!isNum(tf.x) || !isNum(tf.y)) {
        problems.push(
          `${name}.transform.x/y must be numbers (frame fractions [0..1])`,
        )
      } else {
        // The cx/cy pixel trap: coords are FRACTIONS, not pixels.
        if (Math.abs(tf.x) > 2 || Math.abs(tf.y) > 2) {
          problems.push(
            `${name}.transform.x/y look like PIXELS (${String(tf.x)}, ${String(tf.y)}) — they are FRACTIONS of the frame [0..1] (center = 0.5/0.5, lower-third y ≈ 0.82)`,
          )
        } else if (tf.x < -0.1 || tf.x > 1.1 || tf.y < -0.1 || tf.y > 1.1) {
          warnings.push(
            `${name}.transform.x/y (${String(tf.x)}, ${String(tf.y)}) sit outside the frame [0..1] — the clip may be partly or fully invisible`,
          )
        }
      }
      if (tf.scale !== undefined && (!isNum(tf.scale) || tf.scale <= 0)) {
        problems.push(`${name}.transform.scale must be > 0`)
      }
      if (tf.rotation !== undefined && !isNum(tf.rotation)) {
        problems.push(`${name}.transform.rotation must be degrees (number)`)
      }
    }
    for (const key of ['enter', 'exit'] as const) {
      const v = o[key]
      if (
        v !== undefined &&
        (typeof v !== 'string' || !TRANSITIONS.includes(v))
      ) {
        problems.push(`${name}.${key} must be one of ${TRANSITIONS.join('|')}`)
      }
    }
    if (o.enter !== undefined || o.exit !== undefined || o.fx !== undefined)
      warnings.push(
        `${name}: enter, exit and fx are legacy spellings; write anim.enter / anim.exit`,
      )
    lintAnim(
      name,
      o.anim,
      o.kind === 'text'
        ? {
            enter: TEXT_ENTER_KINDS,
            exit: TEXT_EXIT_KINDS,
            idle: null,
            words: true,
          }
        : {
            enter: MEDIA_ENTER_KINDS,
            exit: MEDIA_EXIT_KINDS,
            idle: null,
            words: false,
          },
      problems,
    )
    lintFrom(name, o.from, problems)
    // Pose keyframes: clip-local, fractions, opacity as a multiplier.
    if (o.motion !== undefined) {
      if (!Array.isArray(o.motion)) {
        problems.push(`${name}.motion must be an array of poses`)
      } else {
        const clipDur = isNum(o.duration) ? o.duration : 0
        o.motion.filter(isObj).forEach((p, pi) => {
          const pn = `${name}.motion[${pi}]`
          if (!isNum(p.at) || p.at < -EPS) {
            problems.push(
              `${pn}.at must be ≥ 0 CLIP-LOCAL seconds (0 = the clip's start; poses ride along when the clip moves)`,
            )
          } else if (clipDur > 0 && p.at > clipDur + EPS) {
            warnings.push(
              `${pn}.at=${String(p.at)}s is past the clip's ${clipDur.toFixed(2)}s duration (clamped to the end)`,
            )
          }
          for (const axis of ['x', 'y'] as const) {
            const v = p[axis]
            if (v === undefined) continue
            if (!isNum(v)) {
              problems.push(`${pn}.${axis} must be a number (frame fraction)`)
            } else if (Math.abs(v) > 2) {
              problems.push(
                `${pn}.${axis} looks like PIXELS (${String(v)}) — pose coords are FRACTIONS of the frame [0..1], the transform.x/y convention`,
              )
            }
          }
          if (p.scale !== undefined && (!isNum(p.scale) || p.scale <= 0)) {
            problems.push(`${pn}.scale must be > 0`)
          }
          if (p.rotation !== undefined && !isNum(p.rotation)) {
            problems.push(`${pn}.rotation must be degrees (number)`)
          }
          if (
            p.opacity !== undefined &&
            (!isNum(p.opacity) || p.opacity < 0 || p.opacity > 1)
          ) {
            problems.push(
              `${pn}.opacity must be 0..1 (a multiplier on the clip's alpha)`,
            )
          }
        })
      }
    }
  }

  // --- object clips (V3 — the drafted V4 spec) ---
  const objects = Array.isArray(doc.objects) ? doc.objects : undefined
  if (doc.objects !== undefined && !objects)
    problems.push('objects must be an array of clips')
  const SHAPES = ['cube', 'sphere', 'torus', 'knot']
  const T3_MATERIALS = ['standard', 'metal', 'glass', 'neon']
  for (let i = 0; i < (objects?.length ?? 0); i++) {
    const o = objects![i]
    const name = `objects[${i}]`
    if (!isObj(o)) {
      problems.push(`${name} must be an object`)
      continue
    }
    const asset = isObj(o.asset) ? o.asset : undefined
    if (!asset)
      problems.push(
        `${name}.asset must be { kind: "primitive", shape } | { kind: "gltf", key } | { kind: "text3d", text }`,
      )
    else if (asset.kind === 'primitive') {
      if (typeof asset.shape !== 'string' || !SHAPES.includes(asset.shape)) {
        problems.push(`${name}.asset.shape must be one of ${SHAPES.join('|')}`)
      }
    } else if (asset.kind === 'gltf') {
      if (typeof asset.key !== 'string' || !asset.key)
        problems.push(
          `${name}.asset.key must be a non-empty URL/file (e.g. "/model.glb")`,
        )
    } else if (asset.kind === 'text3d') {
      // TX7: extruded text from the hosted typeface catalog. Materials are
      // preset names only — the fleet-audited set (single-sided, no
      // dispersion); depth is a fraction of the glyph height.
      if (typeof asset.text !== 'string' || !asset.text.trim())
        problems.push(`${name}.asset.text must be a non-empty string`)
      if (asset.typeface !== undefined) {
        if (typeof asset.typeface !== 'string')
          problems.push(`${name}.asset.typeface must be a string`)
        else if (!findTypeface(asset.typeface))
          warnings.push(
            `${name}.asset.typeface "${asset.typeface}" is not in the 3D typeface catalog — falls back to the house face (${TYPEFACE_CATALOG.map((t) => t.family).join(', ')})`,
          )
      }
      if (
        asset.material !== undefined &&
        !T3_MATERIALS.includes(asset.material as string)
      ) {
        problems.push(
          `${name}.asset.material must be ${T3_MATERIALS.join('|')}`,
        )
      }
      if (
        asset.depth !== undefined &&
        (!isNum(asset.depth) || asset.depth < 0.02 || asset.depth > 1)
      ) {
        problems.push(
          `${name}.asset.depth must be a fraction of the glyph height in 0.02..1`,
        )
      }
      if (asset.bevel !== undefined && typeof asset.bevel !== 'boolean')
        problems.push(`${name}.asset.bevel must be a boolean`)
    } else
      problems.push(
        `${name}.asset.kind must be "primitive" | "gltf" | "text3d"`,
      )
    const tf = isObj(o.transform3d) ? o.transform3d : undefined
    if (!tf)
      problems.push(
        `${name}.transform3d must be { x, y, z, rx, ry, rz, scale } — x/y are FRACTIONS of the frame [0..1], z = world units toward the camera, scale = fraction of frame height`,
      )
    else {
      if (!isNum(tf.x) || !isNum(tf.y))
        problems.push(
          `${name}.transform3d.x/y must be numbers (frame fractions [0..1])`,
        )
      else if (Math.abs(tf.x) > 2 || Math.abs(tf.y) > 2) {
        problems.push(
          `${name}.transform3d.x/y look like PIXELS (${String(tf.x)}, ${String(tf.y)}) — they are FRACTIONS of the frame (center = 0.5/0.5)`,
        )
      }
      if (tf.z !== undefined && (!isNum(tf.z) || tf.z < -2 || tf.z > 2.5))
        problems.push(
          `${name}.transform3d.z must be -2..2.5 world units (0 = the card plane; + toward camera)`,
        )
      if (
        tf.scale !== undefined &&
        (!isNum(tf.scale) || tf.scale <= 0 || tf.scale > 1)
      )
        problems.push(
          `${name}.transform3d.scale must be a fraction of the frame height in (0..1]`,
        )
    }
    const span = o.span
    if (span !== undefined) {
      if (
        !isObj(span) ||
        !isNum(span.start) ||
        span.start < 0 ||
        !isNum(span.duration) ||
        span.duration <= 0
      ) {
        problems.push(
          `${name}.span must be { start ≥ 0, duration > 0 } (OUTPUT seconds)`,
        )
      }
    }
    if (
      o.animation !== undefined &&
      o.animation !== null &&
      o.animation !== 'spin' &&
      o.animation !== 'float'
    ) {
      problems.push(`${name}.animation must be "spin" | "float" | null`)
    }
    if (o.animation !== undefined)
      warnings.push(`${name}.animation is a legacy spelling; write anim.idle`)
    lintAnim(
      name,
      o.anim,
      {
        enter: MEDIA_ENTER_KINDS,
        exit: MEDIA_EXIT_KINDS,
        idle: IDLE_KINDS,
        words: false,
      },
      problems,
    )
    lintFrom(name, o.from, problems)
    // Pose keyframes: clip-local over transform3d; presets compose.
    if (o.motion !== undefined) {
      if (!Array.isArray(o.motion)) {
        problems.push(`${name}.motion must be an array of poses`)
      } else {
        o.motion.filter(isObj).forEach((p, pi) => {
          const pn = `${name}.motion[${pi}]`
          if (!isNum(p.at) || p.at < -EPS) {
            problems.push(
              `${pn}.at must be ≥ 0 CLIP-LOCAL seconds (from the clip's span start)`,
            )
          }
          for (const axis of ['x', 'y'] as const) {
            const v = p[axis]
            if (v === undefined) continue
            if (!isNum(v)) {
              problems.push(`${pn}.${axis} must be a number (frame fraction)`)
            } else if (Math.abs(v) > 2) {
              problems.push(
                `${pn}.${axis} looks like PIXELS (${String(v)}) — pose coords are FRACTIONS of the frame [0..1]`,
              )
            }
          }
          if (p.z !== undefined && (!isNum(p.z) || p.z < -2 || p.z > 2.5)) {
            problems.push(`${pn}.z must be -2..2.5 world units`)
          }
          for (const ax of ['rx', 'ry', 'rz'] as const) {
            if (p[ax] !== undefined && !isNum(p[ax])) {
              problems.push(`${pn}.${ax} must be degrees (number)`)
            }
          }
          if (
            p.scale !== undefined &&
            (!isNum(p.scale) || p.scale <= 0 || p.scale > 1)
          ) {
            problems.push(
              `${pn}.scale must be a fraction of the frame height in (0..1]`,
            )
          }
        })
      }
    }
  }

  // --- export block ---
  if (isObj(doc.export)) {
    const resolution = doc.export.resolution as ExportResolution
    const validResolution = EXPORT_RESOLUTION_OPTIONS.includes(resolution)
    if (!validResolution) {
      problems.push(
        `export.resolution "${String(doc.export.resolution)}" invalid — one of: ${EXPORT_RESOLUTION_OPTIONS.join(' | ')}`,
      )
    }
    if (doc.export.fps !== 30 && doc.export.fps !== 60) {
      problems.push(
        `export.fps must be 30 or 60 (got ${String(doc.export.fps)})`,
      )
    }
    if (validResolution && isNum(meta.durationMs)) {
      const recommended = recommendedExportResolution(docIn as ProjectDoc)
      const want = EXPORT_RESOLUTION_OPTIONS.indexOf(resolution)
      const rec = EXPORT_RESOLUTION_OPTIONS.indexOf(recommended)
      if (want > rec) {
        const capW = isNum(meta.captureWidth) ? meta.captureWidth : meta.width
        warnings.push(
          `export.resolution "${resolution}" upscales the footage (capture is ${String(capW)}px wide — "${recommended}" matches the recording)`,
        )
      }
    }
  }

  if (recording)
    framingWarnings(docIn as ProjectDoc, doc, zoom, overlays ?? [], warnings)
  return { problems, warnings }
}

interface DownEvent {
  t: number
  rect: { x: number; y: number; w: number; h: number }
}

/** `down` events carrying a target rect, in seconds — the evidence. */
function clicksWithRects(source: Json): DownEvent[] {
  const cursor = Array.isArray(source.cursor) ? source.cursor : []
  const out: DownEvent[] = []
  for (const e of cursor) {
    if (!isObj(e) || e.type !== 'down' || !isNum(e.t) || !isObj(e.rect))
      continue
    const r = e.rect
    if (!isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h)) continue
    out.push({ t: e.t / 1000, rect: { x: r.x, y: r.y, w: r.w, h: r.h } })
  }
  return out
}

/**
 * The framing checks — advisory, never a problem, never a
 * throw: a zoom must contain what was clicked under it (the planner solves
 * this from the rect; a hand- or agent-written span is re-checked against
 * the same evidence), and a caption must not sit over the thing being
 * clicked. Both need a cursor track with rects; a browser-recorder take
 * has none and warns nothing.
 */
function framingWarnings(
  docIn: ProjectDoc,
  doc: Json,
  zoom: Json[],
  overlays: unknown[],
  warnings: string[],
): void {
  try {
    const source = isObj(doc.source) ? doc.source : {}
    const meta = isObj(source.meta) ? source.meta : {}
    const w = isNum(meta.width) ? meta.width : 0
    const h = isNum(meta.height) ? meta.height : 0
    if (!(w > 0) || !(h > 0)) return
    const clicks = clicksWithRects(source)
    if (!clicks.length) return
    const layout = docCardLayout(docIn)

    for (const z of zoom) {
      if (
        !isNum(z.in) ||
        !isNum(z.out) ||
        !isNum(z.level) ||
        !isNum(z.cx) ||
        !isNum(z.cy) ||
        z.level <= 1.001
      )
        continue
      const zin = z.in
      const zout = z.out
      const under = clicks.filter((c) => c.t >= zin && c.t <= zout)
      if (!under.length) continue
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const c of under) {
        x0 = Math.min(x0, c.rect.x / w)
        y0 = Math.min(y0, c.rect.y / h)
        x1 = Math.max(x1, (c.rect.x + c.rect.w) / w)
        y1 = Math.max(y1, (c.rect.y + c.rect.h) / h)
      }
      const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
      if (
        !zoomCoversRect({ level: z.level, cx: z.cx, cy: z.cy }, rect, layout)
      ) {
        warnings.push(
          `${spanName('zoom', z)}: points beside what was clicked at ${under[0].t.toFixed(1)}s — the target (center ${((x0 + x1) / 2).toFixed(2)}, ${((y0 + y1) / 2).toFixed(2)}) sits outside the visible window; move cx/cy toward it or lower the level`,
        )
      }
    }

    const rated = ratedSegments(docIn)
    const toFrame = (nx: number, ny: number) => ({
      x: (layout.dx + nx * layout.dw) / layout.W,
      y: (layout.dy + ny * layout.dh) / layout.H,
    })
    overlays.forEach((o, i) => {
      if (!isObj(o) || (o.kind !== undefined && o.kind !== 'text')) return
      const tf = isObj(o.transform) ? o.transform : null
      if (
        !tf ||
        !isNum(tf.x) ||
        !isNum(tf.y) ||
        !isNum(o.start) ||
        !isNum(o.duration)
      )
        return
      for (const c of clicks) {
        const out = spanOutputExtent(rated, c.t, c.t + 0.001)
        if (!out || out.start < o.start || out.start > o.start + o.duration)
          continue
        const a = toFrame(c.rect.x / w, c.rect.y / h)
        const b = toFrame((c.rect.x + c.rect.w) / w, (c.rect.y + c.rect.h) / h)
        if (tf.x >= a.x && tf.x <= b.x && tf.y >= a.y && tf.y <= b.y) {
          warnings.push(
            `overlays[${i}] sits over the thing being clicked at ${c.t.toFixed(1)}s (output ${out.start.toFixed(1)}s) — move it off the target`,
          )
          break
        }
      }
    })
  } catch {
    // Framing is advisory: a malformed doc is reported by the checks above.
  }
}
