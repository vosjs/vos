/**
 * An HTML layer: a UI component authored as markup and CSS, laid out and
 * painted by the browser itself, composited over the footage like a picture.
 *
 * WHY. A product video points at a piece of UI, and the camera is the only
 * pointing device a recording has: a zoom magnifies recorded pixels, so the
 * thing the video is about becomes the blurriest thing on screen. A layer
 * rasterized FROM SOURCE at the size each frame asks for has no such ceiling
 * (measured ~4x sharper than the same component magnified at 6x).
 *
 * HOW. An SVG carrying a `<foreignObject>` lays out real HTML with real CSS,
 * and an `<img>` pointed at that SVG rasterizes it. Two rules force the shape
 * everything here serves. A foreignObject SVG is origin-clean ONLY as a
 * `data:` URI (served from a URL it taints the canvas even same-origin, and a
 * tainted frame cannot be uploaded as a WebGL texture, so every layer vanishes
 * at once). And an SVG loaded through `<img>` may fetch NOTHING: a
 * `@font-face` naming a URL is silently ignored and the text falls back. So
 * the document keeps the SOURCE (a few hundred bytes), the page fetches the
 * faces by ordinary `fetch` and inlines them, and what the compositor draws
 * is an inline, vector, origin-clean picture.
 *
 * ONE COMPOSER. `htmlLayerSvg` here is the SVG document. The page builder in
 * `lower/studioEntry.ts` is a function STRING and cannot import it, so it
 * carries a mirror (`HTML_LAYER_SVG_CODE`), pinned byte-for-byte by
 * `htmlOverlay.test.ts`. Change them together.
 *
 * Pure: the studio, the CLI's lint and a test get the same answer for the
 * same source.
 */
import { findFontFamily, fontFaceUrl, nearestFontWeight } from '@vosjs/shared'
import type { HtmlOverlayClip, HtmlOverlayFont } from './types'

/** The design frame an HTML layer's `box` is measured against (1080p). */
export const DESIGN_FRAME_WIDTH = 1920

/** Past this many bytes of markup plus CSS the lint warns, and past the max it refuses. */
export const HTML_LAYER_WARN_BYTES = 32_000
export const HTML_LAYER_MAX_BYTES = 128_000

/** A face the page inlines: a URL the builder fetches, or already bytes. */
export interface HtmlLayerFace {
  family: string
  url: string
  weight: number
  style: 'normal' | 'italic'
}

/** What the composer takes: the source and the faces AS BYTES. */
export interface HtmlLayerSource {
  html: string
  css?: string
  box: { width: number; height: number }
  bleed?: number
  /**
   * A LIVE layer (§3.13): the picture is a function of clip-local time.
   * `t` is the moment being drawn, `data` the clip's own values for the
   * `{{data.<name>}}` placeholders. Absent = a still.
   */
  live?: boolean
  t?: number
  data?: Record<string, string | number | boolean>
}
export interface HtmlLayerInlineFace {
  family: string
  weight: number
  style: 'normal' | 'italic'
  dataUri: string
}
/** An image the source names by URL, fetched and inlined by the page. */
export interface HtmlLayerInlineAsset {
  url: string
  dataUri: string
}

/**
 * The rate a live layer is re-rasterized at: clip-local time is quantised
 * to this grid, so a frame asks for one picture and two frames at the same
 * grid step share it. 60 Hz covers every export rate the product offers.
 * MIRRORED in `HTML_LAYER_LIVE_HZ_CODE`'s user in `lower/studioEntry.ts`.
 */
export const HTML_LAYER_LIVE_HZ = 60

/** The host an SVG image's page can fetch an asset from (CORS and the fleet). */
export const HTML_LAYER_ASSET_HOST = 'https://assets.vos.so/'

// ---------------------------------------------------------------- faces --

/**
 * Split a CSS value on the commas that separate its LIST ITEMS, not the
 * ones inside `rgba(...)` or `url(...)`.
 */
