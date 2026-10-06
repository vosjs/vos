/**
 * Pure text layout + raster-scale math for the canvas-rasterized renderers.
 *
 * Deliberately DOM-free: measurement is injected, so segmentation, spacing,
 * alignment, the metrics-true line box, and raster-scale selection are
 * unit-testable in plain node. The canvas renderers in `renderers/text.ts`
 * stay a thin raster pass over these rules.
 *
 * Text is lines of RUNS (`text/layout.ts`): a plain string is one run a
 * line, so the block and the split units below are one layout whether the
 * content is styled or not.
 */
import { graphemesOf, layoutText } from './text/layout'
import type { Fragment, LayoutLine, LayoutRun, Measure } from './text/layout'

/** Design resolution baseline: element layout lives in 1080p design px. */
export const DESIGN_HEIGHT = 1080

/**
 * Raster-scale clamp bounds. The lower bound keeps degenerate viewports from
 * producing unreadably tiny rasters; the upper bound caps memory for extreme
 * buffers (8 covers 8K on a 1080p design space).
 */
const RASTER_SCALE_MIN = 0.25
const RASTER_SCALE_MAX = 8

/** Conservative texture limit when the host reports none. */
const DEFAULT_MAX_TEXTURE_SIZE = 4096

export interface RasterResolution {
  width?: number
  height?: number
  pixelRatio?: number
  drawingBufferWidth?: number
  drawingBufferHeight?: number
  /** Optional GPU capabilities, forwarded by the host when available. */
  maxAnisotropy?: number
  maxTextureSize?: number
}

/**
 * Texel-density scale for canvas-rasterized elements: how many drawing-buffer
 * pixels one design pixel covers. Rasterizing at this scale is what keeps
 * text sharp at 4K export and on hi-DPR previews, instead of magnifying a
 * design-px raster with linear filtering.
 */
export function rasterScaleFor(
  resolution: RasterResolution | null | undefined,
): number {
  const height = resolution?.height ?? DESIGN_HEIGHT
  const bufferHeight =
    resolution?.drawingBufferHeight ?? height * (resolution?.pixelRatio ?? 1)
  const scale = bufferHeight / DESIGN_HEIGHT
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return Math.min(RASTER_SCALE_MAX, Math.max(RASTER_SCALE_MIN, scale))
}

/** Clamp a raster scale so a design-px canvas stays within the GPU limit. */
export function clampRasterScale(
  scale: number,
  designWidth: number,
  designHeight: number,
  maxTextureSize?: number,
): number {
  const limit =
    maxTextureSize && maxTextureSize > 0
      ? maxTextureSize
      : DEFAULT_MAX_TEXTURE_SIZE
  const largest = Math.max(designWidth, designHeight, 1)
  return Math.min(scale, limit / largest)
}

export interface LineMetrics {
  ascent: number
  descent: number
  /** Baseline-to-baseline advance between lines. */
  advance: number
}

/**
 * Metrics-true line box. `fontBoundingBox*` is the font-wide line box (stable
 * across strings); fall back to em-based approximations where the platform
 * does not expose it. Line advance stays `fontSize * lineHeight` — the author
 * model — while ascent/descent size the box so descenders never clip.
 */
export function lineMetricsFrom(
  probe:
    | { fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number }
    | null
    | undefined,
  fontSize: number,
  lineHeight: number,
): LineMetrics {
  const ascent = probe?.fontBoundingBoxAscent ?? fontSize * 0.8
  const descent = probe?.fontBoundingBoxDescent ?? fontSize * 0.25
  return { ascent, descent, advance: fontSize * lineHeight }
}

/**
 * The middle of the line box above its baseline: where the layout module's
 * decorations are measured from (it draws on the middle; this renderer draws
 * on the alphabetic baseline).
 */
export function middleAboveBaseline(metrics: LineMetrics): number {
  return (metrics.ascent - metrics.descent) / 2
}

export type SplitType = 'chars' | 'words' | 'lines'
export type TextAlign = 'left' | 'center' | 'right'

