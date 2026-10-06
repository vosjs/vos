import {
  canvasTextProbe,
  layoutTextElement,
  resolveTextFont,
  textElementPadding,
  textElementSource,
  textFontString,
} from '../text/element'
import { decorationRect } from '../text/layout'
import { toRichText } from '../text/runs'
import {
  clampRasterScale,
  graphemes,
  layoutSplitUnits,
  lineMetricsFrom,
  middleAboveBaseline,
  rasterScaleFor,
  type LineMetrics,
  type RasterResolution,
} from '../textLayout'
import type {
  FontVariant,
  ResolvedTextFont,
  TextElementLayout,
} from '../text/element'
import type { Fragment, Measure } from '../text/layout'
import type * as THREE_NS from 'three'

/** `ctx.letterSpacing` is Baseline 2025; older engines get the manual path. */
function supportsLetterSpacing(ctx: CanvasRenderingContext2D): boolean {
  return 'letterSpacing' in ctx
}

/** The advance of a stretch in one of the block's fonts, measured on `ctx`. */
function measurer(ctx: CanvasRenderingContext2D, fonts: string[]): Measure {
  let current = -1
  return (text, font) => {
    if (font !== current) {
      ctx.font = fonts[font]
      current = font
    }
    return ctx.measureText(text).width
  }
}

function applyShadow(
  ctx: CanvasRenderingContext2D,
  element: any,
  scale: number,
) {
  if (!element.shadow) return
  ctx.shadowColor = element.shadow.color
  ctx.shadowBlur = element.shadow.blur * scale
  ctx.shadowOffsetX = (element.shadow.offsetX ?? 0) * scale
  ctx.shadowOffsetY = (element.shadow.offsetY ?? 0) * scale
}

/** Everything one raster pass over a line's fragments needs. */
interface Paint {
  ctx: CanvasRenderingContext2D
  element: any
  f: ResolvedTextFont
  /** The block's fonts at the raster scale. */
  fonts: string[]
  scale: number
  native: boolean
  /** The line box's middle above its baseline, raster px. */
  middle: number
}

/**
 * Draw one stretch of text at a raster position, with stroke-under-fill and
 * manual per-grapheme letter-spacing when the platform lacks the native
 * property. `x` is the LEFT edge of the stretch in raster px; baseline `y`.
 */
function drawRun(p: Paint, text: string, x: number, y: number, color: string) {
  const { ctx, element, f, scale } = p
  const paint = (t: string, px: number) => {
    if (element.stroke) {
      ctx.strokeStyle = element.stroke.color
      ctx.lineWidth = element.stroke.width * scale
      ctx.lineJoin = 'round'
      ctx.strokeText(t, px, y)
    }
    ctx.fillStyle = color
    ctx.fillText(t, px, y)
  }

  if (p.native || f.letterSpacing === 0) {
    paint(text, x)
    return
  }
  // Manual spacing fallback: per-grapheme advances (loses cross-grapheme
  // kerning — only reached on engines without ctx.letterSpacing).
  let cursor = x
  for (const g of graphemes(text)) {
    paint(g, cursor)
    cursor += ctx.measureText(g).width + f.letterSpacing * scale
  }
}

/**
 * The colour behind a line's highlighted stretches. Its own pass, before
 * the shadow is set, so a highlight never wears the text's shadow.
 */
function paintHighlights(p: Paint, frags: Fragment[], x0: number, y: number) {
  for (const fr of frags) {
    if (!fr.h) continue
    const r = decorationRect(
      'h',
      x0 + fr.x * p.scale,
      fr.w * p.scale,
      y - p.middle,
      p.f.size * p.scale,
    )
    p.ctx.fillStyle = fr.h
    p.ctx.fillRect(r.x, r.y, r.w, r.h)
  }
}

/**
 * A line's ink, stretch by stretch from `x0` on baseline `y`: the underline
 * under the glyphs, stroke under fill, the strikethrough over them. A
 * stretch is set in its own font and colour; one for an unstyled line.
 */
