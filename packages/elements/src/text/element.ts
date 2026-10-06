/**
 * A text ELEMENT's measured layout, as a pure function of its config and a
 * probe that measures.
 *
 * The renderer paints from it and a host stands a caret on it: the page
 * hands in a probe over its raster canvas, a host one over a scratch canvas
 * of its own, and both get the same lines, the same stretches and the same
 * box, because there is one function and no second copy of its rules.
 */
import { layoutTextBlock, lineMetricsFrom, spacedAdvance } from '../textLayout'
import { layoutLines, toRichText } from './runs'
import type { TextAlign, TextBlockLayout } from '../textLayout'
import type { LayoutRun } from './layout'

/** A text element's `font`, every field decided. */
export interface ResolvedTextFont {
  size: number
  family: string
  weight: number | string
  style: string
  color: string
  align: TextAlign
  letterSpacing: number
  lineHeight: number
}

export function resolveTextFont(font: any): ResolvedTextFont {
  const f = font ?? {}
  return {
    size: f.size ?? 24,
    family: f.family ?? 'Inter, system-ui, sans-serif',
    weight: f.weight ?? 'normal',
    style: f.style ?? 'normal',
    color: f.color ?? '#ffffff',
    align: f.align ?? 'left',
    letterSpacing: f.letterSpacing ?? 0,
    lineHeight: f.lineHeight ?? 1.2,
  }
}

/** A weight and a slant: what a run may set differently from its element. */
export interface FontVariant {
  weight: number | string
  style: string
}

/** The CSS font a variant of the element's font is drawn in, at a scale. */
export function textFontString(
  f: ResolvedTextFont,
  v: FontVariant,
  scale: number,
): string {
  return `${v.style} ${v.weight} ${f.size * scale}px ${f.family}`
}

/**
 * A text element's content as the layout takes it: lines of runs, and the
 * fonts they are set in (0 is the element's own; a run adds one only where
 * it departs in weight or slant). A string is one run a line in font 0, so
 * plain and styled content are one path from here on.
 */
export interface TextElementSource {
  lines: LayoutRun[][]
  variants: FontVariant[]
}

export function textElementSource(
  content: unknown,
  f: ResolvedTextFont,
): TextElementSource {
  const variants: FontVariant[] = [{ weight: f.weight, style: f.style }]
  const lines = layoutLines(toRichText(content), (run) => {
    const weight = run.weight ?? f.weight
    const style =
      run.italic === undefined ? f.style : run.italic ? 'italic' : 'normal'
    let at = variants.findIndex((v) => v.weight === weight && v.style === style)
    if (at < 0) {
      variants.push({ weight, style })
      at = variants.length - 1
    }
    return at
  })
  return { lines, variants }
}

/** What measures text for a layout: a 2D canvas, behind three questions. */
export interface TextProbe {
  /** Whether `advance` applies letter-spacing itself (`ctx.letterSpacing`). */
  nativeSpacing: boolean
  /**
   * The advance of `text` set in a CSS `font`, with `letterSpacing` px after
   * each grapheme where the platform applies it natively.
   */
  advance: (text: string, font: string, letterSpacing: number) => number
  /** The font-wide line box of a CSS `font` (absent where not exposed). */
  lineBox: (font: string) => {
    fontBoundingBoxAscent?: number
    fontBoundingBoxDescent?: number
  } | null
}

/** A `TextProbe` over a 2D canvas context. Make one per layout: it tracks
 * the font it last set, and a resized canvas forgets its state. */
export function canvasTextProbe(ctx: CanvasRenderingContext2D): TextProbe {
  const native = 'letterSpacing' in ctx
  let font: string | null = null
  let spacing: number | null = null
  const set = (f: string, ls: number) => {
    if (f !== font) {
      ctx.font = f
      font = f
    }
    if (native && ls !== spacing) {
      ;(ctx as any).letterSpacing = `${ls}px`
      spacing = ls
    }
  }
  return {
    nativeSpacing: native,
    advance: (text, f, ls) => {
      set(f, ls)
      return ctx.measureText(text).width
    },
    lineBox: (f) => {
      set(f, spacing ?? 0)
      return ctx.measureText('Mg')
    },
  }
}

/** Room around the ink for a stroke and a shadow to land in, design px. */
export function textElementPadding(element: any, base = 10): number {
  return (
    Math.max(element?.stroke?.width ?? 0, element?.shadow?.blur ?? 0) * 2 + base
  )
}

export interface TextElementLayout {
  f: ResolvedTextFont
  variants: FontVariant[]
  /** Lines of stretches, each line placed by `font.align`. Design px. */
  block: TextBlockLayout
  /** Room around the block inside the element's box. */
  padding: number
  /** The element's box: the plane's size, design px. */
  designWidth: number
  designHeight: number
}

/**
 * Measure a text element: its lines, where each stretch stands, and the box
 * the element is drawn in. Design px (the frame is 1080 high).
 */
export function layoutTextElement(
  element: any,
  probe: TextProbe,
): TextElementLayout {
  const f = resolveTextFont(element?.font)
  const { lines, variants } = textElementSource(element?.content, f)
  const fonts = variants.map((v) => textFontString(f, v, 1))
  const metrics = lineMetricsFrom(probe.lineBox(fonts[0]), f.size, f.lineHeight)
  // With the native property the measure already holds the spacing; without
  // it the layout adds it, and takes the gap after a line's last grapheme
  // back off.
  const native = probe.nativeSpacing
  const measured = (text: string, font: number) =>
    probe.advance(text, fonts[font], f.letterSpacing)
  const block = layoutTextBlock(
    lines,
    { align: f.align, metrics, trailingGap: native ? 0 : f.letterSpacing },
    native ? measured : spacedAdvance(measured, f.letterSpacing),
  )
  const padding = textElementPadding(element)
  return {
    f,
    variants,
    block,
    padding,
    designWidth: Math.ceil(block.width + padding * 2),
    designHeight: Math.ceil(block.height + padding * 2),
  }
}
