/**
 * Deliver — render one take to a release's video destinations and write the
 * kit manifest. Loops the DESTINATIONS table (studio-core, generated from
 * schema/channel-specs.json): each cut through renderTake at its spec's
 * exact pixels, then VERIFIES every artifact against its spec (px, bytes,
 * duration) and writes kit.json beside the assets.
 *
 * Verification reports, it never guesses: an asset that misses its spec
 * (or a spec floor the take cannot fill — a 60 s minimum against a 35 s
 * take) lands in `skipped` with the reason in words. Uploads stay
 * manual — the verb hands the human a kit directory, it never posts to a
 * channel.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { parseFrontmatter } from '@vosjs/shared/frontmatter'
import {
  CHANNEL_SPECS_VERIFIED,
  DESTINATIONS,
  cardInset,
  destinationsForChannel,
  houseLook,
  isLookKind,
  lookFromBrand,
  docOutputDuration,
} from '@vosjs/studio-core'
import { loadTake } from './take'
import { renderTake } from './renderTake'
import { LOOP_DESTINATIONS, destinationMechanics } from './motionPlan'
import type { Destination, Look, LookPlacement } from '@vosjs/studio-core'
import type { DocOverrides } from './docOverride'
import type { Browser } from 'playwright'

/** `--to` shorthand → channel ids (the spec's own channel slugs also work). */
export const CHANNEL_ALIASES: Record<string, string> = {
  yt: 'youtube',
  gh: 'github',
  shorts: 'shorts-linkedin',
}

export interface DeliverOptions {
  /** Resolved channel ids (aliases already applied). */
  channels: string[]
  /** Kit directory; default `<take>/kit`. */
  outDir?: string
  /** Stamped into kit.json (`--release v2.1`). */
  release?: string
  /** OUTPUT-time cut window applied to every video destination. */
  range?: [number, number]
  /** Concurrent chunk renders for video destinations. */
  parallel?: number
  /** In-memory doc overrides (--set / --background); lint-gated. */
  overrides?: DocOverrides
  /**
   * The card's presentation, resolved before the run (`resolveLook`): a
   * house look, the maker's BRAND.md, or null for the cut as the doc
   * frames it. Every destination rides it.
   */
  look?: Look | null
  onPhase?: (phase: string) => void
  onProgress?: (fraction: number) => void
}

/** One produced cut, the kit.json entry shape. */
export interface KitAsset {
  channel: string
  asset: string
  /** The destination id (`x-feed-cut`) the entry was rendered for. */
  destination: string
  path: string
  w: number
  h: number
  bytes: number
  seconds: number
}

export interface KitManifest {
  release: string | null
  /** The look the cuts were presented in (null = none). */
  look: string | null
  take: string
  produced: string
  /** channel-specs.json's own verified date — the spec sheet's freshness. */
  specsVerified: string
  skipped: string[]
  assets: KitAsset[]
}

export interface DeliverResult {
  kit: KitManifest
  kitFile: string
  outDir: string
}

/** Resolve `--to` entries to channel ids; UsageError-shaped message on junk. */
export function resolveChannels(raw: string): string[] {
  const known = [...new Set(DESTINATIONS.map((d) => d.channel))]
  const wanted = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (!wanted.length) throw new Error('--to expects a channel list')
  if (wanted.includes('all')) return known
  const out: string[] = []
  for (const w of wanted) {
    const id = CHANNEL_ALIASES[w] ?? w
    if (!known.includes(id))
      throw new Error(
        `unknown channel "${w}" — deliver renders video cuts for: ${known.join(', ')} (or all)`,
      )
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * Read the brand kit's frontmatter beside a take: `BRAND.md` in the take
 * directory, else in its parent (a release's `media/` folder holds the
 * takes under it), else an explicit path. Null when there is none.
 */
export async function readBrandBesideTake(
  dir: string,
  explicit?: string,
): Promise<{ file: string; roles: Record<string, string> } | null> {
  const candidates = explicit
    ? [explicit]
    : [join(dir, 'BRAND.md'), join(dir, '..', 'BRAND.md')]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const roles = parseFrontmatter(await readFile(file, 'utf8'))
    return { file, roles }
  }
  return null
}

/** LAUNCH.md beside a take (or its parent, or an explicit path): the release's roles. */
export async function readLaunchBesideTake(
  dir: string,
  explicit?: string,
): Promise<{ file: string; roles: Record<string, string> } | null> {
  const candidates = explicit
    ? [explicit]
    : [join(dir, 'LAUNCH.md'), join(dir, '..', 'LAUNCH.md')]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    return { file, roles: parseFrontmatter(await readFile(file, 'utf8')) }
  }
  return null
}

