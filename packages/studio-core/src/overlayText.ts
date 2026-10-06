/**
 * Text-overlay presets + the host-side geometry mirror (compositor v2).
 *
 * Presets are the HOUSE text styles (Lexend for content, JetBrains Mono for
 * labels — the design-system families) and are RESOLVED AT LOWERING into plain
 * numbers/strings in ctx.data, so ON_FRAME reads no registry (the
 * MINIMAL_BAR_THEMES rule). ON_FRAME builds its canvas font string as
 * `weight + ' ' + size·scale·s + 'px ' + stack` — `overlayFontString` mirrors
 * that exactly and `overlayRect` mirrors the drawn bounding box, giving the
 * studio's on-canvas picking the same geometry the renderer paints
 * (host picks / instance renders). `overlayText.test.ts` pins the
 * mirrors to the generated code — change them together.
 *
 * Fonts load in SETUP from assets.vos.so (the self-hosted catalog — the
 * render fleet can only fetch that origin) via the FontFace API, ONLY when the doc has overlays, capped +
 * fail-open (a CDN failure degrades to the system stack, never a dead render).
 */
import { overlayFxSpec } from './anim'
import {
  findFontFamily,
  fontFaceUrl,
  fontStack,
  nearestFontWeight,
} from '@vosjs/shared'
import { htmlLayerPictureBox, htmlLayerWidth } from './htmlLayer'
import {
  graphemesOf,
  layoutLines,
  layoutText,
  normalizeRuns,
  plainText,
  tokenRanges,
} from '@vosjs/elements/text'
import {
  OVERLAY_LINE_HEIGHT,
  OVERLAY_MEDIA_DEFAULT_WIDTH,
  OVERLAY_TRANSITION_DUR,
} from './types'
import type { LayoutRun } from '@vosjs/elements/text'
import type {
  OverlayClip,
  ProjectDoc,
  TextFxUnit,
  TextOverlayClip,
  TextOverlayPreset,
  TextOverlayStroke,
} from './types'

/** Text-box (background pill) defaults, EMs of the resolved font size. */
export const OVERLAY_BOX_PAD_X = 0.6
export const OVERLAY_BOX_PAD_Y = 0.35
export const OVERLAY_BOX_RADIUS = 0.25

/** Baked pill geometry: design px at the clip's resolved font size. */
export interface ResolvedOverlayBox {
  color: string
  opacity: number
  /** Paddings/radius in design px (em multiples × resolved size). */
  padX: number
  padY: number
  radius: number
}

/**
 * Resolve a clip's background pill (null when absent). Mirrored by
 * `overlayRect`'s inflation and ON_FRAME's pill draw — change together.
 */
export function resolveOverlayBox(
  clip: TextOverlayClip,
): ResolvedOverlayBox | null {
  if (!clip.box) return null
  const size = resolveOverlayStyle(clip).size
  return {
    color: clip.box.color,
    opacity: clip.box.opacity ?? 1,
    padX: (clip.box.paddingX ?? OVERLAY_BOX_PAD_X) * size,
    padY: (clip.box.paddingY ?? OVERLAY_BOX_PAD_Y) * size,
    radius: (clip.box.radius ?? OVERLAY_BOX_RADIUS) * size,
  }
}

/** A preset's base values (the 5-field house style). */
export interface OverlayPresetStyle {
  /** Full CSS font-family stack (primary + fallbacks). */
  stack: string
  weight: number
  /** Font size in design px (H = 1080 space), before transform.scale. */
  size: number
  color: string
  /** Legibility shadow strength 0..1 (0 = none). */
  shadow: number
}

/** Preset base + the full override surface, resolved to concrete values. */
export interface ResolvedOverlayStyle extends OverlayPresetStyle {
  fontStyle: 'normal' | 'italic'
  align: 'left' | 'center' | 'right'
  /** Design px at the resolved size. */
  letterSpacing: number
  /** Multiplier (default OVERLAY_LINE_HEIGHT). */
  lineHeight: number
  stroke: TextOverlayStroke | null
}