function splitTopLevel(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

const unquote = (s: string): string =>
  s.trim().replace(/^['"]/, '').replace(/['"]$/, '').trim()

/** The families the CSS names, in order, deduped, generic families dropped. */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
  'inherit',
  'initial',
  'unset',
])

export function cssFamilies(css: string | undefined): string[] {
  if (!css) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const decl of css.match(/font-family\s*:[^;}]+/gi) ?? []) {
    for (const item of splitTopLevel(decl.replace(/^[^:]*:/, ''))) {
      const name = unquote(item.replace(/!important/i, ''))
      if (!name) continue
      const lower = name.toLowerCase()
      if (GENERIC_FAMILIES.has(lower) || lower.startsWith('-apple-')) continue
      if (seen.has(lower)) continue
      seen.add(lower)
      out.push(name)
    }
  }
  return out
}

/**
 * The weights the CSS and the markup ask for: `font-weight` numbers and
 * keywords (`bold` is 700, `normal` 400), plus 700 when the markup carries a
 * `<b>`, `<strong>` or a heading, because the browser sets those bold. 400
 * is always in the list: it is what an unweighted run sets.
 */
export function cssWeights(css: string | undefined, html = ''): number[] {
  const out = new Set<number>([400])
  for (const decl of css?.match(/font-weight\s*:[^;}]+/gi) ?? []) {
    const value = decl.replace(/^[^:]*:/, '').toLowerCase()
    for (const n of value.match(/\b[1-9]00\b/g) ?? []) out.add(Number(n))
    if (/\bbold(er)?\b/.test(value)) out.add(700)
  }
  if (/<(b|strong|h[1-6])[\s>]/i.test(html)) out.add(700)
  return [...out].sort((a, b) => a - b)
}

/**
 * The faces the page inlines for a layer: every family the CSS names that
 * the CATALOG hosts, at every weight the source asks for (snapped to the
 * steps the catalog hosts, deduped), then the clip's explicit `fonts` for a
 * face outside the catalog. Nobody types a catalog URL: the CSS names the
 * family and this finds it, the same way a text clip's `family` resolves.
 * A family the catalog does not host resolves to nothing here and falls back
 * to the wrapper's system stack in the page, which is what `vos validate`
 * warns about.
 */
export function htmlLayerFaces(
  clip: Pick<HtmlOverlayClip, 'html' | 'css' | 'fonts'>,
): HtmlLayerFace[] {
  const faces: HtmlLayerFace[] = []
  const seen = new Set<string>()
  const add = (f: HtmlLayerFace) => {
    const key = `${f.family.toLowerCase()}|${f.weight}|${f.style}`
    if (seen.has(key)) return
    seen.add(key)
    faces.push(f)
  }
  const weights = cssWeights(clip.css, clip.html)
  for (const family of cssFamilies(clip.css)) {
    const entry = findFontFamily(family)
    if (!entry) continue
    for (const w of weights)
      add({
        family: entry.family,
        url: fontFaceUrl(entry.slug, nearestFontWeight(entry, w)),
        weight: nearestFontWeight(entry, w),
        style: 'normal',
      })
  }
  for (const f of clip.fonts ?? [])
    add({
      family: f.family,
      url: f.url,
      weight: f.weight ?? 400,
      style: f.style ?? 'normal',
    })
  return faces
}

/** The families the CSS names that the catalog does NOT host and no explicit font covers. */
export function htmlLayerUnhostedFamilies(
  clip: Pick<HtmlOverlayClip, 'css' | 'fonts'>,
): string[] {
  const explicit = new Set(
    (clip.fonts ?? []).map((f) => f.family.toLowerCase()),
  )
  return cssFamilies(clip.css).filter(
    (f) => !findFontFamily(f) && !explicit.has(f.toLowerCase()),
  )
}

// --------------------------------------------------------------- assets --