/** Grapheme-cluster segmentation (emoji / combining-mark safe). */
export const graphemes = graphemesOf

/**
 * Width of a line with manual letter-spacing: spacing goes BETWEEN grapheme
 * clusters (n - 1 gaps), matching CSS-less canvas drawing where the raster
 * adds the spacing itself.
 */
export function lineWidthWithSpacing(
  line: string,
  letterSpacing: number,
  measure: (text: string) => number,
): number {
  if (line.length === 0) return 0
  const gaps = Math.max(0, graphemes(line).length - 1)
  return measure(line) + letterSpacing * gaps
}

/**
 * An advance that adds letter-spacing itself: one gap after EVERY grapheme,
 * so stretches measured apart add up to the line. `raw` measures without
 * spacing. The gap after a line's or a unit's last grapheme is not ink; the
 * layouts below take it back off (`lineWidthWithSpacing`'s n - 1 gaps).
 */
export function spacedAdvance(raw: Measure, letterSpacing: number): Measure {
  if (!letterSpacing) return raw
  return (text, font) =>
    text ? raw(text, font) + letterSpacing * graphemes(text).length : 0
}

/** A plain string as lines of runs: one unstyled run a line. */
export function plainLines(content: string): LayoutRun[][] {
  return content.split('\n').map((t) => (t ? [{ t }] : []))
}

const lineText = (frags: readonly { t: string }[]) => {
  let out = ''
  for (const f of frags) out += f.t
  return out
}

// ---------------------------------------------------------------------------
// The block: what a text element draws as ONE picture.
// ---------------------------------------------------------------------------

/**
 * One line of a block: a layout line (its stretches, each at its left edge
 * from the line's start, and where the line sits in the whole text) whose
 * `w` is its INK width, and where it starts inside the block.
 */
export interface BlockLine extends LayoutLine {
  /** Where the line starts inside the block, by `align`. */
  indent: number
}

export interface TextBlockLayout {
  lines: BlockLine[]
  /** The widest line. */
  width: number
  /** `(lines - 1)` advances plus one metrics-true line box. */
  height: number
  metrics: LineMetrics
}

/**
 * Lay a block out: lines of fragments, each line placed by `align` against
 * the widest. `advance(text, font)` is the advance of a stretch in a font;
 * where it already holds a gap after the last grapheme that is not ink (the
 * manual letter-spacing of `spacedAdvance`), `trailingGap` takes it off each
 * line's width.
 */
export function layoutTextBlock(
  lines: LayoutRun[][],
  opts: { align: TextAlign; metrics: LineMetrics; trailingGap?: number },
  advance: Measure,
): TextBlockLayout {
  const { align, metrics } = opts
  const gap = opts.trailingGap ?? 0
  const laid = layoutText({ lines }, advance)
  const widths = laid.lines.map((l) => (l.frags.length ? l.w - gap : 0))
  const width = widths.length ? Math.max(...widths) : 0
  return {
    lines: laid.lines.map((l, i) => ({
      ...l,
      w: widths[i],
      indent:
        align === 'center'
          ? (width - widths[i]) / 2
          : align === 'right'
            ? width - widths[i]
            : 0,
    })),
    width,
    height:
      (laid.lines.length - 1) * metrics.advance +
      metrics.ascent +
      metrics.descent,
    metrics,
  }
}

// ---------------------------------------------------------------------------
// Split units: what a text element draws as one picture PER char, word or
// line, for a timeline to animate apart.
// ---------------------------------------------------------------------------

export interface TextUnit {
  text: string
  lineIndex: number
  /** Character offset of the unit within its line (for prefix measurement). */
  charOffset: number
}