function paintInk(p: Paint, frags: Fragment[], x0: number, y: number) {
  const { ctx, scale } = p
  const em = p.f.size * scale
  for (const fr of frags) {
    ctx.font = p.fonts[fr.f || 0]
    const color = fr.c || p.f.color
    const x = x0 + fr.x * scale
    if (fr.u) {
      const r = decorationRect('u', x, fr.w * scale, y - p.middle, em)
      ctx.fillStyle = color
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
    drawRun(p, fr.t, x, y, color)
    if (fr.s) {
      const r = decorationRect('s', x, fr.w * scale, y - p.middle, em)
      ctx.fillStyle = color
      ctx.fillRect(r.x, r.y, r.w, r.h)
    }
  }
}

/** Size a canvas for a raster and put the context in the text's state. */
function beginRaster(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  designWidth: number,
  designHeight: number,
  f: ResolvedTextFont,
  scale: number,
  native: boolean,
) {
  canvas.width = Math.max(1, Math.round(designWidth * scale))
  canvas.height = Math.max(1, Math.round(designHeight * scale))
  if (native) {
    ;(ctx as any).letterSpacing = `${f.letterSpacing * scale}px`
  }
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

function makeTextTexture(
  THREE: typeof THREE_NS,
  canvas: HTMLCanvasElement,
  resolution: RasterResolution | undefined,
) {
  const texture = new THREE.CanvasTexture(canvas)
  // The canvas holds sRGB pixels; without this the renderer treats them as
  // linear and encodes them again, and every colour renders lighter.
  texture.colorSpace = THREE.SRGBColorSpace
  // Mipmaps + anisotropy: minified/animated text stops shimmering, and
  // oblique (tilted) text stays legible. WebGL2 handles NPOT mipmaps.
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.anisotropy = Math.min(8, resolution?.maxAnisotropy ?? 1)
  texture.needsUpdate = true
  return texture
}

/** Hysteresis so live-preview window drags don't thrash re-rasters. */
const RERASTER_THRESHOLD = 0.05

/**
 * Map a props-proxy raster prop write (SET_ELEMENT_PROPS / timeline) to a
 * text config patch. Returns null for props this element cannot apply.
 * `content` is a string or a list of runs; anything else becomes its words.
 */
export function rasterPropPatch(
  prop: string,
  value: unknown,
  element: any,
): any | null {
  switch (prop) {
    case 'content':
      return { content: toRichText(value) }
    case 'fontSize':
      return { font: { size: Number(value) } }
    case 'fontFamily':
      return { font: { family: String(value) } }
    case 'fontWeight':
      return { font: { weight: value as number | string } }
    case 'fontStyle':
      return { font: { style: String(value) } }
    case 'letterSpacing':
      return { font: { letterSpacing: Number(value) } }
    case 'color':
      return { font: { color: String(value) } }
    case 'strokeColor':
      return {
        stroke: { color: String(value), width: element.stroke?.width ?? 2 },
      }
    case 'strokeWidth': {
      const w = Number(value)
      if (!(w > 0)) return { stroke: null }
      return { stroke: { color: element.stroke?.color ?? '#000000', width: w } }
    }
    default:
      return null
  }
}

/** Coalesce two queued raster patches (later wins; font/stroke sub-merge). */
export function mergeQueuedPatches(a: any, b: any): any {
  const out = { ...a, ...b }
  if (a?.font && b?.font) out.font = { ...a.font, ...b.font }
  if (a?.stroke && b?.stroke) out.stroke = { ...a.stroke, ...b.stroke }
  return out
}

/** Deep-merge a live edit patch into a text element config (in place). */
export function mergeTextPatch(element: any, patch: any): void {
  if (patch.content !== undefined) element.content = patch.content
  if (patch.font) element.font = { ...(element.font ?? {}), ...patch.font }
  if (patch.stroke !== undefined) {
    element.stroke = patch.stroke
      ? { ...(element.stroke ?? {}), ...patch.stroke }
      : undefined
  }
  if (patch.shadow !== undefined) {
    element.shadow = patch.shadow
      ? { ...(element.shadow ?? {}), ...patch.shadow }
      : undefined
  }
}

/**
 * Render text to canvas and create a textured plane.
 *
 * The canvas is rasterized at the drawing-buffer texel density
 * (`rasterScaleFor(resolution)`), while the plane geometry and the returned
 * width/height stay in DESIGN px — so layout math is scale-independent and a
 * 4K export gets a 4K raster instead of a magnified 1080p one.
 *
 * The returned `rerender(patch)` re-measures and re-rasters IN PLACE for
 * live editing: the mesh object keeps its identity (scene membership, render
 * order, props-proxy closures and timeline bindings all stay valid) while
 * geometry and texture are swapped under it.
 */
export function renderTextElement(
  element: any,
  resolution: any,
  THREE: typeof THREE_NS,
) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const native = supportsLetterSpacing(ctx)

  // --- Measure in design px -------------------------------------------------
  // The element's measured layout is a pure function (`text/element.ts`),
  // here over a probe on this raster's own canvas. A probe is made per
  // measure: a resized canvas forgets the font the last one set.
  const measureLayout = (): TextElementLayout =>
    layoutTextElement(element, canvasTextProbe(ctx))

  // --- Raster at buffer texel density --------------------------------------
  const scaleFor = (res: RasterResolution | undefined, l: TextElementLayout) =>
    clampRasterScale(
      rasterScaleFor(res),
      l.designWidth,
      l.designHeight,
      res?.maxTextureSize,
    )

  const draw = (l: TextElementLayout, rs: number) => {
    beginRaster(canvas, ctx, l.designWidth, l.designHeight, l.f, rs, native)
    const { metrics } = l.block
    const paint: Paint = {
      ctx,
      element,
      f: l.f,
      fonts: l.variants.map((v) => textFontString(l.f, v, rs)),
      scale: rs,
      native,
      middle: middleAboveBaseline(metrics) * rs,
    }
    const at = (i: number) =>
      [
        (l.padding + l.block.lines[i].indent) * rs,
        (l.padding + metrics.ascent + i * metrics.advance) * rs,
      ] as const
    l.block.lines.forEach((line, i) => {
      paintHighlights(paint, line.frags, ...at(i))
    })
    applyShadow(ctx, element, rs)
    l.block.lines.forEach((line, i) => {
      paintInk(paint, line.frags, ...at(i))
    })
  }

  let layout = measureLayout()
  let rasterScale = scaleFor(resolution, layout)
  let lastResolution: RasterResolution | undefined = resolution
  draw(layout, rasterScale)

  const material = new THREE.MeshBasicMaterial({
    map: makeTextTexture(THREE, canvas, resolution),
    transparent: true,
    depthWrite: false,
  })

  const swapTexture = (res: RasterResolution | undefined) => {
    // Recreate the texture: a resized backing canvas needs fresh GPU storage,
    // and dispose-and-replace is the reliable path across three versions.
    const old = material.map
    material.map = makeTextTexture(THREE, canvas, res)
    old?.dispose()
  }

  // Geometry in DESIGN units: only the texture density changes with
  // resolution, never the layout.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(layout.designWidth, layout.designHeight),
    material,
  )

  const rerasterize = (res: RasterResolution | undefined) => {
    const next = scaleFor(res, layout)
    if (Math.abs(next - rasterScale) / rasterScale < RERASTER_THRESHOLD) {
      return false
    }
    rasterScale = next
    lastResolution = res
    draw(layout, next)
    swapTexture(res)
    return true
  }

  /** Live edit: merge the patch, re-measure, re-raster, swap geometry. */
  const rerender = (patch: any) => {
    mergeTextPatch(element, patch)
    layout = measureLayout()
    rasterScale = scaleFor(lastResolution, layout)
    draw(layout, rasterScale)
    swapTexture(lastResolution)
    mesh.geometry.dispose()
    mesh.geometry = new THREE.PlaneGeometry(
      layout.designWidth,
      layout.designHeight,
    )
    return { width: layout.designWidth, height: layout.designHeight }
  }

  return {
    mesh,
    canvas,
    width: layout.designWidth,
    height: layout.designHeight,
    rasterScale,
    rerasterize,
    rerender,
  }
}

