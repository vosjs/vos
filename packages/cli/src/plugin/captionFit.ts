/**
 * How long each caption stays on screen, so that no two are up at once.
 *
 * Captions land where their steps play, and steps can play close together
 * (a click, then the field it opened a second later). A caption gives way
 * to the next one with a small gap and never outlives the clip it starts
 * in. When a caption cannot stay up long enough to be read before the next
 * one (or before its clip ends), it is DROPPED and said, never squeezed into
 * an overlap: two captions on screen at once read as neither.
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

export interface CaptionSlot {
  start: number
  /** Where the clip it starts in ends (the end of the film for the last). */
  end: number
}

export interface CaptionFit<T> {
  /** The kept captions in playing order, each with its duration. */
  kept: { item: T; duration: number }[]
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
  const kept: { item: T; duration: number }[] = []
  const dropped: { item: T; why: string }[] = []
  let nextStart = Infinity
  for (let i = ordered.length - 1; i >= 0; i--) {
    const { item, slot } = ordered[i]
    const clipRoom = slot.end - slot.start
    const nextRoom = nextStart - gap - slot.start
    const duration = Math.min(max, clipRoom, nextRoom)
    if (duration < min - 1e-9) {
      dropped.unshift({
        item,
        why:
          nextRoom < clipRoom
            ? `the next caption starts ${(nextStart - slot.start).toFixed(2)}s after it, too soon to read it`
            : `it plays in the last ${Math.max(0, clipRoom).toFixed(2)}s of its clip, too short to read it`,
      })
      continue
    }
    kept.unshift({ item, duration: +duration.toFixed(3) })
    nextStart = slot.start
  }
  return { kept, dropped }
}