/** `[start, end)` of each unit in one line: ink only, never bare whitespace. */
function unitRanges(line: string, type: SplitType): [number, number][] {
  const out: [number, number][] = []
  if (type === 'lines') {
    if (line.length > 0) out.push([0, line.length])
    return out
  }
  if (type === 'words') {
    const re = /\S+/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      out.push([m.index, m.index + m[0].length])
    }
    return out
  }
  let offset = 0
  for (const g of graphemes(line)) {
    if (g.length > 0 && !/^\s+$/.test(g)) out.push([offset, offset + g.length])
    offset += g.length
  }
  return out
}

/**
 * Split content into animatable units. Lines are always the outer level, so
 * multi-line char/word splits keep their line structure (line units stack
 * vertically instead of collapsing onto one row).
 */
export function segmentText(
  content: string,
  type: SplitType,
): { lines: string[]; units: TextUnit[] } {
  const lines = content.split('\n')
  const units: TextUnit[] = []
  lines.forEach((line, lineIndex) => {
    for (const [a, b] of unitRanges(line, type)) {
      units.push({ text: line.slice(a, b), lineIndex, charOffset: a })
    }
  })
  return { lines, units }
}

export interface UnitPlacement {
  text: string
  lineIndex: number
  /** Center of the unit's ink run relative to block center, design px, y-up. */
  offsetX: number
  offsetY: number
  /** Measured ink advance of the unit (spacing-inclusive), design px. */
  width: number
  /**
   * What the unit draws: its same-style stretches, each at its left edge
   * from the UNIT's left. One for a unit set in one style.
   */
  parts: Fragment[]
}

export interface SplitLayout {
  units: UnitPlacement[]
  /** Block dimensions in design px (max line width × metrics-true height). */
  width: number
  height: number
  metrics: LineMetrics
}

/**
 * Lay out split units. `measure` is a RAW design-px measurer with NO
 * letter-spacing applied — spacing is added here so the math is identical in
 * every browser (and honest: per-unit rasters lose cross-boundary kerning by
 * construction; prefix measurement keeps cumulative drift bounded).
 *
 * `content` is a string or lines of runs. A unit that crosses a style
 * boundary (a word set half in bold) carries one part per stretch, each
 * measured in its own font and placed after the one before it.
 */
export function layoutSplitUnits(
  content: string | LayoutRun[][],
  type: SplitType,
  opts: { letterSpacing: number; align: TextAlign; metrics: LineMetrics },
  measure: Measure,
): SplitLayout {
  const { letterSpacing: ls, align, metrics } = opts
  const advance = spacedAdvance(measure, ls)
  const block = layoutTextBlock(
    typeof content === 'string' ? plainLines(content) : content,
    { align, metrics, trailingGap: ls },
    advance,
  )

  const units: UnitPlacement[] = []
  block.lines.forEach((line, lineIndex) => {
    const lineStart =
      align === 'left'
        ? -block.width / 2
        : align === 'right'
          ? block.width / 2 - line.w
          : -line.w / 2
    const baselineDown = metrics.ascent + lineIndex * metrics.advance
    const centerDown = baselineDown - middleAboveBaseline(metrics)
    for (const [a, b] of unitRanges(lineText(line.frags), type)) {
      // The unit's stretches, each measured ALONE in its font (a unit is its
      // own raster) and set one after the other.
      const parts: Fragment[] = []
      let left = 0
      let width = 0
      for (const fr of line.frags) {
        const from = Math.max(a, fr.o)
        const to = Math.min(b, fr.o + fr.t.length)
        if (to <= from) continue
        const f = fr.f || 0
        if (!parts.length) left = fr.x + advance(fr.t.slice(0, from - fr.o), f)
        const t = fr.t.slice(from - fr.o, to - fr.o)
        const w = advance(t, f)
        parts.push({ ...fr, t, x: width, w, o: from - a })
        width += w
      }
      if (!parts.length) continue
      // The gap after the unit's last grapheme is not ink.
      width -= ls
      units.push({
        text: lineText(parts),
        lineIndex,
        offsetX: lineStart + left + width / 2,
        offsetY: block.height / 2 - centerDown,
        width,
        parts,
      })
    }
  })

  return { units, width: block.width, height: block.height, metrics }
}