/**
 * Render a single text unit (char/word/line) to its own canvas + mesh: its
 * stretches (`parts`, one for a unit set in one style) drawn from the unit's
 * left. Same design-px geometry / buffer-density raster contract as above.
 */
function renderTextSegment(
  parts: Fragment[],
  textWidth: number,
  f: ResolvedTextFont,
  variants: FontVariant[],
  metrics: LineMetrics,
  element: any,
  THREE: typeof THREE_NS,
  resolution?: any,
) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const native = supportsLetterSpacing(ctx)

  const padding = textElementPadding(element, 4)
  const designWidth = Math.ceil(textWidth + padding * 2)
  const designHeight = Math.ceil(metrics.ascent + metrics.descent + padding * 2)

  const scaleFor = (res: RasterResolution | undefined) =>
    clampRasterScale(
      rasterScaleFor(res),
      designWidth,
      designHeight,
      res?.maxTextureSize,
    )

  const draw = (rs: number) => {
    beginRaster(canvas, ctx, designWidth, designHeight, f, rs, native)
    const paint: Paint = {
      ctx,
      element,
      f,
      fonts: variants.map((v) => textFontString(f, v, rs)),
      scale: rs,
      native,
      middle: middleAboveBaseline(metrics) * rs,
    }
    const x0 = padding * rs
    const y = (padding + metrics.ascent) * rs
    paintHighlights(paint, parts, x0, y)
    applyShadow(ctx, element, rs)
    paintInk(paint, parts, x0, y)
  }

  let rasterScale = scaleFor(resolution)
  draw(rasterScale)

  const material = new THREE.MeshBasicMaterial({
    map: makeTextTexture(THREE, canvas, resolution),
    transparent: true,
    depthWrite: false,
  })

  const geometry = new THREE.PlaneGeometry(designWidth, designHeight)
  const mesh = new THREE.Mesh(geometry, material)

  const rerasterize = (res: RasterResolution | undefined) => {
    const next = scaleFor(res)
    if (Math.abs(next - rasterScale) / rasterScale < RERASTER_THRESHOLD) {
      return false
    }
    rasterScale = next
    draw(next)
    const old = material.map
    material.map = makeTextTexture(THREE, canvas, res)
    old?.dispose()
    return true
  }

  return {
    mesh,
    width: designWidth,
    height: designHeight,
    rerasterize,
  }
}

