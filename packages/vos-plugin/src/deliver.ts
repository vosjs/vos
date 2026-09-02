/**
 * Deliver — render one take to a release's destinations and write the kit
 * manifest. Loops the DESTINATIONS table (studio-core, generated from
 * schema/channel-specs.json): stills through framesTake at each spec's exact
 * pixels, videos through renderTake, then VERIFIES every artifact against
 * its spec (px, bytes, duration) and writes kit.json beside the assets —
 * the manifest the launch-kit skill describes, made real as a verb.
 *
 * Verification reports, it never guesses: an asset that misses its spec
 * (or a spec floor the take cannot fill — a 60 s minimum against a 35 s
 * take) lands in `skipped` with the reason in words. Store uploads stay
 * manual by policy — the verb hands the human a kit directory, it never
 * pushes to a store.
 */
import {
  copyFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { totalDuration } from '@vosjs/timeline'
import {
  CHANNEL_SPECS_VERIFIED,
  DESTINATIONS,
  destinationsForChannel,
  ratedSegments,
  spanOutputExtent,
} from '@vosso/studio-core'
import { loadTake } from './take'
import { framesTake } from './framesTake'
import { renderTake } from './renderTake'
import { renderPosterStills } from './posterStill'
import type { Destination } from '@vosso/studio-core'
import type { DocOverrides } from './docOverride'
import type { Browser } from 'playwright'

/** `--to` shorthand → channel ids (the spec's own channel slugs also work). */
export const CHANNEL_ALIASES: Record<string, string> = {
  ph: 'producthunt',
  yt: 'youtube',
  gh: 'github',
  li: 'linkedin',
  shorts: 'shorts-linkedin',
}

/**
 * Destinations a take cannot honestly produce: brand art, not footage.
 * They are reported in `skipped`, never silently absent from the kit.
 */
const NOT_FROM_FOOTAGE: Record<string, string> = {
  'cws-icon': 'an icon is brand art, not footage — supply it from the kit',
}

export interface DeliverOptions {
  /** Resolved channel ids (aliases already applied). */
  channels: string[]
  /** Kit directory; default `<take>/kit`. */
  outDir?: string
  /** Stamped into kit.json (`--release v2.1`). */
  release?: string
  /** Still times override (OUTPUT seconds, already parsed). */
  times?: number[]
  /** OUTPUT-time cut window applied to every video destination. */
  range?: [number, number]
  /** Concurrent chunk renders for video destinations. */
  parallel?: number
  /** In-memory doc overrides (--set / --background); lint-gated. */
  overrides?: DocOverrides
  /**
   * The maker's poster program (the split-cover family). With one in hand,
   * CARD-genre destinations (OG, LinkedIn, X, YouTube thumbnail, the CWS
   * tile + marquee, GitHub social preview) render from the POSTER — the
   * verdict: the cover is a composition, never a raw frame — with this
   * release's full-bleed shot baked in as the poster's image element.
   * Screenshot-genre destinations always stay real take frames (store
   * policy demands real UX).
   */
  poster?: { config: Record<string, unknown>; from: string }
  /**
   * Capture instant INSIDE the poster program's own timeline (its text
   * enters over the first seconds); default 90% through it. Not the take
   * moment — that is `shotTime`.
   */
  posterTime?: number
  /**
   * The take moment (OUTPUT seconds) baked into the poster as its shot;
   * default the first still time. A zoom apex is the natural pick: the
   * cut's camera composes the frame, so the shot is the feature, not the
   * whole page.
   */
  shotTime?: number
  /**
   * Keep the cut's camera and the frame chrome on SCREENSHOT-genre stills.
   * By default a store screenshot is the real page at that moment, full
   * bleed: no zoom, no tilt, no browser bar, no padding (store policy says
   * real UX, full bleed, square corners; a zoomed crop under a mac bar on a
   * gradient reads as a marketing frame, and a text-heavy page zoomed to a
   * corner reads as an empty page).
   */
  composed?: boolean
  onPhase?: (phase: string) => void
  onProgress?: (fraction: number) => void
}

/** One produced asset, the launch-kit skill's kit.json entry shape. */
export interface KitAsset {
  channel: string
  asset: string
  /** The destination id (`cws-screenshot`) the entry was rendered for. */
  destination: string
  path: string
  w: number
  h: number
  bytes: number
  seconds: number | null
  frameTime: number | null
  /** Where the pixels came from: the take (absent = take) or the poster. */
  source?: 'poster'
}

export interface KitManifest {
  release: string | null
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
        `unknown channel "${w}" — channels: ${known.join(', ')} (or all)`,
      )
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/**
 * Default still times: every zoom span's output-time apex (where quality
 * lives), else an even spread — the frames verb's own conventions. A span
 * trimmed out of the cut drops silently from the apex list, so the count
 * of dropped spans rides back for the phase note (the dogfood's "2 spans,
 * 1 still" surprise said nothing).
 */
function defaultStillTimes(
  doc: NonNullable<Awaited<ReturnType<typeof loadTake>>['doc']>,
  duration: number,
): { times: number[]; dropped: number } {
  const rated = ratedSegments(doc)
  const apexes: number[] = []
  for (const z of doc.zoom) {
    const ext = spanOutputExtent(rated, z.in, z.out)
    if (ext) apexes.push((ext.start + ext.end) / 2)
  }
  const dropped = doc.zoom.length - apexes.length
  if (apexes.length) return { times: apexes.sort((a, b) => a - b), dropped }
  return {
    times: [0.1, 0.3, 0.5, 0.7, 0.9].map((p) => p * duration),
    dropped,
  }
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

/**
 * The in-memory overrides a still destination rides, in apply order (the
 * user's own --set entries come LAST, so they win): the channel's fit, then
 * the screenshot genre's full-bleed defaults unless `composed` keeps the
 * cut's camera and chrome. Pure, so the policy is testable without a
 * browser.
 */
/** The real page, edge to edge: no chrome, no cursor dot, no click ring. */
export const FULL_BLEED = [
  'frame.padding=0',
  'frame.radius=0',
  'frame.shadow=0',
  'frame.border=0',
  'frame.browserBar.kind=none',
  'cursor.visible=false',
  'cursor.clickFx.style=none',
]
/** A store screenshot: the real page at that moment, the camera released. */
export const SCREENSHOT_DEFAULTS = [...FULL_BLEED, 'zoom=[]', 'tilt=[]']

export function stillOverridesFor(
  d: Pick<Destination, 'fit' | 'genre'>,
  opts: Pick<DeliverOptions, 'overrides' | 'composed'>,
): DocOverrides | undefined {
  const set: string[] = []
  if (d.fit === 'cover') set.push('frame.fit=cover')
  if (d.genre === 'screenshot' && !opts.composed)
    set.push(...SCREENSHOT_DEFAULTS)
  // A card with no poster program to render from is a cover crop of the
  // real page (the cut's camera kept): never the card chrome and the padding
  // band, which a 2.5:1 marquee turns into a browser bar over a gradient.
  else if (d.genre === 'card' && !opts.composed) set.push(...FULL_BLEED)
  set.push(...(opts.overrides?.set ?? []))
  if (!set.length) return opts.overrides
  return { ...opts.overrides, set }
}

export async function deliverTake(
  browser: Browser,
  dir: string,
  opts: DeliverOptions,
): Promise<DeliverResult> {
  const take = await loadTake(dir)
  if (!take.doc) throw new Error(`${dir} has no doc.json — run plan first`)
  const doc = take.doc

  const duration = totalDuration(ratedSegments(doc))
  const videoSeconds = opts.range
    ? Math.min(opts.range[1], duration) - Math.min(opts.range[0], duration)
    : duration
  let stillTimes: number[]
  if (opts.times?.length) {
    stillTimes = opts.times
  } else {
    const derived = defaultStillTimes(doc, duration)
    stillTimes = derived.times
    if (derived.dropped > 0) {
      opts.onPhase?.(
        `note: ${derived.dropped} of ${doc.zoom.length} zoom apex(es) fall outside the cut — pass --times for more moments`,
      )
    }
  }

  const outDir = resolve(opts.outDir ?? join(dir, 'kit'))
  await mkdir(outDir, { recursive: true })

  const destinations = opts.channels.flatMap((c) => destinationsForChannel(c))
  const assets: KitAsset[] = []
  const skipped: string[] = []

  // The poster leg: with a poster program in hand, card-genre stills render
  // from IT (collected here, rendered after the take loop). Without one,
  // cards fall through to the take path like before.
  const posterCards =
    opts.poster !== undefined
      ? destinations.filter(
          (d) =>
            d.kind !== 'video' && d.genre === 'card' && !NOT_FROM_FOOTAGE[d.id],
        )
      : []
  const posterCardIds = new Set(posterCards.map((d) => d.id))

  // The poster pass (the verdict made mechanical): one full-bleed shot of
  // the release at the hero moment, baked into the poster program's image
  // element, rendered per card destination at its exact pixels — PNG from
  // our own page, so the webp-only thumbnail template never enters it.
  if (opts.poster && posterCards.length) {
    const meta = doc.source.meta
    const heroTime =
      opts.shotTime ?? (stillTimes.length ? stillTimes[0] : duration / 2)
    opts.onPhase?.(
      `poster shot (full bleed at ${heroTime.toFixed(2)}s) from ${opts.poster.from}`,
    )
    const serveDir = await mkdtemp(join(tmpdir(), 'vos-poster-'))
    try {
      const shot = await framesTake(browser, dir, {
        times: [heroTime],
        width: meta.captureWidth ?? meta.width,
        height: meta.captureHeight ?? meta.height,
        outDir: serveDir,
        overrides: {
          ...opts.overrides,
          set: [
            'frame.fit=contain',
            'frame.padding=0',
            'frame.radius=0',
            'frame.shadow=0',
            'frame.border=0',
            'frame.browserBar.kind=none',
            ...(opts.overrides?.set ?? []),
          ],
        },
      })
      await copyFile(shot.frames[0].file, join(serveDir, 'shot.png'))

      // Bake the release's shot in: the reserved image element id is
      // `shot` (the family convention); data.shotUrl rides along for
      // programs that wire it themselves. No image element = no poster —
      // the cards fall back to take frames, said in words.
      const config = structuredClone(opts.poster.config)
      const elements = Array.isArray(config.elements) ? config.elements : []
      const shotEl =
        (elements as { id?: string; type?: string; src?: unknown }[]).find(
          (e) => e.id === 'shot',
        ) ??
        (elements as { id?: string; type?: string; src?: unknown }[]).find(
          (e) => e.type === 'image',
        )
      if (!shotEl) {
        skipped.push(
          `poster ${opts.poster.from}: no image element (id "shot") to carry the release's screenshot — card destinations kept from the take`,
        )
        for (const d of posterCards) posterCardIds.delete(d.id)
      } else {
        shotEl.src = '/shot.png'
        const data =
          config.data && typeof config.data === 'object'
            ? (config.data as Record<string, unknown>)
            : {}
        data.shotUrl = '/shot.png'
        config.data = data
        const posterDuration =
          typeof config.duration === 'number' ? config.duration : 6
        const time = Math.min(
          opts.posterTime ?? posterDuration * 0.9,
          Math.max(0, posterDuration - 0.05),
        )
        opts.onPhase?.(
          `poster cards (${posterCards.map((d) => d.id).join(', ')}) at ${time.toFixed(2)}s`,
        )
        await renderPosterStills(
          browser,
          config,
          serveDir,
          posterCards.map((d) => ({
            name: `${d.id}.png`,
            width: d.px.w,
            height: d.px.h,
          })),
          time,
        )
        for (const d of posterCards) {
          const from = join(serveDir, `${d.id}.png`)
          const to = join(outDir, `${d.id}.png`)
          await rename(from, to)
          const bytes = (await stat(to)).size
          if (d.maxBytes !== undefined && bytes > d.maxBytes) {
            skipped.push(
              `${d.channel} ${d.asset}: ${overCeiling(bytes, d.maxBytes)} (kept at ${to})`,
            )
            continue
          }
          assets.push({
            channel: d.channel,
            asset: d.asset,
            destination: d.id,
            path: relative(outDir, to),
            w: d.px.w,
            h: d.px.h,
            bytes,
            seconds: null,
            frameTime: null,
            source: 'poster',
          })
        }
      }
    } finally {
      await rm(serveDir, { recursive: true, force: true })
    }
  }

  for (const d of destinations) {
    const label = `${d.channel} ${d.asset}`
    const excuse = NOT_FROM_FOOTAGE[d.id]
    if (excuse) {
      skipped.push(`${label}: ${excuse}`)
      continue
    }
    if (posterCardIds.has(d.id)) continue // rendered from the poster above

    if (d.kind === 'video') {
      // A spec floor the take cannot fill is a SKIP with the reason in
      // words, never padding — and never minutes of render first.
      if (d.minSeconds !== undefined && videoSeconds < d.minSeconds) {
        skipped.push(
          `${label}: spec wants ${d.minSeconds}-${d.maxSeconds ?? '∞'}s, the ${opts.range ? 'range' : 'take'} is ${videoSeconds.toFixed(0)}s`,
        )
        continue
      }
      if (d.maxSeconds !== undefined && videoSeconds > d.maxSeconds) {
        skipped.push(
          `${label}: spec caps at ${d.maxSeconds}s, the take is ${videoSeconds.toFixed(0)}s — cut it (--range, or trim segments in doc.json)`,
        )
        continue
      }
      opts.onPhase?.(`${label} (${specWords(d)})`)
      const outFile = join(outDir, `${d.id}.${d.format}`)
      // A byte ceiling becomes a bitrate budget (leave 15% for container +
      // audio); never raise the default for ceilings that don't bind.
      const bitrate =
        d.maxBytes !== undefined
          ? Math.min(
              10_000_000,
              Math.floor(((d.maxBytes * 8) / videoSeconds) * 0.85),
            )
          : undefined
      const result = await renderTake(browser, dir, outFile, {
        width: d.px.w,
        height: d.px.h,
        format: 'mp4',
        parallel: opts.parallel,
        range: opts.range,
        bitrate,
        overrides: opts.overrides,
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
        frameTime: null,
      })
      continue
    }

    // Stills: capture at the spec's exact pixels; a set takes up to its
    // count ceiling of the hero times, a single still takes the first.
    const wanted =
      d.kind === 'still-set'
        ? stillTimes.slice(0, d.count?.max ?? stillTimes.length)
        : stillTimes.slice(0, 1)
    opts.onPhase?.(`${label} (${specWords(d)}, ${wanted.length} still(s))`)
    // The destination's fit is the channel's demand ("fill the region"): a
    // cover still rides an in-memory frame.fit override (cover fit), so
    // a 16:9 take fills a 440x280 tile instead of striping the background.
    // The doc on disk is untouched; an explicit --set frame.fit wins (later
    // entries apply last in docOverride).
    const overrides = stillOverridesFor(d, opts)
    const captured = await framesTake(browser, dir, {
      times: wanted,
      width: d.px.w,
      height: d.px.h,
      outDir,
      overrides,
    })
    for (let i = 0; i < captured.frames.length; i++) {
      const frame = captured.frames[i]
      const name =
        captured.frames.length > 1 ? `${d.id}-${i + 1}.png` : `${d.id}.png`
      const to = join(outDir, name)
      await rename(frame.file, to)
      const bytes = (await stat(to)).size
      if (d.maxBytes !== undefined && bytes > d.maxBytes) {
        skipped.push(
          `${label}: ${overCeiling(bytes, d.maxBytes)} (kept at ${to})`,
        )
        continue
      }
      assets.push({
        channel: d.channel,
        asset: d.asset,
        destination: d.id,
        path: relative(outDir, to),
        w: captured.width,
        h: captured.height,
        bytes,
        seconds: null,
        frameTime: frame.time,
      })
    }
    if (d.count && captured.frames.length < d.count.min) {
      skipped.push(
        `${label}: spec wants ${d.count.min}-${d.count.max}, only ${captured.frames.length} still time(s) available — pass --times`,
      )
    }
  }

  const kit: KitManifest = {
    release: opts.release ?? null,
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
