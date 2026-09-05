/**
 * `vos brand <url>` — the brand kit, witnessed. The launch-kit loop must
 * resolve the brand BEFORE any asset is authored (a template's own palette
 * on a deliverable shipped once, and that run is why this verb exists).
 * The kit is a `BRAND.md` recipe: frontmatter carries the roles the poster
 * family binds (`bgA/bgB/bgC`, `ink`, `accent`, `fontDisplay`, `logoUrl`),
 * prose carries where each value came from and what the site says to avoid.
 *
 * Three sources, in order, each read when it exists:
 *   1. `/design.md` — the convention Vercel is teaching companies to
 *      publish beside `/llms.txt`: prose for agents, font names, logo
 *      assets, a reject list. Colours there are usually CSS variable names,
 *      not values, so it never replaces witnessing; it wins on fonts, logos
 *      and the avoid list.
 *   2. `/llms.txt` — the product's name and one-line claim.
 *   3. The page itself, in a browser: theme-color, icons, og:image, the
 *      computed heading and body faces and inks, the body ground, the
 *      surfaces, and the accent (the saturated colour buttons and links
 *      agree on).
 *
 * Everything is a pure function over fetched text and one witnessed object,
 * so the composition is testable without a browser.
 */
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseFrontmatter } from '@vosjs/shared/frontmatter'
import { lookKindForGround } from '@vosjs/studio-core'
import { UsageError, parseArgs, strFlag } from './args'
import { createReporter } from './output'
import { launchBrowser } from '../browser'
import type { Browser } from 'playwright'

export interface BrandKit {
  name: string
  site: string
  witnessed: string
  bgA: string
  bgB: string
  bgC: string
  ink: string
  accent: string
  fontDisplay: string
  fontBody: string
  logoUrl: string | null
  /** The mark for dark grounds (a design.md asset named on-dark or white), when the site publishes one. */
  logoOnDarkUrl: string | null
  iconUrl: string | null
  ogImage: string | null
  wordmark: string
  designMd: string | null
  llmsTxt: string | null
  /**
   * The look the kit's cards and cuts are presented in, decided from the
   * site's own ground: a paper site is a plate, a dark site is dark,
   * anything else takes the gradient (accent → bgC). The maker overrides
   * it by editing the role; `ground` (absent here) overrides the ground.
   */
  look: 'plate' | 'gradient' | 'dark'
}

export interface DesignMdFacts {
  name: string | null
  description: string | null
  fonts: string[]
  logos: string[]
  hexes: string[]
  avoid: string[]
}

export interface Witness {
  title: string
  siteName: string | null
  themeColor: string | null
  icons: string[]
  ogImage: string | null
  h1: { fontFamily: string; color: string } | null
  body: { fontFamily: string; color: string; backgroundColor: string }
  /** Background colours of sections, headers, cards, in document order. */
  surfaces: string[]
  /** Background colours of buttons and the colours of links. */
  accents: string[]
}

const HEX_RE = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi

/** Every hex colour in a text, in order, deduped, lowercased. */
export function extractHexes(text: string): string[] {
  const out: string[] = []
  for (const m of text.match(HEX_RE) ?? []) {
    const h = normalizeHex(m)
    if (h && !out.includes(h)) out.push(h)
  }
  return out
}

/** `#abc` → `#aabbcc`; anything else lowercased; null when not a hex. */
export function normalizeHex(raw: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return (
    '#' +
    (h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h)
  )
}

/** `rgb(1, 2, 3)` / `rgba(1,2,3,.5)` → `#010203`, or null (transparent, none). */
export function rgbToHex(raw: string): string | null {
  const m =
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(raw)
  if (!m) return normalizeHex(raw)
  const alpha = m[4] as string | undefined
  if (alpha !== undefined && Number(alpha) === 0) return null
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return { h, s, l }
}

/** A colour with real chroma: neither a neutral nor near-white/black. */
export function isSaturated(hex: string): boolean {
  const { s, l } = hsl(hex)
  return s >= 0.25 && l > 0.12 && l < 0.88
}

const isLight = (hex: string) => hsl(hex).l >= 0.5