/** The catalog family each preset's stack leads with (for weight snapping). */
const PRESET_FAMILY: Record<TextOverlayPreset, string> = {
  title: 'Lexend',
  caption: 'Lexend',
  label: 'JetBrains Mono',
}

/** The house text styles. Sizes in design px; colors are ink-on-footage. */
export const TEXT_PRESETS: Record<TextOverlayPreset, OverlayPresetStyle> = {
  title: {
    stack: 'Lexend, -apple-system, system-ui, sans-serif',
    weight: 600,
    size: 64,
    color: '#fafafa',
    shadow: 0.45,
  },
  caption: {
    stack: 'Lexend, -apple-system, system-ui, sans-serif',
    weight: 400,
    size: 32,
    color: '#f4f4f5',
    shadow: 0.4,
  },
  label: {
    stack: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    weight: 400,
    size: 22,
    color: '#e4e4e7',
    shadow: 0.35,
  },
}

/** Size override bounds (design px) — same range the inspector slider offers. */
export const OVERLAY_SIZE_MIN = 12
export const OVERLAY_SIZE_MAX = 200

/**
 * woff2 faces SETUP preloads when the doc has overlays (latin subset only —
 * overlay text is product UI copy). The three base preset faces, resolved
 * through the hosted catalog so this module carries no URL of its own.
 */
export const OVERLAY_FONT_FACES: {
  family: string
  weight: number
  url: string
}[] = [
  { family: 'Lexend', weight: 400, url: fontFaceUrl('lexend', 400) },
  { family: 'Lexend', weight: 600, url: fontFaceUrl('lexend', 600) },
  {
    family: 'JetBrains Mono',
    weight: 400,
    url: fontFaceUrl('jetbrains-mono', 400),
  },
]

/** Preset + per-clip overrides → the concrete style baked into ctx.data. */
export function resolveOverlayStyle(
  clip: TextOverlayClip,
): ResolvedOverlayStyle {
  // Defensive lookup: agent-authored doc.json can carry an unknown preset name.
  const presetName = clip.preset in TEXT_PRESETS ? clip.preset : 'title'
  const base = TEXT_PRESETS[presetName]

  // Family/weight resolve against the hosted catalog. A catalog family swaps
  // the whole stack (category-true fallbacks); an unknown family fails open —
  // used verbatim ahead of the preset stack, so a locally-installed font
  // still previews while the fleet degrades to the preset. Weights snap to
  // hosted steps: canvas cannot synthesize weights.
  let stack = base.stack
  let weight = base.weight
  const familyEntry = findFontFamily(clip.family ?? PRESET_FAMILY[presetName])
  if (clip.family) {
    const quoted = clip.family.includes(' ') ? `'${clip.family}'` : clip.family
    stack = familyEntry ? fontStack(familyEntry) : `${quoted}, ${base.stack}`
  }
  if (clip.weight !== undefined || clip.family) {
    const wanted = clip.weight ?? base.weight
    weight = familyEntry ? nearestFontWeight(familyEntry, wanted) : wanted
  }

  return {
    ...base,
    stack,
    weight,
    ...(clip.size !== undefined
      ? {
          size: Math.min(
            OVERLAY_SIZE_MAX,
            Math.max(OVERLAY_SIZE_MIN, clip.size),
          ),
        }
      : {}),
    ...(clip.color ? { color: clip.color } : {}),
    ...(clip.shadow !== undefined
      ? { shadow: Math.min(1, Math.max(0, clip.shadow)) }
      : {}),
    fontStyle: clip.italic ? 'italic' : 'normal',
    align: clip.align ?? 'center',
    letterSpacing: clip.letterSpacing ?? 0,
    lineHeight: clip.lineHeight ?? OVERLAY_LINE_HEIGHT,
    stroke: clip.stroke ?? null,
  }
}

