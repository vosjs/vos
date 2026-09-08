/**
 * How the card MOVES and how a cut ENDS, as data the lowering already
 * understands: the card's `anim.enter` writes the head of the tilt or zoom
 * track and a card-pose track (scale, rise, opacity); its `anim.exit`
 * writes that track's tail; a FREEZE (`doc.freeze`, a source moment plus
 * output seconds; a legacy segment `hold` is one at the segment's end) is a
 * rated piece whose hair of source time plays for its seconds; and the output lasts
 * until the last visual clip ends, so an "end card" is nothing but a card
 * exit and clips placed after the footage. The two older spellings
 * (`frame.entrance`, `doc.endCard`) migrate here, on read, into exactly
 * that. Pure; ON_FRAME reads the tracks.
 */
import { sortKeyframes } from '@vosjs/timeline'
import type { Keyframe, KeyframeTrack, Segment } from '@vosjs/timeline'
import type {
  Anim,
  AnimStep,
  DocSegment,
  EndCard,
  FrameStyle,
  FreezeSpan,
  MediaOverlayClip,
  ObjectClip,
  OverlayClip,
  ProjectDoc,
  TextOverlayClip,
} from '../types'
import { resolveExportSize } from '../types'
import { animStep, enterOf, exitOf, lastLayerEnd } from '../anim'
import { splitBySpeed, totalDuration } from '@vosjs/timeline'

/**
 * THE REST of a take: the one output time its still is taken at, where
 * the LAST freeze begins — the composed frame before nothing moves (a
 * poster ends on one). Null when the take has no freeze on kept footage.
 * One convention for every still-taking surface (an export, a thumbnail,
 * a kit), so they agree. Reads a legacy segment `hold` as the freeze it
 * migrates to, and a raw hosted payload (no `segments`, no `source`) as
 * what it has. A legacy end card yields null: its words rise over a
 * receding card, which is footage under a fading title, not a poster.
 */
export function docRestTime(doc: ProjectDoc): number | null {
  if (doc.endCard) return null
  const freezes = docFreezes(doc)
  if (!freezes.length) return null
  const segs = docSegmentsOf(doc)
  const marks = freezeOutputExtents(
    splitBySpeed(segs, doc.speed ?? []),
    freezes,
  )
  let rest: number | null = null
  for (const m of marks.values()) if (rest === null || m.t > rest) rest = m.t
  if (rest === null || !(rest >= 0)) return null
  return Math.round(rest * 1000) / 1000
}

/** The doc's kept spans in explicit form; a raw payload with none is untrimmed. */
function docSegmentsOf(doc: ProjectDoc): DocSegment[] {
  const segs = Array.isArray(doc.segments) ? doc.segments : []
  if (segs.length) return segs
  const ms = doc.source?.meta?.durationMs
  return [{ in: 0, out: typeof ms === 'number' ? ms / 1000 : 0 }]
}

/**
 * Every freeze the document carries, the spelled ones and the legacy
 * segment holds (as a freeze at that segment's `out`, id `h{i}`), sorted
 * by source moment. The one read every consumer takes, so an unmigrated
 * document freezes exactly where a migrated one does.
 */
export function docFreezes(
  doc: Pick<ProjectDoc, 'freeze' | 'segments'>,
): FreezeSpan[] {
  const own = Array.isArray(doc.freeze) ? doc.freeze : []
  const legacy = legacyHoldFreezes(
    Array.isArray(doc.segments) ? doc.segments : [],
  )
  const all = [...own, ...legacy].filter(
    (f) =>
      typeof f.at === 'number' &&
      Number.isFinite(f.at) &&
      typeof f.seconds === 'number' &&
      f.seconds > 0,
  )
  return all.sort((a, b) => a.at - b.at)
}

/** A legacy segment `hold` as the freeze it migrates to. */
function legacyHoldFreezes(segments: readonly DocSegment[]): FreezeSpan[] {
  const out: FreezeSpan[] = []
  segments.forEach((s, i) => {
    const hold = s.hold
    if (typeof hold === 'number' && hold > 0)
      out.push({ id: `h${i}`, at: s.out, seconds: hold })
  })
  return out
}