/**
 * Render split text — one mesh per char/word/line unit, laid out by the pure
 * layout module: multi-line content keeps its line structure (lines stack
 * vertically), words keep their real whitespace advances, chars segment by
 * grapheme cluster, and `font.align` / `font.lineHeight` are honored. A unit
 * that crosses a style boundary draws each stretch in its own style.
 */
export function renderSplitTextElement(
  element: any,
  resolution: any,
  THREE: typeof THREE_NS,
) {
  const splitType = element.split?.type ?? 'chars'
  const f = resolveTextFont(element.font ?? {})
  const { lines, variants } = textElementSource(element.content, f)

  // Raw design-px measurer (NO letter-spacing): the layout adds spacing
  // itself so the math is identical on every engine.
  const measureCtx = document.createElement('canvas').getContext('2d')!
  const fonts = variants.map((v) => textFontString(f, v, 1))
  measureCtx.font = fonts[0]
  const metrics = lineMetricsFrom(
    measureCtx.measureText('Mg'),
    f.size,
    f.lineHeight,
  )

  const layout = layoutSplitUnits(
    lines,
    splitType,
    { letterSpacing: f.letterSpacing, align: f.align, metrics },
    measurer(measureCtx, fonts),
  )

  const meshes = layout.units.map((unit) => {
    const result = renderTextSegment(
      unit.parts,
      unit.width,
      f,
      variants,
      metrics,
      element,
      THREE,
      resolution,
    )
    return {
      mesh: result.mesh,
      width: result.width,
      height: result.height,
      textWidth: unit.width,
      text: unit.text,
      offsetX: unit.offsetX,
      offsetY: unit.offsetY,
      rerasterize: result.rerasterize,
    }
  })

  return {
    meshes,
    totalWidth: layout.width,
    totalHeight: layout.height,
  }
}