export interface OverlayFontFace {
  family: string
  weight: number
  url: string
}

/**
 * The hosted face a clip's family/weight overrides resolve to, when it is
 * NOT one of the three base preset faces (null otherwise — parity: preset
 * clips carry nothing). Baked per-overlay so ON_FRAME can lazy-load it on a
 * live style edit (SET_DATA never re-runs SETUP); SETUP awaits the full list
 * from ctx.data on cold load, which is what export parity rides on.
 */
export function overlayFaceFor(clip: TextOverlayClip): OverlayFontFace | null {
  const entry = findFontFamily(
    clip.family ??
      PRESET_FAMILY[clip.preset in TEXT_PRESETS ? clip.preset : 'title'],
  )
  if (!entry) return null // unknown family: nothing hosted to load
  const weight = resolveOverlayStyle(clip).weight
  const inBase = OVERLAY_FONT_FACES.some(
    (f) => f.family === entry.family && f.weight === weight,
  )
  if (inBase) return null
  return {
    family: entry.family,
    weight,
    url: fontFaceUrl(entry.slug, weight),
  }
}

/**
 * Every woff2 face a doc's overlays need (SETUP await on cold load, and the
 * host document for measurement): the three base preset faces — ALWAYS, byte
 * parity for preset-only docs — plus one face per override.
 */
export function overlayFontFaces(
  doc: Pick<ProjectDoc, 'overlays'>,
): OverlayFontFace[] {
  const faces = [...OVERLAY_FONT_FACES]
  const seen = new Set(faces.map((f) => `${f.family}|${f.weight}`))
  const add = (face: OverlayFontFace | null | undefined) => {
    if (!face) return
    const key = `${face.family}|${face.weight}`
    if (seen.has(key)) return
    seen.add(key)
    faces.push(face)
  }
  for (const o of doc.overlays ?? []) {
    if (o.kind !== 'text') continue
    add(overlayFaceFor(o))
    // A styled layer's other faces, so the first frame has them.
    for (const f of styledTextOf(o)?.faces ?? []) {
      add({ family: f.f, weight: f.w, url: f.u })
    }
  }
  return faces
}

export function overlayLines(text: string): string[] {
  const lines = text.split('\n')
  return lines.length ? lines : ['']
}

// ---------------------------------------------------------------------------
// Styled text. A layer's `text` is a string, or a list of runs that each
// override the layer's style (`@vosjs/elements/text`). Everything that reads WORDS
// goes through `overlayPlainText`; everything that paints or measures a
// layer goes through the layout module, over `textRunsOf`.
// ---------------------------------------------------------------------------

/** The words a layer shows, whatever shape its text is in. */
export function overlayPlainText(clip: Pick<TextOverlayClip, 'text'>): string {
  return plainText(clip.text)
}

/** The catalog family a layer is set in (null for an unhosted one). */
function familyEntryOf(clip: TextOverlayClip) {
  return (
    findFontFamily(
      clip.family ??
        PRESET_FAMILY[clip.preset in TEXT_PRESETS ? clip.preset : 'title'],
    ) ?? null
  )
}

/**
 * A run's weight as it will paint: snapped to the family's hosted steps,
 * exactly as the layer's own weight is. An unhosted family takes it as is.
 */
export function snapRunWeight(clip: TextOverlayClip, weight: number): number {
  const entry = familyEntryOf(clip)
  return entry ? nearestFontWeight(entry, weight) : weight
}

/** The weight a family's bold step resolves to when nothing names one. */
const BOLD_WEIGHT = 700

/**
 * The weight Bold puts on a run of this layer: the family's bold step, 700
 * or the nearest hosted, never lighter than the layer itself. When that is
 * the layer's own weight the family has nothing bolder to offer.
 */