/** The card entrance's default length, seconds. */
export const ENTRANCE_SECONDS = 1.2
/** The legacy end card's default length, seconds. */
export const END_CARD_SECONDS = 2.5
/** How long the card takes to recede (the `recede` exit's house length). */
export const END_CARD_RECEDE = 0.7
/** The `fade` exit's house length. */
export const CARD_FADE_SECONDS = 0.35
/** The tilt-in's opening pose, degrees: top edge away, left edge toward. */
export const TILT_IN_POSE: [number, number] = [-9, 14]
/** The pull-out's opening zoom level. */
export const PULL_OUT_LEVEL = 1.32
/** The legacy marker a migrated end card's clips carry as `from`. */
export const END_CARD_FROM = 'endcard'

const HOLD_SOURCE_SPAN = 0.002

/** A step with a kind and optional seconds: the card's, or a legacy entrance. */
type Step = { kind: string; seconds?: number } | null | undefined

/** The card's enter step, from its `anim` (a migrated doc carries nothing else). */
export function cardEnter(frame: Pick<FrameStyle, 'anim'>): AnimStep | null {
  return enterOf(frame.anim)
}

/** The card's exit step, from its `anim`. */
export function cardExit(frame: Pick<FrameStyle, 'anim'>): AnimStep | null {
  return exitOf(frame.anim)
}

export function entranceSeconds(e: Step): number {
  if (!e || e.kind === 'none') return 0
  return Math.max(0.2, Math.min(3, e.seconds ?? ENTRANCE_SECONDS))
}

/** The exit's length: its own seconds, else the house length of its kind. */
export function exitSeconds(e: Step): number {
  if (!e || e.kind === 'none') return 0
  const house = e.kind === 'fade' ? CARD_FADE_SECONDS : END_CARD_RECEDE
  return Math.max(0.1, Math.min(3, e.seconds ?? house))
}

/** A freeze's place on the output timeline (its start and its seconds). */
export interface FreezeExtent {
  t: number
  duration: number
}

/**
 * The rated pieces with every freeze placed: at a freeze's source moment
 * the piece holding it splits, and a freeze piece (a hair of source time
 * just before the moment, rated to play for the freeze's seconds) goes in
 * between; a freeze at a piece's end goes after it, one at the very start
 * before it. A freeze whose moment is on no kept footage is not placed
 * (it follows its frame, like a span). Every consumer of the rated list
 * (mapTime, the zoom remap, the audio splice, the duration) inherits the
 * freezes from this one seam. `marks` is where each placed freeze landed
 * in OUTPUT time, for the lane and the rest.
 */
export function placeFreezes(
  rated: readonly Segment[],
  freezes: readonly FreezeSpan[],
): { pieces: Segment[]; marks: Map<string, FreezeExtent> } {
  const marks = new Map<string, FreezeExtent>()
  const pending = [...freezes]
    .filter((f) => f.seconds > 0)
    .sort((a, b) => a.at - b.at)
  const pieces: Segment[] = []
  let acc = 0
  const freezePiece = (f: FreezeSpan): void => {
    const at = Math.max(HOLD_SOURCE_SPAN, f.at)
    marks.set(f.id, { t: acc, duration: f.seconds })
    pieces.push({
      in: at - HOLD_SOURCE_SPAN,
      out: at,
      rate: HOLD_SOURCE_SPAN / f.seconds,
    })
    acc += f.seconds
  }
  const push = (p: Segment): void => {
    pieces.push(p)
    acc += Math.max(0, p.out - p.in) / (p.rate ?? 1)
  }
  for (let i = 0; i < rated.length; i++) {
    let piece = rated[i]
    const next = rated[i + 1]
    // Freezes inside this piece, in order; a freeze exactly at the piece's
    // end goes after it, unless the next piece continues the same footage
    // (a speed boundary), which is the same frame either way — take the
    // earlier place so the freeze sits where the moment is.
    while (pending.length) {
      const f = pending[0]
      if (f.at > piece.out + 1e-9) break
      if (f.at < piece.in - 1e-9) {
        // On no kept footage before this piece: unplaced, follows its frame.
        pending.shift()
        continue
      }
      if (f.at <= piece.in + 1e-9) {
        // The very first frame, or a boundary the previous piece answered
        // (a cut, a speed edge): the freeze goes here, before this piece.
        pending.shift()
        freezePiece(f)
        continue
      }
      if (f.at < piece.out - 1e-9) {
        push({ ...piece, out: f.at })
        pending.shift()
        freezePiece(f)
        piece = { ...piece, in: f.at }
        continue
      }
      // f.at == piece.out
      const continues =
        next && Math.abs(next.in - piece.out) < 1e-9 && next.out > piece.out
      if (continues) break
      push(piece)
      piece = null as unknown as Segment
      pending.shift()
      freezePiece(f)
      break
    }
    if (piece) push(piece)
  }
  return { pieces, marks }
}

