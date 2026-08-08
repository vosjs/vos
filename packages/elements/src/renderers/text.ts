import {
  clampRasterScale,
  graphemes,
  layoutSplitUnits,
  lineMetricsFrom,
  lineWidthWithSpacing,
  rasterScaleFor,
  type LineMetrics,
  type RasterResolution,
  type TextAlign,
} from '../textLayout'
import type * as THREE_NS from 'three'

interface ResolvedFont {
  size: number
  family: string
  weight: number | string
  style: string
  color: string
  align: TextAlign
  letterSpacing: number
  lineHeight: number
}

function resolveFont(font: any): ResolvedFont {
  return {
    size: font.size ?? 24,
    family: font.family ?? 'Inter, system-ui, sans-serif',
    weight: font.weight ?? 'normal',
    style: font.style ?? 'normal',
    color: font.color ?? '#ffffff',
    align: font.align ?? 'left',
    letterSpacing: font.letterSpacing ?? 0,
    lineHeight: font.lineHeight ?? 1.2,
  }
}

function fontString(f: ResolvedFont, scale: number): string {
  return `${f.style} ${f.weight} ${f.size * scale}px ${f.family}`
}

/** `ctx.letterSpacing` is Baseline 2025; older engines get the manual path. */
function supportsLetterSpacing(ctx: CanvasRenderingContext2D): boolean {
  return 'letterSpacing' in ctx
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

/**
 * Draw one run of text at a raster position, with stroke-under-fill and
 * manual per-grapheme letter-spacing when the platform lacks the native
 * property. `x` is the LEFT edge of the run in raster px; baseline `y`.
 */
function drawRun(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  element: any,
  f: ResolvedFont,
  scale: number,
  native: boolean,
) {
  const paint = (t: string, px: number) => {
    if (element.stroke) {
      ctx.strokeStyle = element.stroke.color
      ctx.lineWidth = element.stroke.width * scale
      ctx.lineJoin = 'round'
      ctx.strokeText(t, px, y)
    }
    ctx.fillStyle = f.color
    ctx.fillText(t, px, y)
  }

  if (native || f.letterSpacing === 0) {
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

function makeTextTexture(
  THREE: typeof THREE_NS,
  canvas: HTMLCanvasElement,
  resolution: RasterResolution | undefined,
) {
  const texture = new THREE.CanvasTexture(canvas)
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

interface TextLayoutState {
  f: ResolvedFont
  lines: string[]
  lineWidths: number[]
  maxWidth: number
  metrics: LineMetrics
  padding: number
  designWidth: number
  designHeight: number
}

/**
 * Map a props-proxy raster prop write (SET_ELEMENT_PROPS / timeline) to a
 * text config patch. Returns null for props this element cannot apply.
 */
export function rasterPropPatch(
  prop: string,
  value: unknown,
  element: any,
): any | null {
  switch (prop) {
    case 'content':
      return { content: String(value) }
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
  const measureLayout = (): TextLayoutState => {
    const f = resolveFont(element.font ?? {})
    ctx.font = fontString(f, 1)
    if (native) {
      ;(ctx as any).letterSpacing = `${f.letterSpacing}px`
    }
    const lines: string[] = String(element.content ?? '').split('\n')
    const measureLine = (line: string) =>
      native
        ? ctx.measureText(line).width
        : lineWidthWithSpacing(
            line,
            f.letterSpacing,
            (t) => ctx.measureText(t).width,
          )
    let maxWidth = 0
    const lineWidths = lines.map((line) => {
      const w = measureLine(line)
      if (w > maxWidth) maxWidth = w
      return w
    })

    const metrics = lineMetricsFrom(ctx.measureText('Mg'), f.size, f.lineHeight)
    const blockHeight =
      (lines.length - 1) * metrics.advance + metrics.ascent + metrics.descent
    const padding =
      Math.max(element.stroke?.width ?? 0, element.shadow?.blur ?? 0) * 2 + 10
    return {
      f,
      lines,
      lineWidths,
      maxWidth,
      metrics,
      padding,
      designWidth: Math.ceil(maxWidth + padding * 2),
      designHeight: Math.ceil(blockHeight + padding * 2),
    }
  }

  // --- Raster at buffer texel density --------------------------------------
  const scaleFor = (res: RasterResolution | undefined, l: TextLayoutState) =>
    clampRasterScale(
      rasterScaleFor(res),
      l.designWidth,
      l.designHeight,
      res?.maxTextureSize,
    )

  const draw = (l: TextLayoutState, rs: number) => {
    canvas.width = Math.max(1, Math.round(l.designWidth * rs))
    canvas.height = Math.max(1, Math.round(l.designHeight * rs))
    ctx.font = fontString(l.f, rs)
    if (native) {
      ;(ctx as any).letterSpacing = `${l.f.letterSpacing * rs}px`
    }
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    applyShadow(ctx, element, rs)

    l.lines.forEach((line: string, i: number) => {
      const indent =
        l.f.align === 'center'
          ? (l.maxWidth - l.lineWidths[i]) / 2
          : l.f.align === 'right'
            ? l.maxWidth - l.lineWidths[i]
            : 0
      const x = (l.padding + indent) * rs
      const y = (l.padding + l.metrics.ascent + i * l.metrics.advance) * rs
      drawRun(ctx, line, x, y, element, l.f, rs, native)
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
 * Render a single text unit (char/word/line) to its own canvas + mesh.
 * Same design-px geometry / buffer-density raster contract as above.
 */
export function renderTextSegment(
  text: string,
  font: any,
  element: any,
  THREE: typeof THREE_NS,
  resolution?: any,
  metrics?: LineMetrics,
) {
  const f = resolveFont(font)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const native = supportsLetterSpacing(ctx)

  ctx.font = fontString(f, 1)
  const m =
    metrics ?? lineMetricsFrom(ctx.measureText('Mg'), f.size, f.lineHeight)
  const textWidth = lineWidthWithSpacing(
    text,
    f.letterSpacing,
    (t) => ctx.measureText(t).width,
  )

  const padding =
    Math.max(element.stroke?.width ?? 0, element.shadow?.blur ?? 0) * 2 + 4
  const designWidth = Math.ceil(textWidth + padding * 2)
  const designHeight = Math.ceil(m.ascent + m.descent + padding * 2)

  const scaleFor = (res: RasterResolution | undefined) =>
    clampRasterScale(
      rasterScaleFor(res),
      designWidth,
      designHeight,
      res?.maxTextureSize,
    )

  const draw = (rs: number) => {
    canvas.width = Math.max(1, Math.round(designWidth * rs))
    canvas.height = Math.max(1, Math.round(designHeight * rs))
    ctx.font = fontString(f, rs)
    if (native) {
      ;(ctx as any).letterSpacing = `${f.letterSpacing * rs}px`
    }
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    applyShadow(ctx, element, rs)
    drawRun(
      ctx,
      text,
      padding * rs,
      (padding + m.ascent) * rs,
      element,
      f,
      rs,
      native,
    )
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
    textWidth,
    rerasterize,
  }
}

/**
 * Render split text — one mesh per char/word/line unit, laid out by the pure
 * layout module: multi-line content keeps its line structure (lines stack
 * vertically), words keep their real whitespace advances, chars segment by
 * grapheme cluster, and `font.align` / `font.lineHeight` are honored.
 */
export function renderSplitTextElement(
  element: any,
  resolution: any,
  THREE: typeof THREE_NS,
) {
  const { content, font = {}, split } = element
  const splitType = split?.type ?? 'chars'
  const f = resolveFont(font)

  // Raw design-px measurer (NO letter-spacing): the layout adds spacing
  // itself so the math is identical on every engine.
  const measureCanvas = document.createElement('canvas')
  const measureCtx = measureCanvas.getContext('2d')!
  measureCtx.font = fontString(f, 1)
  const measure = (t: string) => measureCtx.measureText(t).width

  const metrics = lineMetricsFrom(
    measureCtx.measureText('Mg'),
    f.size,
    f.lineHeight,
  )

  const layout = layoutSplitUnits(
    content,
    splitType,
    { letterSpacing: f.letterSpacing, align: f.align, metrics },
    measure,
  )

  const meshes = layout.units.map((unit) => {
    const result = renderTextSegment(
      unit.text,
      font,
      element,
      THREE,
      resolution,
      metrics,
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