/** Mix `b` into `a` by `t` (0..1), in sRGB, as hex. */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (i: number) =>
    Math.round(
      parseInt(a.slice(i, i + 2), 16) * (1 - t) +
        parseInt(b.slice(i, i + 2), 16) * t,
    )
      .toString(16)
      .padStart(2, '0')
  return `#${ch(1)}${ch(3)}${ch(5)}`
}

/** The most frequent entry, ties by first appearance. */
function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let n = 0
  for (const [v, c] of counts)
    if (c > n) {
      best = v
      n = c
    }
  return best
}

/** The first family of a CSS `font-family` list, unquoted. */
export function firstFamily(fontFamily: string): string {
  const first = fontFamily.split(',')[0]?.trim() ?? ''
  return first.replace(/^["']|["']$/g, '')
}

const FONT_HINT_RE =
  /\b(?:[Uu]se|[Uu]ses|[Ss]et in)\s+([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3}(?:\s+(?:Sans|Serif|Mono|Display|Text))?)\s+(?:for|as|on|everywhere|only)\b/g
const FONT_FAMILY_RE = /font-family\s*:\s*["']?([^;"',\n]+)/gi
const LOGO_URL_RE =
  /https?:\/\/[^\s)"'<>]+?(?:logo|wordmark|mark|brand|icon)[^\s)"'<>]*?\.(?:svg|png|webp)/gi

/**
 * What a `/design.md` says, without pretending it is structured: the
 * frontmatter's name and description, the font families it names ("Use
 * Geist Sans for prose"), the logo assets it links, any hex colours it
 * quotes, and the bullets of its reject / avoid / never section verbatim.
 */
export function parseDesignMd(text: string): DesignMdFacts {
  const fm = parseFrontmatter(text)
  const fonts: string[] = []
  for (const m of text.matchAll(FONT_HINT_RE)) {
    const f = m[1].trim()
    if (!fonts.includes(f) && !/^(The|This|That|Use|It|A|An)$/.test(f))
      fonts.push(f)
  }
  for (const m of text.matchAll(FONT_FAMILY_RE)) {
    const f = m[1].trim().replace(/^["']|["']$/g, '')
    if (f && !fonts.includes(f)) fonts.push(f)
  }
  const logos: string[] = []
  for (const m of text.matchAll(LOGO_URL_RE))
    if (!logos.includes(m[0])) logos.push(m[0])
  const avoid: string[] = []
  const lines = text.split('\n')
  let inAvoid = false
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      inAvoid = /\b(reject|avoid|never|don'?t|do not|anti-?patterns?)\b/i.test(
        heading[1],
      )
      continue
    }
    if (!inAvoid) continue
    const bullet = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line)
    if (bullet) avoid.push(bullet[1].trim())
  }
  return {
    name: (fm as Record<string, string | undefined>).name ?? null,
    description: (fm as Record<string, string | undefined>).description ?? null,
    fonts,
    logos,
    hexes: extractHexes(text),
    avoid,
  }
}

/** The product's name and claim from `/llms.txt`: `# name — claim` + `> claim`. */
export function parseLlmsTxt(text: string): {
  name: string | null
  claim: string | null
} {
  const h1 = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? null
  // The blockquote WRAPS (llms.txt files are written at 80 columns), so
  // join its consecutive `> ` lines and keep the first sentence: the claim
  // is one line by contract, and a recipe heading that stops mid-sentence
  // reads as broken (vos.so's own claim did, on the verb's first run).
  const block = /^>\s*.+(?:\n>\s*.*)*/m.exec(text)?.[0]
  const joined = block
    ? block
        .split('\n')
        .map((line) => line.replace(/^>\s*/, '').trim())
        .filter(Boolean)
        .join(' ')
    : ''
  const quote = joined
    ? (/^(.*?[.!?])(?:\s|$)/.exec(joined)?.[1] ?? joined)
    : null
  let name = h1
  if (h1) {
    const split = /^(.+?)\s+[—–-]\s+(.+)$/.exec(h1)
    if (split) name = split[1].trim()
  }
  return { name, claim: quote ?? (h1 && h1 !== name ? h1 : null) }
}

const WITNESS_IN_PAGE = `(() => {
  const cs = (el) => el ? getComputedStyle(el) : null
  const meta = (sel) => { const m = document.querySelector(sel); return m ? m.getAttribute('content') : null }
  const abs = (href) => { try { return new URL(href, location.href).toString() } catch { return null } }
  const icons = []
  for (const l of document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')) {
    const u = abs(l.getAttribute('href') || ''); if (u && !icons.includes(u)) icons.push(u)
  }
  const h1 = document.querySelector('h1')
  const h1s = cs(h1)
  const bodys = cs(document.body)
  const surfaces = []
  for (const el of document.querySelectorAll('header, nav, main > section, section, footer, article, aside, [class*="card"], [class*="Card"], [class*="surface"], [class*="panel"]')) {
    const bg = cs(el).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') surfaces.push(bg)
    if (surfaces.length > 60) break
  }
  const accents = []
  for (const el of document.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="button"], a[class*="Button"], input[type="submit"]')) {
    const bg = cs(el).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') accents.push(bg)
    if (accents.length > 80) break
  }
  let links = 0
  for (const el of document.querySelectorAll('a[href]')) {
    if (links++ > 80) break
    const c = cs(el).color; if (c) accents.push(c)
  }
  return {
    title: document.title,
    siteName: meta('meta[property="og:site_name"]'),
    themeColor: meta('meta[name="theme-color"]'),
    icons,
    ogImage: abs(meta('meta[property="og:image"]') || '') || null,
    h1: h1s ? { fontFamily: h1s.fontFamily, color: h1s.color } : null,
    body: { fontFamily: bodys.fontFamily, color: bodys.color, backgroundColor: bodys.backgroundColor },
    surfaces,
    accents,
  }
})()`

/** Read the page's own facts in a browser; the one impure step. */
export async function witnessSite(
  browser: Browser,
  url: string,
): Promise<Witness> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  try {
    const page = await ctx.newPage()
    await page
      .goto(url, { waitUntil: 'networkidle', timeout: 45_000 })
      .catch(async () => {
        await page.goto(url, { waitUntil: 'load', timeout: 45_000 })
      })
    await page.waitForTimeout(800)
    return await page.evaluate(WITNESS_IN_PAGE)
  } finally {
    await ctx.close()
  }
}

export interface BrandComposition {
  kit: BrandKit
  /** One line per role: where its value came from. */
  provenance: Record<string, string>
  avoid: string[]
}

/**
 * Compose the kit from what was read, in priority order: the design.md
 * wins on fonts, logos and the avoid list; llms.txt on the name and the
 * claim; the witness on every colour and on whatever the others left out.
 */
export function composeBrand(input: {
  url: string
  witness: Witness
  design: DesignMdFacts | null
  designUrl: string | null
  llms: { name: string | null; claim: string | null } | null
  llmsUrl: string | null
  today: string
}): BrandComposition {
  const { witness: w, design, llms } = input
  const p: Record<string, string> = {}

  const bgA = rgbToHex(w.body.backgroundColor) ?? '#ffffff'
  p.bgA = `the body's background`
  const surfaceHexes = w.surfaces
    .map(rgbToHex)
    .filter((h): h is string => h !== null && h !== bgA)
  const neutralSurface = mostCommon(surfaceHexes.filter((h) => !isSaturated(h)))
  const bgB =
    neutralSurface ?? mixHex(bgA, isLight(bgA) ? '#000000' : '#ffffff', 0.04)
  p.bgB = neutralSurface
    ? `the most common section / card ground`
    : `no distinct surface found; bgA stepped 4% toward ${isLight(bgA) ? 'black' : 'white'}`

  const accentHexes = w.accents
    .map(rgbToHex)
    .filter((h): h is string => h !== null && isSaturated(h))
  const themeHex = w.themeColor ? rgbToHex(w.themeColor) : null
  let accent = mostCommon(accentHexes)
  if (!accent && themeHex && isSaturated(themeHex)) accent = themeHex
  if (!accent) accent = design?.hexes.find(isSaturated) ?? null
  const inkHex =
    rgbToHex(w.h1?.color ?? w.body.color) ??
    (isLight(bgA) ? '#111111' : '#f5f5f5')
  if (!accent) accent = inkHex
  p.accent = accentHexes.length
    ? `the saturated colour buttons and links agree on`
    : themeHex && isSaturated(themeHex)
      ? `the theme-color meta`
      : design?.hexes.find(isSaturated)
        ? `a hex quoted in design.md`
        : `no saturated colour on the page; the ink stands in`

  const bgC = mixHex(bgA, accent, 0.14)
  p.bgC = `bgA tinted 14% toward the accent (a highlight ground)`
  p.ink = w.h1 ? `the h1's colour` : `the body's colour`

  const fontDisplay =
    design?.fonts[0] ??
    (w.h1 ? firstFamily(w.h1.fontFamily) : firstFamily(w.body.fontFamily))
  p.fontDisplay = design?.fonts[0]
    ? `named in design.md`
    : w.h1
      ? `the h1's computed face`
      : `the body's computed face (no h1)`
  // design.md's second face is usually the code face ("Geist Mono only for
  // code"); a mono family is never the body, so the page's own wins then.
  const designBody = design?.fonts.slice(1).find((f) => !/\bmono\b/i.test(f))
  const fontBody = designBody ?? firstFamily(w.body.fontFamily)
  p.fontBody = designBody ? `named in design.md` : `the body's computed face`

  // The mark to PLACE: a design.md asset named mark, logo or wordmark that
  // is not an icon (a favicon or app icon carries a tile) and not the
  // on-dark twin, which is recorded beside it.
  const isIcon = (u: string) => /favicon|apple-touch|icon/i.test(u)
  const onDark = (u: string) => /on-dark|white/i.test(u)
  const logoUrl =
    design?.logos.find(
      (u) => /wordmark|logo|mark/i.test(u) && !isIcon(u) && !onDark(u),
    ) ?? null
  const logoOnDarkUrl =
    design?.logos.find(
      (u) => /wordmark|logo|mark/i.test(u) && !isIcon(u) && onDark(u),
    ) ?? null
  const iconUrl =
    w.icons.find((u) => /apple-touch/i.test(u)) ??
    (w.icons.length ? w.icons[0] : null)
  p.logoUrl = logoUrl
    ? `linked from design.md`
    : `none linked; the icon stands in`
  p.iconUrl = iconUrl ? `the page's icon link` : `no icon link`

  const host = new URL(input.url).hostname.replace(/^www\./, '')
  const wordmark =
    llms?.name ??
    design?.name ??
    w.siteName ??
    (w.title.split(/[|—–-]/)[0].trim() || host)
  p.wordmark = llms?.name
    ? `llms.txt's title`
    : design?.name
      ? `design.md's name`
      : w.siteName
        ? `og:site_name`
        : `the page title`

  const kit: BrandKit = {
    name: wordmark,
    site: input.url,
    witnessed: input.today,
    bgA,
    bgB,
    bgC,
    ink: inkHex,
    accent,
    fontDisplay,
    fontBody,
    logoUrl: logoUrl ?? iconUrl,
    logoOnDarkUrl,
    iconUrl,
    ogImage: w.ogImage,
    wordmark,
    designMd: input.designUrl,
    llmsTxt: input.llmsUrl,
    look: lookKindForGround(bgA),
  }
  p.look = `from the body's ground (${bgA}): a paper site is a plate, a dark site is dark, else the gradient`
  return { kit, provenance: p, avoid: design?.avoid ?? [] }
}

/** The recipe file: frontmatter roles + provenance prose + the avoid list. */
export function renderBrandMd(
  c: BrandComposition,
  claim: string | null,
): string {
  const k = c.kit
  const q = (v: string | null) => (v === null ? 'null' : JSON.stringify(v))
  const fm = [
    '---',
    `name: ${JSON.stringify(k.name)}`,
    `description: ${JSON.stringify(`${k.name}'s brand kit, witnessed from ${new URL(k.site).hostname} on ${k.witnessed}`)}`,
    'applies: any',
    'seed: none',
    `site: ${q(k.site)}`,
    `witnessed: ${q(k.witnessed)}`,
    `bgA: ${q(k.bgA)}`,
    `bgB: ${q(k.bgB)}`,
    `bgC: ${q(k.bgC)}`,
    `ink: ${q(k.ink)}`,
    `accent: ${q(k.accent)}`,
    `fontDisplay: ${q(k.fontDisplay)}`,
    `fontBody: ${q(k.fontBody)}`,
    `logoUrl: ${q(k.logoUrl)}`,
    `logoOnDarkUrl: ${q(k.logoOnDarkUrl)}`,
    `iconUrl: ${q(k.iconUrl)}`,
    `ogImage: ${q(k.ogImage)}`,
    `wordmark: ${q(k.wordmark)}`,
    `designMd: ${q(k.designMd)}`,
    `llmsTxt: ${q(k.llmsTxt)}`,
    `look: ${q(k.look)}`,
    '---',
  ].join('\n')
  const lines = [
    fm,
    '',
    `# ${k.name}`,
    '',
    claim
      ? `${claim}`
      : `The brand of ${k.name}, as witnessed on ${new URL(k.site).hostname}.`,
    '',
    '## Where each value came from',
    '',
    ...Object.entries(c.provenance).map(
      ([role, why]) => `- \`${role}\`: ${why}`,
    ),
    '',
    k.designMd
      ? `The site publishes a design.md (${k.designMd}); it wins on fonts, logos and the avoid list below. Colours there are CSS variable names, so every colour above was witnessed on the page.`
      : `The site publishes no design.md; every value above was witnessed on the page, so re-run \`vos brand\` after a redesign.`,
    '',
    '## Use',
    '',
    `The poster family binds these roles: \`bgA/bgB/bgC\` for the ground, \`ink\` for type, \`fontDisplay\` for the headline (if it is not in the hosted catalog, \`vos check\` warns and the nearest hosted serif or sans stands in), \`logoUrl\` for the mark (placed beside the wordmark on the cards and the end card; \`logoOnDarkUrl\` stands in on a dark ground). A site that publishes only a favicon or an app icon gets the icon here, tile and all: publish a bare mark and name it in design.md. A take's frame ground is a gradient of \`accent\` toward \`bgC\` unless the brand is paper, in which case \`bgB\` toward \`bgC\`.`,
  ]
  if (c.avoid.length) {
    lines.push('', '## Avoid (the site says)', '')
    for (const a of c.avoid) lines.push(`- ${a}`)
  }
  return lines.join('\n') + '\n'
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (/text\/html/i.test(type)) return null // a soft 404 page is not a file
    return await res.text()
  } catch {
    return null
  }
}