/** The rated segments with every freeze placed (see `placeFreezes`). */
export function withFreezes(
  rated: readonly Segment[],
  freezes: readonly FreezeSpan[],
): Segment[] {
  return placeFreezes(rated, freezes).pieces
}

/** Where each freeze lands on the output timeline (unplaced ones absent). */
export function freezeOutputExtents(
  rated: readonly Segment[],
  freezes: readonly FreezeSpan[],
): Map<string, FreezeExtent> {
  return placeFreezes(rated, freezes).marks
}

/**
 * The rated segments with every legacy segment `hold` placed as the freeze
 * it migrates to.
 * @deprecated Read `docFreezes` and place them with `withFreezes`.
 */
export function withHolds(
  docSegments: readonly DocSegment[],
  rated: Segment[],
): Segment[] {
  return withFreezes(rated, legacyHoldFreezes(docSegments))
}

/** Keyframes the card's entrance prepends to the tilt track, or none. */
export function entranceTiltKeyframes(e: Step): Keyframe<number[]>[] {
  const s = entranceSeconds(e)
  if (!s || e?.kind !== 'tilt-in') return []
  return [
    { t: 0, value: [...TILT_IN_POSE], ease: 'none' },
    { t: s, value: [0, 0], ease: 'power3.out' },
  ]
}

/**
 * Keyframes the card's entrance prepends to the zoom track ([level, cx,
 * cy]): the pull-out's own head, or, for the other kinds, a REST head,
 * because the camera must not zoom into a card that is still arriving (a
 * planner's cold-open span would otherwise fight the entrance). None for
 * none.
 */
export function entranceZoomKeyframes(e: Step): Keyframe<number[]>[] {
  const s = entranceSeconds(e)
  if (!s) return []
  if (e?.kind === 'pull-out')
    return [
      { t: 0, value: [PULL_OUT_LEVEL, 0.5, 0.42], ease: 'none' },
      { t: s, value: [1, 0.5, 0.5], ease: 'power3.out' },
    ]
  return [
    { t: 0, value: [1, 0.5, 0.5], ease: 'none' },
    { t: s, value: [1, 0.5, 0.5], ease: 'none' },
  ]
}

/**
 * Prepend an entrance's keyframes to a track: keyframes the entrance
 * would overlap (earlier than its end plus a beat) give way, so a span
 * that starts at the cold open loses its head to the entrance rather
 * than fighting it. An empty entrance returns the track untouched.
 */
export function prependEntrance(
  track: KeyframeTrack<number[]> | undefined,
  head: Keyframe<number[]>[],
): KeyframeTrack<number[]> | undefined {
  if (!head.length) return track
  const end = head[head.length - 1].t
  const rest = (track?.keyframes ?? []).filter((k) => k.t > end + 0.1)
  return { keyframes: sortKeyframes([...head, ...rest]) }
}

/** The pose a card exit settles into: [scale, dy, opacity]. */
function exitPose(e: Step): number[] {
  return e?.kind === 'fade' ? [1, 0, 0] : [0.9, -0.02, 0.22]
}

