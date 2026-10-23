/**
 * Repeated footage. A cut may play the same seconds of a media more than
 * once (a cold open showing the final state, then the whole recording from
 * its start): a segment's source span is free to overlap an earlier one's.
 * Everything source-anchored follows its seconds, so a zoom, a tilt, a cam
 * move, a click, a freeze or a speed span over replayed seconds plays in
 * EVERY occurrence, the same way each time.
 *
 * An OCCURRENCE is one forward pass of the playhead over a media's seconds.
 * A piece of the rated list REPLAYS when it starts before the furthest
 * second its media has already reached, unless it continues the piece just
 * before it (a split, a speed edge, a freeze). A cut that keeps each media's
 * seconds in forward order has no replay at all, so every reader below
 * answers exactly what the single-pass mappings always did.
 *
 * The inverse maps (source → output) come in two forms, and each caller
 * says which it takes: every occurrence (the camera tracks, the clicks,
 * the freezes), or the first (a lane item, an anchor, a digest moment).
 */
import { segmentRate } from '@vosjs/timeline'
import { mediaKey, sameMedia } from '../media'
import type { Segment } from '@vosjs/timeline'

type Piece = Segment & { media?: string }

/**
 * How far before its media's furthest second a piece may start and still
 * count as continuing it. A freeze piece holds a hair of source time just
 * before its moment (2 ms), and is never a replay.
 */
export const REPLAY_EPS = 0.01

/**
 * For each piece, whether it replays seconds of its media an earlier piece
 * already played (see the module note). All false for a forward cut.
 */
export function replayFlags(pieces: readonly Piece[]): boolean[] {
  const reached = new Map<string, number>()
  return pieces.map((p, i) => {
    const key = mediaKey(p.media)
    const furthest = reached.get(key)
    const prev = i > 0 ? pieces[i - 1] : null
    const continues =
      !!prev &&
      sameMedia(prev.media, p.media) &&
      Math.abs(p.in - prev.out) < REPLAY_EPS
    reached.set(key, Math.max(furthest ?? -Infinity, p.out))
    return furthest !== undefined && !continues && p.in < furthest - REPLAY_EPS
  })
}

/** Does the rated list play any media's seconds twice? */
export function hasReplay(pieces: readonly Piece[]): boolean {
  return replayFlags(pieces).some(Boolean)
}

/** One occurrence of a source span on the output timeline. */
export interface OutputExtent {
  start: number
  end: number
}

/**
 * Every occurrence of a SOURCE span of one media on the output timeline,
 * in output order: the output extent of its kept footage in each pass (a
 * partially-cut span snaps its edges into kept footage; a span the cut
 * keeps nothing of has none). Rate-aware: output positions accumulate each
 * piece's (out − in) / rate. A forward cut gives at most one.
 */
export function spanOutputExtents(
  pieces: readonly Piece[],
  sIn: number,
  sOut: number,
  media?: string,
): OutputExtent[] {
  const replays = replayFlags(pieces)
  const runs: OutputExtent[] = []
  let cur: OutputExtent | null = null
  let acc = 0
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    const rate = segmentRate(p)
    const len = Math.max(0, p.out - p.in) / rate
    // Source seconds are one media's: a piece of another media is output
    // time this span never covers, however its numbers overlap.
    if (sameMedia(p.media, media)) {
      if (replays[i]) cur = null
      const ovIn = Math.max(sIn, p.in)
      const ovOut = Math.min(sOut, p.out)
      if (ovOut > ovIn) {
        const end = acc + (ovOut - p.in) / rate
        if (cur) cur.end = end
        else {
          cur = { start: acc + (ovIn - p.in) / rate, end }
          runs.push(cur)
        }
      }
    }
    acc += len
  }
  return runs.filter((r) => r.end > r.start)
}

/**
 * Every output second a SOURCE moment of one media plays at, one per
 * occurrence, in output order. A moment on a piece's edges counts as held
 * there; a moment on the boundary two pieces of one pass share is one
 * moment, played once. Empty when the cut leaves it out.
 */
export function momentOutputs(
  pieces: readonly Piece[],
  t: number,
  media?: string,
): number[] {
  const replays = replayFlags(pieces)
  const out: number[] = []
  let found = false
  let acc = 0
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]
    const rate = segmentRate(p)
    if (sameMedia(p.media, media)) {
      if (replays[i]) found = false
      if (!found && t >= p.in && t <= p.out) {
        out.push(acc + (t - p.in) / rate)
        found = true
      }
    }
    acc += Math.max(0, p.out - p.in) / rate
  }
  return out
}