/**
 * The images the source names by URL: `src="https://…"` in the markup and
 * `url(https://…)` in the CSS. An SVG loaded through <img> fetches nothing,
 * so the page fetches these the way it fetches faces and the composer
 * swaps each URL for its bytes. Deduped, in source order. Only a host the
 * page can fetch (CORS) and the fleet can reach counts as inlinable; the
 * lint says so about any other.
 */
export function htmlLayerAssetUrls(
  clip: Pick<HtmlOverlayClip, 'html' | 'css'>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (u: string) => {
    if (!seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  // As written in the source (the composer swaps the literal), a
  // protocol-relative `//host/…` included: it resolves against the page.
  for (const m of clip.html.matchAll(
    /\bsrc\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi,
  ))
    add(m[1])
  for (const text of [clip.html, clip.css ?? ''])
    for (const m of text.matchAll(
      /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)["']?\s*\)/gi,
    ))
      add(m[1])
  return out
}

/** The named assets the page can inline, and the ones it cannot. */
export function htmlLayerAssets(clip: Pick<HtmlOverlayClip, 'html' | 'css'>): {
  inlinable: string[]
  foreign: string[]
} {
  const inlinable: string[] = []
  const foreign: string[] = []
  for (const u of htmlLayerAssetUrls(clip))
    (u.replace(/^\/\//, 'https://').startsWith(HTML_LAYER_ASSET_HOST)
      ? inlinable
      : foreign
    ).push(u)
  return { inlinable, foreign }
}

// ---------------------------------------------------------------- bleed --

/**
 * How much room the CSS's shadows need outside the component's box, in
 * design px: the furthest any shadow reaches (offset plus blur plus spread),
 * rounded up with a margin.
 *
 * The SVG viewport clips hard. A card that fills its box exactly gets its
 * shadow sliced off at the edge, and because a shadow is usually offset
 * downward it pools in the lower corners, so the layer's rounded corners
 * come out as a grey square instead of transparency (measured: corner alpha
 * 6, 6 and 32 with no bleed, 0 everywhere with it). A rough upper bound read
 * off the declarations, not a CSS parser: over-reserving costs a few
 * transparent pixels, under-reserving is the clipped-corner bug.
 */
export function htmlLayerBleedFor(css: string | undefined): number {
  if (!css) return 0
  let worst = 0
  const consider = (layer: string) => {
    // An inset shadow paints inside the box and needs no room outside it.
    if (/\binset\b/i.test(layer)) return
    // Drop colours before reading lengths: a colour carries numbers of its
    // own, and a unitless 0 is a legal length, so they cannot be told apart
    // after.
    const lengths = layer
      .replace(/[a-z-]+\([^)]*\)/gi, ' ')
      .replace(/#[0-9a-f]{3,8}/gi, ' ')
      .match(/-?\d*\.?\d+/g)
    if (!lengths) return
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths.map(Number)
    worst = Math.max(
      worst,
      Math.abs(x) + blur + spread,
      Math.abs(y) + blur + spread,
    )
  }
  for (const decl of css.match(/box-shadow\s*:[^;}]+/gi) ?? [])
    for (const layer of splitTopLevel(decl.replace(/^[^:]*:/, '')))
      consider(layer)
  // `filter` reaches outside the box only through drop-shadow(); a blur() or
  // a brightness() stays within it.
  for (const fn of css.match(/drop-shadow\(([^)]*)\)/gi) ?? [])
    consider(fn.replace(/^drop-shadow\(/i, '').replace(/\)$/, ''))
  return worst ? Math.ceil(worst * 1.15) : 0
}

/** The bleed a layer renders with: the stated one, else what its CSS needs. */
export function htmlLayerBleed(
  clip: Pick<HtmlOverlayClip, 'css' | 'bleed'>,
): number {
  return Math.max(0, Math.round(clip.bleed ?? htmlLayerBleedFor(clip.css)))
}

// ------------------------------------------------------------- geometry --

/**
 * The picture's box: the component plus its bleed on every side. This is
 * what `width` sizes and what the hit rect measures, because the bleed is
 * part of the rasterized picture (transparent, but there).
 */
export function htmlLayerPictureBox(
  clip: Pick<HtmlOverlayClip, 'box' | 'css' | 'bleed'>,
): { width: number; height: number; bleed: number } {
  const bleed = htmlLayerBleed(clip)
  return {
    width: clip.box.width + bleed * 2,
    height: clip.box.height + bleed * 2,
    bleed,
  }
}

/**
 * The layer's width as a fraction of the FRAME width (the media overlay
 * convention; ON_FRAME paints `w · W`). Absent, the DESIGN SIZE: the picture
 * box over 1920, so a component designed at 452 px lands at 452 px in a
 * 1080p frame and scales with the export. The bleed is in the picture, so it
 * is in the default too, or a shadowed component would land narrower than
 * it was designed.
 */
export function htmlLayerWidth(
  clip: Pick<HtmlOverlayClip, 'width' | 'box' | 'css' | 'bleed'>,
): number {
  if (clip.width != null) return clip.width
  return Math.min(1, htmlLayerPictureBox(clip).width / DESIGN_FRAME_WIDTH)
}

// ---------------------------------------------------------------- label --

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** The words the markup carries, for a lane label: tags stripped, entities read. */
export function htmlLayerText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
      if (ref[0] === '#')
        return String.fromCodePoint(
          ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1)),
        )
      return ENTITIES[ref.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** The timeline item's label: the first words, else the kind. */
export function htmlLayerLabel(clip: Pick<HtmlOverlayClip, 'html'>): string {
  const words = htmlLayerText(clip.html)
  return words ? words.slice(0, 24) : 'HTML'
}

// -------------------------------------------------------------- problems --

export type HtmlLayerProblemCode =
  | 'empty'
  | 'unclosed-void'
  | 'bare-ampersand'
  | 'unquoted-attr'
  | 'too-large'
  | 'foreign-field'
  | 'shadow-clipped'
  | 'external-resource'
  | 'wall-clock'
  | 'live-delay'
  | 'placeholder-still'
  | 'unhosted-family'

/** `{{t}}` or `{{data.<name>}}` anywhere in a text. */
export const HTML_LAYER_PLACEHOLDER = /\{\{\s*(t|data\.[A-Za-z0-9_.-]+)\s*\}\}/

export interface HtmlLayerProblem {
  code: HtmlLayerProblemCode
  /** A problem stops the layer painting; a warning is a layer that paints wrong. */
  level: 'problem' | 'warning'
  message: string
}

/** XML rules HTML forgives and `foreignObject` does not. */
const VOID_TAGS = [
  'br',
  'img',
  'hr',
  'input',
  'source',
  'col',
  'area',
  'base',
  'wbr',
  'meta',
  'link',
]

/** Media-clip fields an HTML layer refuses: its CSS is its chrome. */
export const HTML_LAYER_FOREIGN_FIELDS = [
  'key',
  'radius',
  'shadow',
  'border',
  'loop',
  'frame',
  'fx',
  'text',
  'preset',
] as const

/**
 * Everything wrong with a layer that can be seen in its source, in words. A
 * malformed document does not warn in the page: the `<img>` fails to decode,
 * the layer never paints, and nothing anywhere says why. Checked here so an
 * author is told instead, the same answer in the studio, in `vos validate`
 * and in a test.
 */
export function htmlLayerProblems(
  clip: Pick<HtmlOverlayClip, 'html' | 'css' | 'bleed' | 'fonts' | 'live'>,
): HtmlLayerProblem[] {
  const html = clip.html ?? ''
  const css = clip.css
  const raw = clip as unknown as Record<string, unknown>
  const problems: HtmlLayerProblem[] = []
  const push = (
    code: HtmlLayerProblemCode,
    level: HtmlLayerProblem['level'],
    message: string,
  ) => problems.push({ code, level, message })

  if (!html.trim()) push('empty', 'problem', 'The layer has no markup.')

  for (const tag of VOID_TAGS) {
    const open = new RegExp(`<${tag}(\\s[^>]*?)?>`, 'gi')
    let m: RegExpExecArray | null
    let said = false
    while ((m = open.exec(html))) {
      if (!m[0].trimEnd().endsWith('/>') && !said) {
        said = true
        push(
          'unclosed-void',
          'problem',
          `<${tag}> must close itself as <${tag} /> inside a foreignObject.`,
        )
      }
    }
  }
  const bare = html.match(/&(?!(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g)
  if (bare)
    push(
      'bare-ampersand',
      'problem',
      `A bare "&" is a parse error; write &amp;. Found ${bare.length}.`,
    )
  if (/<[a-zA-Z][^>]*?\s[a-zA-Z-]+=(?!["'])[^\s>]+/.test(html))
    push(
      'unquoted-attr',
      'problem',
      'Attribute values must be quoted inside a foreignObject.',
    )

  const bytes = html.length + (css?.length ?? 0)
  if (bytes > HTML_LAYER_MAX_BYTES)
    push(
      'too-large',
      'problem',
      `The layer's source is ${Math.round(bytes / 1000)} KB; the ceiling is ${HTML_LAYER_MAX_BYTES / 1000} KB. Inline less, or split the layer.`,
    )
  else if (bytes > HTML_LAYER_WARN_BYTES)
    push(
      'too-large',
      'warning',
      `The layer's source is ${Math.round(bytes / 1000)} KB. A document carries it twice (the doc and the composed config); keep a layer under ${HTML_LAYER_WARN_BYTES / 1000} KB.`,
    )

  for (const field of HTML_LAYER_FOREIGN_FIELDS)
    if (raw[field] !== undefined)
      push(
        'foreign-field',
        'problem',
        `An HTML layer has no "${field}": its CSS is its chrome (shadow, radius, border) and its markup its content.`,
      )

  // A shadow with no room to land is clipped square by the SVG viewport, so
  // the layer's rounded corners come out grey. Only a STATED bleed can be
  // too small: an absent one is derived from the CSS at lowering.
  const needed = htmlLayerBleedFor(css)
  if (clip.bleed != null && needed > clip.bleed)
    push(
      'shadow-clipped',
      'warning',
      `The CSS paints up to ${needed}px outside the component and bleed is ${clip.bleed}, so the shadow is clipped square at the layer's edge. Set bleed to ${needed}, or leave it out to derive it.`,
    )

  // An SVG loaded through <img> fetches nothing, so the page fetches what
  // the source names by URL and inlines it, the way it inlines faces. It
  // can do that only from the host the page may read (CORS) and the fleet
  // can reach; anything else paints as a blank.
  for (const u of htmlLayerAssets({ html, css }).foreign)
    push(
      'external-resource',
      'warning',
      `The source names ${u} by URL. The page inlines only ${HTML_LAYER_ASSET_HOST}… (the host it may fetch, and the one the fleet reaches), so this will paint blank. Upload it (vos asset upload) or inline it as a data: URI.`,
    )
  if (/\bhref\s*=\s*["']\s*(https?:)?\/\//i.test(html))
    push(
      'external-resource',
      'warning',
      'The source names a stylesheet or a link by URL. An SVG image fetches no href; inline the styles in the CSS.',
    )

  // A CSS animation inside a STILL layer runs on the WALL CLOCK from decode
  // time, never on the video's t: an export that cold-seeks catches it at an
  // arbitrary phase and never matches the preview. A LIVE layer scrubs the
  // same keyframes to t (paused, delayed by -t), which is the honest form;
  // it overrides an authored delay to do so.
  const animated = /\b(animation|transition)(-[a-z-]+)?\s*:/i.test(css ?? '')
  if (animated && !clip.live)
    push(
      'wall-clock',
      'warning',
      "CSS animations inside a layer run on the wall clock, not the timeline: the export will not match the preview. Set live: true to scrub them to the clip's time, or animate the layer with motion and anim.",
    )
  if (clip.live && /\banimation-delay\s*:/i.test(css ?? ''))
    push(
      'live-delay',
      'warning',
      'A live layer scrubs its keyframes by setting animation-delay to -t, so the authored animation-delay is overridden. Fold the delay into the keyframes instead.',
    )
  if (
    !clip.live &&
    (HTML_LAYER_PLACEHOLDER.test(html) ||
      HTML_LAYER_PLACEHOLDER.test(css ?? ''))
  )
    push(
      'placeholder-still',
      'warning',
      'The source carries {{t}} or {{data.…}} placeholders, which fill only on a live layer (live: true); a still layer shows them as written.',
    )

  for (const family of htmlLayerUnhostedFamilies(clip))
    push(
      'unhosted-family',
      'warning',
      `The CSS names "${family}", which is not a hosted family (GET https://vos.so/api/fonts); the system stack stands in.`,
    )

  return problems
}

/**
 * The real XML question, asked of a real parser: the studio hands in
 * `DOMParser`, a test hands in a stub. The CLI does not call this (Node
 * ships no parser) and relies on the heuristics above plus the page's own
 * decode report.
 */
export function wellFormedXml(
  svg: string,
  parseXml: (text: string) => {
    getElementsByTagName: (name: string) => ArrayLike<{
      textContent: string | null
    }>
  },
): { ok: true } | { ok: false; error: string } {
  const doc = parseXml(svg)
  const errors = doc.getElementsByTagName('parsererror')
  if (!errors.length) return { ok: true }
  const text = (errors[0].textContent ?? '').replace(/\s+/g, ' ').trim()
  return { ok: false, error: text || 'The markup is not well-formed XML.' }
}

// -------------------------------------------------------------- composer --

/** `@font-face` blocks for the inlined faces, or '' when there are none. */
function fontFaceCss(faces: readonly HtmlLayerInlineFace[]): string {
  let out = ''
  for (const f of faces)
    out +=
      `@font-face{font-family:'${f.family}';` +
      `src:url(${f.dataUri}) format('woff2');` +
      `font-weight:${f.weight};` +
      `font-style:${f.style};` +
      `font-display:block}`
  return out
}

/** Clip-local time as it is written into the picture: up to 3 decimals, no trailing zeros. */
const fmtT = (t: number): string => String(Math.round(t * 1000) / 1000)

/** A placeholder's value, escaped for XML (a value is data, never markup). */
const escapeXml = (v: string | number | boolean): string =>
  String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * The SVG document for a layer: self-contained, laid out in DESIGN units
 * (the viewBox), so the browser rasterizes it at whatever size a frame asks
 * for. The wrapper fixes the box, insets the component by its bleed and
 * resets the two properties an SVG document does not inherit sensibly;
 * everything else is the author's.
 *
 * Assets the source names by URL are swapped for their bytes. A LIVE layer
 * is composed for one moment: `{{t}}` and `{{data.<name>}}` fill, and a
 * scrub block after the author's CSS pauses every animation and delays it
 * by -t, so the browser lays the frame out at exactly that offset (the
 * standard way to scrub a CSS animation, here applied per picture).
 *
 * MIRRORED by `HTML_LAYER_SVG_CODE` in `lower/studioEntry.ts`. Change both.
 */
export function htmlLayerSvg(
  src: HtmlLayerSource,
  faces: readonly HtmlLayerInlineFace[] = [],
  assets: readonly HtmlLayerInlineAsset[] = [],
): string {
  const bleed = Math.max(0, Math.round(src.bleed ?? 0))
  const boxW = src.box.width + bleed * 2
  const boxH = src.box.height + bleed * 2
  const t = src.t ?? 0
  const fill = (text: string): string => {
    let out = text
    for (const a of assets) out = out.split(a.url).join(a.dataUri)
    if (src.live) {
      out = out.replace(/\{\{\s*t\s*\}\}/g, fmtT(t))
      out = out.replace(
        /\{\{\s*data\.([A-Za-z0-9_.-]+)\s*\}\}/g,
        (_m, name: string) => {
          const v = src.data ? src.data[name] : undefined
          return v == null ? '' : escapeXml(v)
        },
      )
    }
    return out
  }
  const scrub = src.live
    ? `.vos-html-layer{--vos-t:${fmtT(t)}}` +
      `.vos-html-layer,.vos-html-layer *{animation-play-state:paused!important;` +
      `animation-delay:calc(var(--vos-t) * -1s)!important}`
    : ''
  const wrapper =
    `.vos-html-layer{width:${boxW}px;height:${boxH}px;` +
    `box-sizing:border-box;margin:0;padding:${bleed}px;` +
    `font-family:-apple-system,system-ui,sans-serif;` +
    `-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}`
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${boxW}" height="${boxH}" viewBox="0 0 ${boxW} ${boxH}">` +
    `<foreignObject x="0" y="0" width="${boxW}" height="${boxH}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="vos-html-layer">` +
    `<style>${fontFaceCss(faces)}${wrapper}${fill(src.css ?? '')}${scrub}</style>` +
    fill(src.html) +
    `</div></foreignObject></svg>`
  )
}

// ------------------------------------------------------------------- key --

/** FNV-1a over a string: cheap, stable, and enough to tell two sources apart. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * The layer's CACHE KEY: content-addressed over everything the picture is
 * made of (markup, CSS, box, bleed, the resolved faces), so an edit to the
 * source lands on a new key and invalidates the picture cache, the build
 * guard and the overlay canvas's dirty signature at once. Moving, retiming,
 * scaling or animating the clip does not re-key it: none of those repaint.
 * The key is a handle, never a URL: nothing may fetch it.
 */
export function htmlLayerKey(
  clip: Pick<HtmlOverlayClip, 'id' | 'html' | 'css' | 'box' | 'live' | 'data'>,
  faces: readonly HtmlLayerFace[],
  bleed: number,
  assets: readonly string[] = [],
): string {
  const src =
    clip.html +
    ' ' +
    (clip.css ?? '') +
    ' ' +
    clip.box.width +
    'x' +
    clip.box.height +
    ' ' +
    bleed +
    ' ' +
    faces.map((f) => `${f.family}:${f.url}:${f.weight}:${f.style}`).join('|') +
    ' ' +
    assets.join('|') +
    // A live layer's picture is also a function of t: ON_FRAME appends the
    // moment to this key per frame. The data rides here, the moment there.
    (clip.live ? ' live ' + JSON.stringify(clip.data ?? null) : '')
  return `html:${clip.id}:${fnv1a(src)}`
}

/** The shape the page is handed for a layer: the source plus resolved faces. */
export interface HtmlLayerPayload {
  markup: string
  css: string
  box: { width: number; height: number }
  bleed: number
  faces: HtmlLayerFace[]
  /** Images the source names by URL, for the page to fetch and inline. */
  assets: string[]
  /** A live layer: the page composes the picture per frame at clip-local t. */
  live?: true
  data?: Record<string, string | number | boolean>
}

/** Everything the lowering emits for a layer, from the clip alone. */
export function htmlLayerPayload(clip: HtmlOverlayClip): {
  key: string
  width: number
  html: HtmlLayerPayload
} {
  const faces = htmlLayerFaces(clip)
  const bleed = htmlLayerBleed(clip)
  const assets = htmlLayerAssets(clip).inlinable
  return {
    key: htmlLayerKey(clip, faces, bleed, assets),
    width: htmlLayerWidth(clip),
    html: {
      markup: clip.html,
      css: clip.css ?? '',
      box: { width: clip.box.width, height: clip.box.height },
      bleed,
      faces,
      assets,
      ...(clip.live
        ? { live: true as const, ...(clip.data ? { data: clip.data } : {}) }
        : {}),
    },
  }
}

export type { HtmlOverlayFont }