/**
 * The card-pose track [scale, dy, opacity] in OUTPUT seconds: the entrance
 * settles the card in from a slightly smaller, lower, transparent pose;
 * the exit takes it out as its footage ends. The exit runs FROM the
 * footage's end when something plays after it (the card recedes under the
 * words), and ENDS at the footage's end when nothing does (the card leaves
 * as the cut closes). Undefined when the card carries neither, so a doc
 * without them lowers byte-identically.
 */
export function cardPoseTrack(
  enter: Step,
  exit: Step,
  footageEnd: number,
  outputEnd: number = footageEnd,
): KeyframeTrack<number[]> | undefined {
  const keyframes: Keyframe<number[]>[] = []
  const s = entranceSeconds(enter)
  if (s) {
    // The first frame is what a feed shows: the card is VISIBLE at t = 0
    // (the references open in perspective, never on nothing), so the pose
    // settles from a smaller, lower, softened card, not from a blank.
    const from =
      enter?.kind === 'rise'
        ? [0.96, 0.08, 0.7]
        : enter?.kind === 'pull-out' || enter?.kind === 'fade'
          ? enter.kind === 'fade'
            ? [1, 0, 0]
            : [1, 0, 1]
          : [0.94, 0.05, 0.7]
    keyframes.push({ t: 0, value: from, ease: 'none' })
    keyframes.push({ t: s, value: [1, 0, 1], ease: 'power3.out' })
  }
  const x = exitSeconds(exit)
  if (x > 0 && footageEnd > 0) {
    const room = outputEnd - footageEnd
    const t0 = Math.max(s, room > 1e-6 ? footageEnd : footageEnd - x)
    const t1 = room > 1e-6 ? t0 + Math.min(x, Math.max(0.1, room)) : t0 + x
    keyframes.push({ t: t0, value: [1, 0, 1], ease: 'none' })
    keyframes.push({ t: t1, value: exitPose(exit), ease: 'power2.out' })
  }
  if (!keyframes.length) return undefined
  return { keyframes: sortKeyframes(keyframes) }
}

/**
 * The clips a legacy end card places after the footage: the house title,
 * caption and label presets over the receding card, the mark above the
 * wordmark, every one stamped `from: 'endcard'` so a loop drops them and
 * a re-apply replaces them. Pure; the words are the card's.
 */
export function endCardClips(
  card: EndCard,
  doc: Pick<ProjectDoc, 'export' | 'frame' | 'source'>,
  endStart: number,
): OverlayClip[] {
  const seconds = Math.max(1, Math.min(8, card.seconds ?? END_CARD_SECONDS))
  const anim: Anim = { enter: 'rise', exit: 'none' }
  const clips: OverlayClip[] = []
  const text = (
    id: string,
    body: string,
    preset: TextOverlayClip['preset'],
    y: number,
    delay: number,
  ): TextOverlayClip => ({
    id,
    kind: 'text',
    text: body,
    preset,
    start: endStart + delay,
    duration: Math.max(0.3, seconds - delay),
    transform: { x: 0.5, y, scale: 1, rotation: 0 },
    anim,
    from: END_CARD_FROM,
    align: 'center',
    ...(card.ink ? { color: card.ink } : {}),
    shadow: 0,
  })
  if (card.headline?.trim())
    clips.push(text('endcard-title', card.headline.trim(), 'title', 0.44, 0.35))
  if (card.sub?.trim())
    clips.push(text('endcard-sub', card.sub.trim(), 'caption', 0.57, 0.5))
  // The mark: a square-ish one sits above the wordmark at 1.3 times the
  // label's cap height; a wide one (a stylised wordmark asset) is the
  // wordmark. Width is a fraction of the FRAME width, so it needs the
  // frame's aspect; height is design px over 1080.
  const mark = card.mark
  const wide = !!mark && mark.aspect > 2.2
  if (mark && mark.key) {
    const size = resolveExportSize(doc as ProjectDoc)
    const designW = (1080 * size.width) / Math.max(1, size.height)
    const hPx = wide ? 44 : 30
    const clip: MediaOverlayClip = {
      id: 'endcard-markimg',
      kind: 'image',
      key: mark.key,
      width: Math.min(0.9, (hPx * Math.max(0.2, mark.aspect)) / designW),
      radius: 0,
      shadow: 'none',
      start: endStart + 0.65,
      duration: Math.max(0.3, seconds - 0.65),
      transform: { x: 0.5, y: wide ? 0.88 : 0.835, scale: 1, rotation: 0 },
      anim,
      from: END_CARD_FROM,
    }
    clips.push(clip)
  }
  if (card.wordmark?.trim() && !wide)
    clips.push(
      text(
        'endcard-mark',
        card.wordmark.trim(),
        'label',
        mark && mark.key ? 0.895 : 0.88,
        0.65,
      ),
    )
  return clips
}

