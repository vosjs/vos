/**
 * Where a caret stands and what a pointer points at, read off a layout.
 *
 * Host-side only (the page that paints has no caret). Offsets are positions
 * in the layer's whole plain text, in UTF-16 units, which is what a text
 * field reports as its selection; a caret only ever stands on a grapheme
 * boundary. `x` is measured from each line's own left edge, so the caller
 * adds the line's alignment offset exactly as its painter does.
 */
import { graphemesOf } from './layout'
import type { LayoutLine, Measure, TextLayout } from './layout'

export interface CaretStop {
  /** Offset in the whole plain text. */
  o: number
  /** Distance from the line's left edge. */
  x: number
}

/** Every place a caret can stand on a line, left to right. */
export function caretStops(line: LayoutLine, measure: Measure): CaretStop[] {
  const stops: CaretStop[] = [{ o: line.a, x: 0 }]
  for (const fr of line.frags) {
    let at = 0
    for (const g of graphemesOf(fr.t)) {
      at += g.length
      stops.push({
        o: line.a + fr.o + at,
        x: fr.x + measure(fr.t.slice(0, at), fr.f || 0),
      })
    }
  }
  return stops
}

/**
 * The line an offset is on. An offset at a wrap point belongs to the line
 * that STARTS there (the caret sits before the next word, not after the
 * trailing space), except at the very end of the text.
 */
export function lineOfOffset(layout: TextLayout, offset: number): number {
  const lines = layout.lines
  for (let i = lines.length - 1; i >= 0; i--) {
    if (offset >= lines[i].a) return i
  }
  return 0
}

export function caretAt(
  layout: TextLayout,
  offset: number,
  measure: Measure,
): { line: number; x: number } {
  const li = lineOfOffset(layout, offset)
  const stops = caretStops(layout.lines[li], measure)
  let x = stops[stops.length - 1].x
  for (const s of stops) {
    if (s.o >= offset) {
      x = s.x
      break
    }
  }
  return { line: li, x }
}

/** The offset nearest to `x` on a line (a press lands on the closer edge). */
export function offsetAtX(
  line: LayoutLine,
  x: number,
  measure: Measure,
): number {
  const stops = caretStops(line, measure)
  let best = stops[0]
  for (const s of stops) {
    if (Math.abs(s.x - x) < Math.abs(best.x - x)) best = s
  }
  return best.o
}

/**
 * The stretches a selection `[start, end)` covers, one per line it touches.
 * A line whose break the selection takes gets a small tail, so a selected
 * line break is visible.
 */
export function rangeRects(
  layout: TextLayout,
  start: number,
  end: number,
  measure: Measure,
  breakTail = 0,
): { line: number; x: number; w: number }[] {
  const out: { line: number; x: number; w: number }[] = []
  if (end <= start) return out
  layout.lines.forEach((line, i) => {
    const lineEnd = line.a + line.n
    if (end <= line.a || start > lineEnd) return
    const stops = caretStops(line, measure)
    const xOf = (o: number) => {
      for (const s of stops) if (s.o >= o) return s.x
      return stops[stops.length - 1].x
    }
    const x0 = xOf(Math.max(start, line.a))
    const x1 = xOf(Math.min(end, lineEnd))
    // A tail only where the selection takes a real line break with it; a
    // wrap is not a character.
    const next = layout.lines[i + 1]
    const tail = next && next.a > lineEnd && end > lineEnd ? breakTail : 0
    if (x1 + tail > x0) out.push({ line: i, x: x0, w: x1 - x0 + tail })
  })
  return out
}
