/**
 * Transitions at the boundaries between footage clips. A clip's `anim`
 * says how it meets the clip beside it: its `exit` at the boundary after
 * it, its `enter` at the boundary before it. The lowering turns every
 * boundary that names one into a RECORD in output seconds, which ON_FRAME
 * reads with no document in hand: during the window the INCOMING clip is
 * the live one (`mapTime` lands on it as it would without a transition, so
 * the zoom remap, the audio splice and every chunk inherit the boundary
 * unchanged) and the OUTGOING card is a snapshot of its last frame on a
 * second plane, moving away. A frozen outgoing is what the references do
 * (a cut at a moment of stillness) and what makes the primitive chunk-safe:
 * a cold seek inside the window decodes one extra frame, never a second
 * time mapping. The camera rests through the window (a span that starts
 * inside it loses its head), so the move is the only motion. The card's
 * own `slide` enter at the open is the same record with no outgoing.
 */
import { segmentOutputExtents } from './segmentStarts'
import {
  enterOf,
  exitOf,
  slideSide,
  transitionSeconds,
  TRANSITION_SECONDS_MIN,
} from '../anim'
import { mediaAtOutput, sameMedia } from '../media'
import type { Segment } from '@vosjs/timeline'
import type { AnimSide, AnimStep, ProjectDoc } from '../types'

/** How far a slide travels, in plane widths or heights: fully off, plus a hair. */
export const TRANSITION_TRAVEL = 1.04
/** How much a `scale` transition shrinks the card at its far end. */
export const TRANSITION_SCALE_STEP = 0.08
/** The ghost plane sits a hair in front of the card plane, above it in the painter's order and below the stack's card planes. */
export const GHOST_Z_LIFT = 0.004
export const GHOST_RENDER_ORDER = 1.1

/** The kinds a boundary moves by. */
export type TransitionKind = 'slide' | 'fade' | 'scale'

/** One side of a transition: how a card moves, for how long. */
export interface TransitionMove {
  kind: TransitionKind
  /** A slide's side (where an enter comes from, where an exit goes to). */
  side: AnimSide
  /** Seconds this side takes, from the boundary. */
  d: number
}

/** The outgoing card: which media's last frame it shows, and how it leaves. */
export interface TransitionOut extends TransitionMove {
  /** The media (`''` = the primary). */
  media: string
  /** SOURCE seconds of the frame it shows (the clip's last frame). */
  at: number
}

/** A boundary transition in OUTPUT seconds. */
export interface Transition {
  /** The boundary: where the incoming clip starts. */
  t: number
  /** The window: the longer of the two sides. */
  d: number
  /** How the incoming (live) card arrives; absent = it holds still. */
  in?: TransitionMove
  /** The outgoing snapshot and how it leaves; absent = it is simply gone. */
  out?: TransitionOut
}

/** The hair of source time before a clip's `out` that holds its last frame. */
const LAST_FRAME_BACK = 0.002

const round3 = (v: number): number => Math.round(v * 1000) / 1000

function move(
  step: AnimStep | null,
  which: 'enter' | 'exit',
  cap: number,
): TransitionMove | null {
  const secs = transitionSeconds(step)
  if (!secs || !step) return null
  const kind = step.kind
  if (kind !== 'slide' && kind !== 'fade' && kind !== 'scale') return null
  // Never longer than half the shorter clip: the clip must be seen still
  // before it moves (the lint says so in words; the lowering keeps it true).
  const d = Math.min(secs, cap)
  if (d < TRANSITION_SECONDS_MIN) return null
  return { kind, side: slideSide(step, which), d: round3(d) }
}

/**
 * The document's transitions: one record per boundary that names an exit
 * or an enter, plus the card's own `slide` enter at the open. Empty for a
 * document with none, so it lowers as before.
 */
export function docTransitions(doc: ProjectDoc): Transition[] {
  const out: Transition[] = []
  const segments = doc.segments
  const extents = segmentOutputExtents(doc)
  const open = enterOf(doc.frame.anim)
  if (open?.kind === 'slide' && extents.length) {
    const first = extents[0]
    const m = move(open, 'enter', Math.max(0, first.end - first.start) / 2)
    if (m) out.push({ t: 0, d: m.d, in: m })
  }
  for (let i = 0; i + 1 < segments.length; i++) {
    const a = segments[i]
    const b = segments[i + 1]
    const la = extents[i].end - extents[i].start
    const lb = extents[i + 1].end - extents[i + 1].start
    const cap = Math.min(la, lb) / 2
    const exit = move(exitOf(a.anim), 'exit', cap)
    const enter = move(enterOf(b.anim), 'enter', cap)
    if (!exit && !enter) continue
    const t = round3(extents[i + 1].start)
    const rec: Transition = {
      t,
      d: Math.max(exit?.d ?? 0, enter?.d ?? 0),
    }
    if (enter) rec.in = enter
    if (exit)
      rec.out = {
        ...exit,
        media: a.media ?? '',
        at: round3(Math.max(a.in, a.out - LAST_FRAME_BACK)),
      }
    out.push(rec)
  }
  return out
}

/** How close to a boundary a span may start before the window rests it. */
const REST_LEAD = 0.1

/**
 * The camera rests through a transition: a source-anchored span (zoom,
 * tilt) whose output start falls inside a boundary's window loses its
 * head, starting where the window ends instead, and a span too short to
 * survive the cut is dropped. Spans that start before the window keep
 * their own end. The open's record (t = 0) is the entrance's business
 * (`prependEntrance`) and is skipped here.
 */
export function restSpansThroughTransitions<
  T extends { in: number; out: number; media?: string },
>(
  spans: readonly T[],
  rated: readonly (Segment & { media?: string })[],
  transitions: readonly Transition[],
  minLen: number,
): T[] {
  const windows = transitions.filter((tr) => tr.t > 0 && tr.d > 0)
  if (!windows.length) return [...spans]
  const out: T[] = []
  for (const span of spans) {
    const start = outputStartOf(rated, span.in, span.out, span.media)
    const win =
      start === null
        ? undefined
        : windows.find((tr) => start >= tr.t - REST_LEAD && start < tr.t + tr.d)
    if (start === null || !win) {
      out.push(span)
      continue
    }
    const after = win.t + win.d
    if (mediaAtOutput(rated, after) !== (span.media ?? '')) continue
    const head = sourceAt(rated, after)
    if (head === null || head > span.out - minLen) continue
    out.push({ ...span, in: round3(head) })
  }
  return out
}

/**
 * Where a source span's kept footage STARTS on the output timeline, through
 * its media's pieces (null when the cut dropped it all).
 */
function outputStartOf(
  rated: readonly (Segment & { media?: string; rate?: number })[],
  sIn: number,
  sOut: number,
  media: string | undefined,
): number | null {
  let acc = 0
  for (const p of rated) {
    const rate = p.rate ?? 1
    const len = Math.max(0, p.out - p.in) / rate
    if (sameMedia(p.media, media)) {
      const ovIn = Math.max(sIn, p.in)
      const ovOut = Math.min(sOut, p.out)
      if (ovOut > ovIn) return acc + (ovIn - p.in) / rate
    }
    acc += len
  }
  return null
}

/** The source second of the piece under an output moment. */
function sourceAt(
  rated: readonly (Segment & { media?: string; rate?: number })[],
  t: number,
): number | null {
  let acc = 0
  for (const p of rated) {
    const rate = p.rate ?? 1
    const len = Math.max(0, p.out - p.in) / rate
    if (t < acc + len) return p.in + (t - acc) * rate
    acc += len
  }
  return null
}