/**
 * The look a run presents its cuts in, in precedence: `--look none` (the
 * doc's own frame), `--look <kind>` (a house look), the
 * brand kit beside the take (its `look` role, else its own ground decides),
 * then the house gradient. Says where it came from, for the phase note.
 */
export async function resolveLook(
  dir: string,
  opts: { look?: string; brand?: string },
): Promise<{
  look: Look | null
  from: string
  roles: Record<string, string> | null
}> {
  const brand = await readBrandBesideTake(dir, opts.brand)
  const roles = brand?.roles ?? null
  if (opts.look === 'none') return { look: null, from: '--look none', roles }
  if (opts.look !== undefined) {
    if (!isLookKind(opts.look))
      throw new Error(
        `--look "${opts.look}" — one of plate | gradient | dark | none`,
      )
    return { look: houseLook(opts.look), from: `--look ${opts.look}`, roles }
  }
  if (brand) {
    const look = lookFromBrand(brand.roles)
    return { look, from: `${brand.file} (${look.kind})`, roles }
  }
  return {
    look: houseLook('gradient'),
    from: 'the house gradient (no BRAND.md beside the take)',
    roles,
  }
}

/**
 * The overrides that present the card in a look at one destination size:
 * the ground, the placement (inset from the footage's aspect), the radius,
 * both shadow layers and the hairline. The document's camera and bar kind
 * stay. Pure, so the policy is testable.
 */
export function lookOverrides(
  look: Look,
  placement: LookPlacement,
  size: { w: number; h: number },
  video: { w: number; h: number },
  opts: { keepMedia?: boolean } = {},
): string[] {
  const inset = cardInset(look, size, video, placement)
  const set = [
    'frame.fit=contain',
    `frame.background=${JSON.stringify(look.ground)}`,
    `frame.inset=${JSON.stringify(inset)}`,
    `frame.radius=${look.radius}`,
    `frame.shadow=${look.shadow}`,
    `frame.shadowContact=${look.shadowContact}`,
    `frame.border=${look.border}`,
  ]
  if (look.shadowColor) set.push(`frame.shadowColor=${look.shadowColor}`)
  if (look.border > 0) {
    set.push('frame.borderWidth=1')
    set.push(`frame.borderColor=${look.borderColor ?? '#000000'}`)
  }
  if (!opts.keepMedia) set.push('frame.backgroundMedia=null')
  return set
}

/**
 * A byte-ceiling miss in words that survive a 1% overshoot: ceil the size,
 * floor the ceiling, so the two figures can never round to the same number
 * (the dogfood printed "1.0MB exceeds the 1.0MB ceiling").
 */
const overCeiling = (bytes: number, maxBytes: number) =>
  `${Math.ceil(bytes / 1024)} KB exceeds the ${Math.floor(maxBytes / 1024)} KB ceiling`

const specWords = (d: Destination) => {
  const parts = [`${d.px.w}x${d.px.h}`]
  if (d.minSeconds !== undefined || d.maxSeconds !== undefined)
    parts.push(`${d.minSeconds ?? 0}-${d.maxSeconds ?? '∞'}s`)
  if (d.maxBytes !== undefined)
    parts.push(`≤${(d.maxBytes / 1024 / 1024).toFixed(0)}MB`)
  return parts.join(' ')
}

