/**
 * How long each caption stays on screen, so that no two are up at once.
 *
 * Captions land where their steps play, and steps can play close together
 * (a click, then the field it opened a second later). A caption is about its
 * step, so it leaves when the step ends, unless its words need longer to be
 * read; it never lingers over the steps after it. It gives way to the next
 * caption with a small gap and never outlives the clip it starts in. When a
 * caption cannot stay up long enough to be read before the next one (or
 * before its clip ends), it is DROPPED and said, never squeezed into an
 * overlap: two captions on screen at once read as neither.
 *
 * Walked from the last caption back, so each one gives way to the next
 * caption that is actually kept. Pure: the input is never mutated.
 */

/** The longest a caption stays up, seconds. */
export const CAPTION_MAX = 3
/** The shortest a caption can be read in, seconds. */
export const CAPTION_MIN = 1.2
/** The gap between one caption leaving and the next arriving, seconds. */
export const CAPTION_GAP = 0.1

/** Reading speed: the subtitle standard of 17 characters a second, spaces included. */
const READ_CHARS_PER_SECOND = 17

/** How long `text` takes to read, seconds (`CAPTION_MIN` to `CAPTION_MAX`). */
export function readingSeconds(text: string): number {
  const chars = text.trim().replace(/\s+/g, ' ').length
  return Math.min(
    CAPTION_MAX,
    Math.max(CAPTION_MIN, chars / READ_CHARS_PER_SECOND),
  )
}

export interface CaptionSlot {
  start: number
  /** Where the clip it starts in ends (the end of the film for the last). */
  end: number
  /**
   * Where its step ends (output seconds): the caption leaves there, or once
   * its words are read when that is later. Absent: it stays as long as the
   * room allows.
   */
  until?: number
  /** Its words, for the reading time. */
  text?: string
}

export interface CaptionFit<T> {
  /**
   * The kept captions in playing order, each with its duration, and `held`:
   * the seconds it stays past its step's end because its words take longer
   * to read than the step lasts (absent when it leaves with its step).
   */
  kept: { item: T; duration: number; held?: number }[]
  /** The captions that could not be read in time, and why, in words. */
  dropped: { item: T; why: string }[]
}

export function fitCaptions<T>(
  items: T[],
  slotOf: (item: T) => CaptionSlot,
  opts: { max?: number; min?: number; gap?: number } = {},
): CaptionFit<T> {
  const max = opts.max ?? CAPTION_MAX
  const min = opts.min ?? CAPTION_MIN
  const gap = opts.gap ?? CAPTION_GAP
  const ordered = items
    .map((item) => ({ item, slot: slotOf(item) }))
    .sort((a, b) => a.slot.start - b.slot.start)
  const kept: { item: T; duration: number; held?: number }[] = []
  const dropped: { item: T; why: string }[] = []
  let nextStart = Infinity
  for (let i = ordered.length - 1; i >= 0; i--) {
    const { item, slot } = ordered[i]
    const clipRoom = slot.end - slot.start
    const nextRoom = nextStart - gap - slot.start
    const ownRoom =
      slot.until === undefined
        ? Infinity
        : Math.max(
            slot.until - slot.start,
            slot.text === undefined ? min : readingSeconds(slot.text),
          )
    const duration = Math.min(max, clipRoom, nextRoom, ownRoom)
    if (duration < min - 1e-9) {
      dropped.unshift({
        item,
        why:
          nextRoom < clipRoom
            ? `the next caption starts ${(nextStart - slot.start).toFixed(2)}s after it, too soon to read it (more time on its step, its ms, gives it room)`
            : `it plays in the last ${Math.max(0, clipRoom).toFixed(2)}s of its clip, too short to read it (a wait after its step gives it room)`,
      })
      continue
    }
    const held =
      slot.until === undefined ? 0 : duration - (slot.until - slot.start)
    kept.unshift({
      item,
      duration: +duration.toFixed(3),
      ...(held > 0.05 ? { held: +held.toFixed(2) } : {}),
    })
    nextStart = slot.start
  }
  return { kept, dropped }
}

/**
 * A kept caption that stays past its step, in words, with both ways to let
 * it leave with the step: fewer words (an edit to the caption, no take) or
 * more time on the step (a re-record). Never a shorter duration: that only
 * takes the time its words need to be read.
 */
export function heldLine(label: string, held: number): string {
  return `${label} stays ${held.toFixed(2)}s past its step to be read; to let it leave with the step, shorten its words (17 characters read in a second) or give its step more time (its ms, then record again). Do not cut its duration: the words need that time`
}
