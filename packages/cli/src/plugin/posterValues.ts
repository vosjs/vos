/**
 * What fills a poster template: the brand kit's roles, the release's
 * words, and the derived tones a template reads (a softened ink, a light
 * streak, the mesh blobs) so a kit that names five colours covers every
 * binding. The headline is the maker's (LAUNCH.md or a flag); the kicker
 * is the wordmark and the release line unless the maker wrote one. Pure.
 */
import {
  findFontFamily,
  fontFaceUrl,
  fontStack,
  nearestFontWeight,
} from '@vosjs/shared'

export interface ReleaseWords {
  headline?: string | null
  kicker?: string | null
  brand?: string | null
  release?: string | null
}

export interface PosterFill {
  values: Record<string, unknown>
  /** Font faces the filled config must declare so the fleet has them. */
  fonts: { family: string; url: string; weight: number }[]
  /** Whether the ground is light (a light shot then needs a hairline). */
  lightGround: boolean
}

const HEX = /^#([0-9a-f]{6})$/i

const rgb = (hex: string): [number, number, number] | null => {
  const m = HEX.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (c: [number, number, number]) =>
  '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

export function mixHex(a: string, b: string, t: number): string {
  const pa = rgb(a)
  const pb = rgb(b)
  if (!pa || !pb) return a
  return toHex([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t])
}

export function rgba(hex: string, alpha: number): string {
  const c = rgb(hex) ?? [255, 255, 255]
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
}

export function isLightHex(hex: string): boolean {
  const c = rgb(hex)
  if (!c) return true
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 >= 0.6
}

/**
 * The brand's face for a role, resolved against the hosted catalog: the
 * family name as the engine's font stack plus the faces to declare. A
 * family the catalog does not host keeps the template's own default.
 */
export function resolveFace(
  family: string | null | undefined,
  weights: number[],
): { stack: string; fonts: { family: string; url: string; weight: number }[] } | null {
  if (!family) return null
  const first = family.split(',')[0].replace(/['"]/g, '').replace(/\s+variable$/i, '').trim()
  const entry = findFontFamily(first)
  if (!entry) return null
  const fonts = [...new Set(weights.map((w) => nearestFontWeight(entry, w)))].map((w) => ({
    family: entry.family,
    url: fontFaceUrl(entry.slug, w),
    weight: w,
  }))
  return { stack: fontStack(entry), fonts }
}

/**
 * Assemble a template's values from the brand roles and the release's
 * words. Keys a template does not read are harmless; keys it needs and
 * the brand lacks fall to the template's own defaults (absent here).
 */
export function posterValues(
  brand: Record<string, string> | null | undefined,
  words: ReleaseWords,
): PosterFill {
  const b = brand ?? {}
  const bgA = b.bgA && HEX.test(b.bgA) ? b.bgA : null
  const bgB = b.bgB && HEX.test(b.bgB) ? b.bgB : bgA
  const bgC = b.bgC && HEX.test(b.bgC) ? b.bgC : bgB
  const ink = b.ink && HEX.test(b.ink) ? b.ink : null
  const accent = b.accent && HEX.test(b.accent) ? b.accent : null
  const wordmark = (words.brand ?? b.wordmark ?? b.name ?? '').trim()
  const release = (words.release ?? '').trim()
  const lightGround = bgA ? isLightHex(bgA) : false

  const values: Record<string, unknown> = {}
  if (bgA) values.bgA = bgA
  if (bgB) values.bgB = bgB
  if (bgC) values.bgC = bgC
  if (ink) values.ink = ink
  if (accent) values.accent = accent
  if (ink && bgA) values.inkSoft = mixHex(ink, bgA, 0.38)
  if (accent) values.streak = rgba(accent, lightGround ? 0.12 : 0.18)
  if (bgA) values.grain = lightGround ? 10 : 22
  // The mesh: the accent and the highlight ground as blobs over the plate.
  if (accent) values.blobA = rgba(accent, lightGround ? 0.28 : 0.4)
  if (bgC) values.blobB = rgba(bgC, 0.75)
  if (accent) values.blobC = rgba(mixHex(accent, '#ffffff', 0.55), lightGround ? 0.35 : 0.25)
  if (wordmark) values.brand = wordmark
  const headline = (words.headline ?? '').trim()
  if (headline) values.headline = headline
  const kicker = (words.kicker ?? '').trim()
  values.kicker = kicker
    ? kicker
    : [wordmark, release].filter(Boolean).join('  ').toUpperCase()

  const fonts: PosterFill['fonts'] = []
  const display = resolveFace(b.fontDisplay, [600, 700])
  if (display) {
    values.fontDisplay = display.stack
    fonts.push(...display.fonts)
  }
  const body = resolveFace(b.fontBody, [700])
  if (body) {
    values.fontBody = body.stack
    fonts.push(...body.fonts)
  }
  return { values, fonts, lightGround }
}
