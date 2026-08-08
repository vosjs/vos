/**
 * Pure text layout + raster-scale math for the canvas-rasterized renderers.
 *
 * Deliberately DOM-free: measurement is injected, so segmentation, spacing,
 * alignment, the metrics-true line box, and raster-scale selection are
 * unit-testable in plain node. The canvas renderers in `renderers/text.ts`
 * stay a thin raster pass over these rules.
 */

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

export type SplitType = 'chars' | 'words' | 'lines'
export type TextAlign = 'left' | 'center' | 'right'

/** Grapheme-cluster segmentation (emoji / combining-mark safe). */
export function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const seg = new (Intl as any).Segmenter(undefined, {
      granularity: 'grapheme',
    })
    return [...seg.segment(text)].map((s: any) => s.segment)
  }
  // Code-point fallback: still surrogate-pair safe.
  return Array.from(text)
}

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

export interface TextUnit {
  text: string
  lineIndex: number
  /** Character offset of the unit within its line (for prefix measurement). */
  charOffset: number
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
    if (type === 'lines') {
      if (line.length > 0) units.push({ text: line, lineIndex, charOffset: 0 })
      return
    }
    if (type === 'words') {
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        units.push({ text: m[0], lineIndex, charOffset: m.index })
      }
      return
    }
    let offset = 0
    for (const g of graphemes(line)) {
      if (g.length > 0 && !/^\s+$/.test(g)) {
        units.push({ text: g, lineIndex, charOffset: offset })
      }
      offset += g.length
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
 */
export function layoutSplitUnits(
  content: string,
  type: SplitType,
  opts: { letterSpacing: number; align: TextAlign; metrics: LineMetrics },
  measure: (text: string) => number,
): SplitLayout {
  const { lines, units } = segmentText(content, type)
  const { letterSpacing: ls, align, metrics } = opts

  const widths = lines.map((line) => lineWidthWithSpacing(line, ls, measure))
  const blockWidth = widths.length ? Math.max(...widths) : 0
  const blockHeight =
    (lines.length - 1) * metrics.advance + metrics.ascent + metrics.descent

  const placed = units.map((u): UnitPlacement => {
    const line = lines[u.lineIndex]
    const prefix = line.slice(0, u.charOffset)
    const advanceBefore =
      measure(prefix) + ls * (prefix.length ? graphemes(prefix).length : 0)
    const width = lineWidthWithSpacing(u.text, ls, measure)
    const lineW = widths[u.lineIndex]
    const lineStart =
      align === 'left'
        ? -blockWidth / 2
        : align === 'right'
          ? blockWidth / 2 - lineW
          : -lineW / 2
    const baselineDown = metrics.ascent + u.lineIndex * metrics.advance
    const centerDown = baselineDown + (metrics.descent - metrics.ascent) / 2
    return {
      text: u.text,
      lineIndex: u.lineIndex,
      offsetX: lineStart + advanceBefore + width / 2,
      offsetY: blockHeight / 2 - centerDown,
      width,
    }
  })

  return { units: placed, width: blockWidth, height: blockHeight, metrics }
}