export async function deliverTake(
  browser: Browser,
  dir: string,
  opts: DeliverOptions,
): Promise<DeliverResult> {
  const take = await loadTake(dir)
  if (!take.doc) throw new Error(`${dir} has no doc.json — run plan first`)
  const doc = take.doc

  // The output's end: the clips after the footage count, so an end card
  // is inside every cut and the loop's cap reads the whole picture.
  const duration = docOutputDuration(doc)
  const videoSeconds = opts.range
    ? Math.min(opts.range[1], duration) - Math.min(opts.range[0], duration)
    : duration
  const outDir = resolve(opts.outDir ?? join(dir, 'kit'))
  await mkdir(outDir, { recursive: true })

  const destinations = opts.channels.flatMap((c) => destinationsForChannel(c))
  const assets: KitAsset[] = []
  const skipped: string[] = []

  const meta0 = doc.source.meta
  const video = {
    w: meta0.captureWidth ?? meta0.width,
    h: meta0.captureHeight ?? meta0.height,
  }
  /**
   * A video destination rides the look in the hero placement, camera kept,
   * then the destination's MECHANICS (a loop plays no entrance, end card
   * or sound; a silent channel mutes the bed; a 9:16 destination reframes
   * the card), then the user's own sets, which win. The cut's motion
   * (entrance, end card, captions, bed, clicks) is the DOCUMENT's, written
   * by `vos plan`; nothing is composed here.
   */
  const videoOverrides = (d: Destination): DocOverrides | undefined => {
    const set: string[] = []
    if (opts.look) {
      set.push(
        ...lookOverrides(opts.look, 'hero', d.px, video, {
          keepMedia: opts.overrides?.background !== undefined,
        }),
      )
    }
    const mech = destinationMechanics(d, doc)
    set.push(...mech.set)
    if (mech.notes.length) opts.onPhase?.(`${d.id}: ${mech.notes.join(', ')}`)
    set.push(...(opts.overrides?.set ?? []))
    if (!set.length && !mech.unset.length) return opts.overrides
    return { ...opts.overrides, set, unset: mech.unset }
  }

  for (const d of destinations) {
    const label = `${d.channel} ${d.asset}`
    // A spec floor the take cannot fill is a SKIP with the reason in
    // words, never padding — and never minutes of render first.
    if (d.minSeconds !== undefined && videoSeconds < d.minSeconds) {
      skipped.push(
        `${label}: spec wants ${d.minSeconds}-${d.maxSeconds ?? '∞'}s, the ${opts.range ? 'range' : 'take'} is ${videoSeconds.toFixed(0)}s`,
      )
      continue
    }
    // A LOOP destination the take outruns takes the take's FIRST seconds
    // up to its cap (a loop is a texture, not a story); a story
    // destination is skipped with the reason, never cut blind.
    let range = opts.range
    let seconds = videoSeconds
    if (d.maxSeconds !== undefined && videoSeconds > d.maxSeconds) {
      if (LOOP_DESTINATIONS.has(d.id) && !opts.range) {
        range = [0, d.maxSeconds]
        seconds = d.maxSeconds
        opts.onPhase?.(
          `note: ${label} takes the first ${d.maxSeconds}s of the ${videoSeconds.toFixed(0)}s take (a loop's cap)`,
        )
      } else {
        skipped.push(
          `${label}: spec caps at ${d.maxSeconds}s, the take is ${videoSeconds.toFixed(0)}s — cut it (--range, or trim segments in doc.json)`,
        )
        continue
      }
    }
    opts.onPhase?.(`${label} (${specWords(d)})`)
    const outFile = join(outDir, `${d.id}.${d.format}`)
    // A byte ceiling becomes a bitrate budget (leave 15% for container +
    // audio); never raise the default for ceilings that don't bind.
    const bitrate =
      d.maxBytes !== undefined
        ? Math.min(10_000_000, Math.floor(((d.maxBytes * 8) / seconds) * 0.85))
        : undefined
    const result = await renderTake(browser, dir, outFile, {
      width: d.px.w,
      height: d.px.h,
      format: 'mp4',
      parallel: opts.parallel,
      range,
      bitrate,
      overrides: videoOverrides(d),
      onProgress: opts.onProgress,
    })
    if (d.maxBytes !== undefined && result.bytes > d.maxBytes) {
      skipped.push(
        `${label}: ${overCeiling(result.bytes, d.maxBytes)} (kept at ${outFile})`,
      )
      continue
    }
    assets.push({
      channel: d.channel,
      asset: d.asset,
      destination: d.id,
      path: relative(outDir, outFile),
      w: result.width,
      h: result.height,
      bytes: result.bytes,
      seconds: result.duration,
    })
  }

  const kit: KitManifest = {
    release: opts.release ?? null,
    look: opts.look?.kind ?? null,
    take: dir,
    produced: new Date().toISOString(),
    specsVerified: CHANNEL_SPECS_VERIFIED,
    skipped,
    assets,
  }
  const kitFile = join(outDir, 'kit.json')
  await writeFile(kitFile, JSON.stringify(kit, null, 2))
  return { kit, kitFile, outDir }
}