/**
 * A doc with its legacy end card expanded the OLD way: the last segment
 * holds for the card's seconds and the words ride over the frozen footage.
 * Kept for a caller that still wants the hold shape; the lowering migrates
 * instead (clips after the footage, a card exit, no hold), which paints the
 * same picture without a scenario field.
 * @deprecated Use `migrateMotion`.
 */
export function expandEndCard(
  doc: ProjectDoc,
  outputDuration: number,
): { doc: ProjectDoc; endStart: number | null; seconds: number } {
  const card = doc.endCard
  if (!card || !doc.segments.length) return { doc, endStart: null, seconds: 0 }
  const seconds = Math.max(1, Math.min(8, card.seconds ?? END_CARD_SECONDS))
  const segments = doc.segments.map((s, i) =>
    i === doc.segments.length - 1
      ? { ...s, hold: ((s as { hold?: number }).hold ?? 0) + seconds }
      : s,
  )
  const endStart = outputDuration
  const overlays: OverlayClip[] = [
    ...(doc.overlays ?? []),
    ...endCardClips(card, doc, endStart),
  ]
  return { doc: { ...doc, segments, overlays }, endStart, seconds }
}

const hasLegacyClipMotion = (o: OverlayClip): boolean =>
  o.enter !== undefined ||
  o.exit !== undefined ||
  (o.kind === 'text' && o.fx !== undefined)

/** The one `anim` a legacy clip's spellings describe. */
function migrateClipAnim(o: OverlayClip): Anim {
  const anim: Anim = { ...(o.anim ?? {}) }
  if (o.kind === 'text' && o.fx) {
    const fx = o.fx
    anim.enter = {
      kind: fx.fx,
      unit: fx.unit ?? 'block',
      ...(fx.direction !== undefined ? { direction: fx.direction } : {}),
      ...(fx.stagger !== undefined ? { stagger: fx.stagger } : {}),
      ...(fx.duration !== undefined ? { seconds: fx.duration } : {}),
    }
  } else if (o.enter !== undefined && anim.enter === undefined) {
    anim.enter = o.enter
  }
  if (o.exit !== undefined && anim.exit === undefined) anim.exit = o.exit
  return anim
}

/**
 * A document in the one vocabulary: `frame.entrance` becomes the card's
 * `anim.enter`; a clip's `enter`, `exit` and `fx` become its `anim`; a
 * prop's `animation` becomes its `anim.idle`; and the end card becomes a
 * card `anim.exit` of `recede` plus its clips placed after the footage
 * (no hold: the output now lasts until the last clip, and the card holds
 * its last frame at the exit's end pose, which is the picture the end card
 * painted). Returns the SAME object when there is nothing to migrate, so a
 * document already in the vocabulary lowers byte-identically and identity
 * checks hold.
 */