export async function cmdBrand(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, new Set(['json']))
  const raw = positionals[0]
  if (!raw) throw new UsageError('vos brand <url> [--out BRAND.md] [--json]')
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    throw new UsageError(`not a URL: ${raw}`)
  }
  const r = createReporter(flags.json === true)
  const out = resolve(strFlag(flags, 'out') ?? 'BRAND.md')

  r.log(`reading ${origin}/design.md and /llms.txt…`)
  const [designText, llmsText] = await Promise.all([
    fetchText(`${origin}/design.md`),
    fetchText(`${origin}/llms.txt`),
  ])
  const design = designText ? parseDesignMd(designText) : null
  const llms = llmsText ? parseLlmsTxt(llmsText) : null
  r.event({
    event: 'sources',
    designMd: design !== null,
    llmsTxt: llms !== null,
  })

  r.log(`witnessing ${url}…`)
  const browser = await launchBrowser()
  let witness: Witness
  try {
    witness = await witnessSite(browser, url)
  } finally {
    await browser.close()
  }

  const composition = composeBrand({
    url,
    witness,
    design,
    designUrl: design ? `${origin}/design.md` : null,
    llms,
    llmsUrl: llms ? `${origin}/llms.txt` : null,
    today: new Date().toISOString().slice(0, 10),
  })
  const md = renderBrandMd(
    composition,
    llms?.claim ?? design?.description ?? null,
  )
  await writeFile(out, md)
  const k = composition.kit
  r.done(
    {
      out,
      kit: k,
      provenance: composition.provenance,
      avoid: composition.avoid,
    },
    `Wrote ${out}\n  ${k.name}: ground ${k.bgA} / ${k.bgB} / ${k.bgC}, ink ${k.ink}, accent ${k.accent}, ${k.fontDisplay} over ${k.fontBody}${k.designMd ? `\n  design.md read (${composition.avoid.length} avoid line(s))` : ''}\n  file it: vos recipe push ${out} --folder <slug>`,
  )
  return 0
}