export function boldWeightFor(clip: TextOverlayClip): number {
  return snapRunWeight(
    clip,
    Math.max(BOLD_WEIGHT, resolveOverlayStyle(clip).weight),
  )
}

/** The styled payload a text layer bakes: what the layout module lays out. */
export interface StyledText {
  /** Source lines, each a list of runs (`f` indexes `fs`). */
  l: LayoutRun[][]
  /** The fonts the runs are set in; 0 is the layer's own. */
  fs: { w: number; i?: 1 }[]
  /** Hosted faces to load beyond the layer's own. */
  faces?: { f: string; w: number; u: string }[]
  /** A hash of `l` and `fs`: the layout's cache key and the dirty signature. */
  h: string
}

/** FNV-1a, base 36: short, stable, good enough to tell two payloads apart. */
function hashOf(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * A text layer as STYLED text (lines of runs resolved against the layer's
 * style), or null when it is set in one style throughout: such a layer
 * bakes its lines alone and is laid out as one run a line. A run's weight
 * snaps like the layer's; its italic is the layer's unless it says
 * otherwise; colour, underline, strikethrough and highlight ride as they
 * are.
 */
export function styledTextOf(clip: TextOverlayClip): StyledText | null {
  const runs = normalizeRuns(clip.text)
  if (typeof runs === 'string') return null
  const style = resolveOverlayStyle(clip)
  const italic = style.fontStyle === 'italic'
  const fs: { w: number; i?: 1 }[] = [
    { w: style.weight, ...(italic ? { i: 1 as const } : {}) },
  ]
  const fontOf = (w: number, i: boolean) => {
    let at = fs.findIndex((f) => f.w === w && !!f.i === i)
    if (at < 0) {
      fs.push({ w, ...(i ? { i: 1 as const } : {}) })
      at = fs.length - 1
    }
    return at
  }
  // The engine's own walk from runs to lines; this names each run's font.
  const l = layoutLines(runs, (run) =>
    fontOf(
      run.weight !== undefined ? snapRunWeight(clip, run.weight) : style.weight,
      run.italic ?? italic,
    ),
  )
  // The faces behind the other weights, where the catalog hosts them (an
  // italic is synthesized, like the layer's own).
  const entry = familyEntryOf(clip)
  const faces: { f: string; w: number; u: string }[] = []
  for (const font of fs.slice(1)) {
    if (!entry || font.w === style.weight) continue
    if (faces.some((x) => x.w === font.w)) continue
    const inBase = OVERLAY_FONT_FACES.some(
      (b) => b.family === entry.family && b.weight === font.w,
    )
    if (!inBase) {
      faces.push({
        f: entry.family,
        w: font.w,
        u: fontFaceUrl(entry.slug, font.w),
      })
    }
  }
  return {
    l,
    fs,
    ...(faces.length ? { faces } : {}),
    h: hashOf(JSON.stringify([l, fs])),
  }
}

/**
 * What the layout module lays out for ANY text layer: a styled layer's
 * runs, or a plain layer's lines, each one run in the layer's own style.
 * The painter builds the same input from the baked clip, so the host that
 * picks and the page that paints measure one thing.
 */
export function textRunsOf(
  clip: TextOverlayClip,
): Pick<StyledText, 'l' | 'fs'> {
  const styled = styledTextOf(clip)
  if (styled) return styled
  const style = resolveOverlayStyle(clip)
  return {
    l: overlayLines(overlayPlainText(clip)).map((t) => (t ? [{ t }] : [])),
    fs: [
      {
        w: style.weight,
        ...(style.fontStyle === 'italic' ? { i: 1 as const } : {}),
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Entrance animation. The TIMING is resolved here, at lowering, because it
// is deterministic doc-derived data; the UNITS are the layout's, cut on the
// page from the lines it laid out, so a unit is exactly what is drawn.
// Seek stays f(t): a unit's delay is its index times the stagger.
// ---------------------------------------------------------------------------

/** The baked fx payload ON_FRAME interprets (short keys — it rides ctx.data). */
export interface BakedOverlayFx {
  /** fx kind. */
  k: 'fade' | 'rise' | 'pop' | 'blur' | 'typewriter'
  /** unit granularity ('block' behaves exactly like the legacy enter). */
  u: TextFxUnit
  /** direction: 0 forward, 1 reverse, 2 center-out. */
  d: 0 | 1 | 2
  /** effective stagger seconds (clamped so the entrance fits the clip). */
  st: number
  /** per-unit duration seconds. */
  dur: number
  /** total entrance seconds — the redraw gate's animation window. */
  tt: number
}

const FX_DIR: Record<string, 0 | 1 | 2> = { forward: 0, reverse: 1, center: 2 }

/**
 * Normalize a clip's fx spec into the baked payload. Pure function of the
 * doc (determinism is the contract): defaults resolve here, stagger clamps
 * so `stagger·(n−1) + duration` never exceeds ~90% of the clip.
 */
export function resolveOverlayFx(
  clip: TextOverlayClip,
  clipDuration: number,
): BakedOverlayFx | null {
  // The step on `anim`, or the legacy `fx` field for a clip read unmigrated.
  const spec = overlayFxSpec(clip) ?? clip.fx ?? null
  if (!spec) return null
  const unit = spec.unit ?? 'block'
  const lines = overlayLines(overlayPlainText(clip))
  const count = (per: (line: string) => number) =>
    lines.reduce((sum, line) => sum + per(line), 0)
  const words = () => count((line) => tokenRanges(line).length)
  // How many units the layout will cut: the stagger clamp and the redraw
  // gate's window (tt) are sized to them.
  const n =
    unit === 'block'
      ? 1
      : unit === 'line'
        ? lines.length
        : unit === 'word'
          ? words()
          : count((line) => graphemesOf(line).length)
  // Wrapping happens at DRAW time (it needs measurement), so with maxWidth
  // active a 'line' unit means WRAPPED lines — lowering can't know how
  // many, but it CAN bound them: wrapped lines never exceed word tokens.
  const upperN = unit === 'line' && clip.maxWidth ? words() : n
  const typewriter = spec.fx === 'typewriter'
  // Typewriter is a step reveal: the per-unit duration is irrelevant, keep
  // it tiny so the last unit lands with the stagger, not 0.35s after it.
  const dur = typewriter
    ? 0.001
    : Math.min(2, Math.max(0.05, spec.duration ?? OVERLAY_TRANSITION_DUR))
  const defaultStagger = typewriter ? 0.05 : unit === 'block' ? 0 : 0.06
  let st = Math.min(2, Math.max(0, spec.stagger ?? defaultStagger))
  if (upperN > 1) {
    const maxTotal = Math.max(dur, clipDuration * 0.9)
    st = Math.min(st, Math.max(0, (maxTotal - dur) / (upperN - 1)))
  }
  const round = (v: number) => Math.round(v * 10000) / 10000
  return {
    k: spec.fx,
    u: unit,
    d: FX_DIR[spec.direction ?? 'forward'] ?? 0,
    st: round(st),
    dur: round(dur),
    tt: round(st * (upperN - 1) + dur),
  }
}

/**
 * The canvas font string at a given comp scale — MIRRORS ON_FRAME's
 * `olW + ' ' + olPx + 'px ' + olStack` (pinned by test).
 */
export function overlayFontString(
  style: ResolvedOverlayStyle,
  scale: number,
  s: number,
): string {
  const italic = style.fontStyle === 'italic' ? 'italic ' : ''
  return `${italic}${style.weight} ${style.size * scale * s}px ${style.stack}`
}

export interface OverlayRect {
  /** Center-anchored box in DESIGN px (pre-rotation). */
  cx: number
  cy: number
  w: number
  h: number
  /** Rotation in degrees (the caller rotates points into local space to hit-test). */
  rotation: number
}

/**
 * The drawn bounding box of a text overlay in DESIGN px — the picking
 * geometry. `measure(text, font)` returns the text width in px for a font
 * string (the host passes a scratch-canvas measureText; tests stub it).
 * `frameW`/`frameH` are the design frame size (docCardLayout's W/H) — the
 * clip's transform.x/y are FRACTIONS of the frame, so the anchor is
 * x·frameW / y·frameH. Measured at s = 1 (design space), so the result maps
 * to the canvas by ·s and to CSS by the player's display scale.
 */
export function overlayRect(
  clip: OverlayClip,
  measure: (text: string, font: string, letterSpacingPx?: number) => number,
  frameW: number,
  frameH = 1080,
  /** Media kinds: natural aspect (w/h) once known — null/absent = assume 16:9. */
  mediaAspect?: number | null,
): OverlayRect {
  const scale = clip.transform.scale || 1
  const base = {
    cx: clip.transform.x * frameW,
    cy: clip.transform.y * frameH,
    rotation: clip.transform.rotation || 0,
  }
  if (clip.kind === 'html') {
    // An HTML layer's aspect is its own PICTURE box (the design box plus its
    // bleed), known without probing anything, and its width defaults to the
    // design size. MIRRORS the lowering's `htmlLayerPayload`.
    const pb = htmlLayerPictureBox(clip)
    const w = htmlLayerWidth(clip) * frameW * scale
    return { ...base, w, h: w * (pb.height / pb.width) }
  }
  if (clip.kind !== 'text') {
    // MIRRORS ON_FRAME's media sizing: width fraction of the FRAME × scale,
    // height from the media's natural aspect.
    const w = (clip.width ?? OVERLAY_MEDIA_DEFAULT_WIDTH) * frameW * scale
    return { ...base, w, h: w / (mediaAspect || 16 / 9) }
  }
  const style = resolveOverlayStyle(clip)
  const ls = style.letterSpacing * scale
  // Measured by the layout module, the painter's own: the same lines, the
  // same wrap (maxWidth is a frame-width fraction; this rect works in
  // design px, so the budget is maxWidth × frameW directly).
  const runs = textRunsOf(clip)
  const fonts = runs.fs.map((f) =>
    overlayFontString(
      { ...style, weight: f.w, fontStyle: f.i ? 'italic' : 'normal' },
      scale,
      1,
    ),
  )
  const laid = layoutText(
    { lines: runs.l, maxWidth: clip.maxWidth ? clip.maxWidth * frameW : 0 },
    (t, f) => measure(t, fonts[f], ls),
  )
  const w = laid.width
  const lineCount = laid.lines.length
  const lineH = style.size * scale * style.lineHeight
  // The background pill extends the drawn (and thus pickable) bounds —
  // mirrors ON_FRAME's pill geometry exactly.
  const box = resolveOverlayBox(clip)
  const padX = box ? box.padX * scale : 0
  const padY = box ? box.padY * scale : 0
  return {
    ...base,
    w: Math.max(w, style.size * scale * 0.6) + padX * 2, // empty text still selectable
    h: lineCount * lineH + padY * 2,
  }
}

/** Point-in-overlay test (design px), rotation-aware (point → local space). */
export function overlayHit(
  rect: OverlayRect,
  px: number,
  py: number,
  padPx = 8,
): boolean {
  let dx = px - rect.cx
  let dy = py - rect.cy
  if (rect.rotation) {
    const a = (-rect.rotation * Math.PI) / 180
    const rx = dx * Math.cos(a) - dy * Math.sin(a)
    const ry = dx * Math.sin(a) + dy * Math.cos(a)
    dx = rx
    dy = ry
  }
  return (
    Math.abs(dx) <= rect.w / 2 + padPx && Math.abs(dy) <= rect.h / 2 + padPx
  )
}