export function migrateMotion(doc: ProjectDoc): ProjectDoc {
  // Read over UNTRUSTED shapes too (a hosted payload on its way in): a
  // document with no frame or no segments migrates what it has.
  const frame: FrameStyle = doc.frame ?? ({} as FrameStyle)
  const segments = Array.isArray(doc.segments) ? doc.segments : []
  const overlays = Array.isArray(doc.overlays) ? doc.overlays : []
  const objects = Array.isArray(doc.objects) ? doc.objects : []
  const heldSegments = segments.some((s) => s.hold !== undefined)
  const legacy =
    frame.entrance !== undefined ||
    doc.endCard !== undefined ||
    heldSegments ||
    overlays.some(hasLegacyClipMotion) ||
    objects.some((o) => o.animation !== undefined)
  if (!legacy) return doc

  const out: ProjectDoc = { ...doc }
  if (heldSegments) {
    // A segment's hold is a freeze at its end: spelled once, on the lane
    // every retime lives on, and the segment loses the field.
    const holds = legacyHoldFreezes(segments)
    const own = Array.isArray(doc.freeze) ? doc.freeze : []
    const taken = new Set(own.map((f) => f.id))
    let n = own.length
    const migrated = holds.map((h) => {
      let id = `f${n++}`
      while (taken.has(id)) id = `f${n++}`
      taken.add(id)
      return { id, at: h.at, seconds: h.seconds }
    })
    out.freeze = [...own, ...migrated].sort((a, b) => a.at - b.at)
    out.segments = segments.map((s) => {
      if (s.hold === undefined) return s
      const next = { ...s }
      delete next.hold
      return next
    })
  }
  const nextFrame: FrameStyle = { ...frame }
  if (frame.entrance !== undefined) {
    const e = frame.entrance
    if (e && e.kind !== 'none') {
      nextFrame.anim = {
        ...(frame.anim ?? {}),
        enter:
          e.seconds !== undefined
            ? { kind: e.kind, seconds: e.seconds }
            : e.kind,
      }
    }
    delete nextFrame.entrance
  }

  let nextOverlays: OverlayClip[] = overlays.map((o) => {
    if (!hasLegacyClipMotion(o)) return o
    const next = { ...o, anim: migrateClipAnim(o) } as OverlayClip
    delete next.enter
    delete next.exit
    if (next.kind === 'text') delete (next as TextOverlayClip).fx
    return next
  })

  if (doc.endCard !== undefined) {
    const card = doc.endCard
    if (card && segments.length) {
      const seconds = Math.max(1, Math.min(8, card.seconds ?? END_CARD_SECONDS))
      const rated = withFreezes(
        splitBySpeed(segments, doc.speed ?? []),
        docFreezes(doc),
      )
      const endStart = totalDuration(rated)
      nextOverlays = [...nextOverlays, ...endCardClips(card, doc, endStart)]
      nextFrame.anim = {
        ...(nextFrame.anim ?? {}),
        exit: {
          kind: 'recede',
          seconds: Math.min(END_CARD_RECEDE, seconds * 0.4),
        },
      }
    }
    delete out.endCard
  }

  const nextObjects: ObjectClip[] = objects.map((o) => {
    if (o.animation === undefined) return o
    const next: ObjectClip = {
      ...o,
      anim: {
        ...(o.anim ?? {}),
        ...(o.anim?.idle === undefined ? { idle: o.animation ?? null } : {}),
      },
    }
    delete next.animation
    return next
  })

  if (doc.frame !== undefined || nextFrame.anim !== undefined)
    out.frame = nextFrame
  if (doc.overlays !== undefined || nextOverlays.length)
    out.overlays = nextOverlays
  if (doc.objects !== undefined) out.objects = nextObjects
  return out
}

/**
 * Where the OUTPUT ends: the footage's end (its rated segments, holds
 * included) or the last visual clip's end, whichever is later. Past its
 * footage the card holds its last frame (`mapTime` clamps) at the pose its
 * exit settled into. A document that ends on its footage answers the
 * footage's end, byte-identically to before the rule.
 */
export function outputEnd(
  doc: Pick<ProjectDoc, 'overlays' | 'objects'>,
  footageEnd: number,
): number {
  return Math.max(footageEnd, lastLayerEnd(doc))
}

/** Re-export for callers that read the step shape through this module. */
export { animStep }
