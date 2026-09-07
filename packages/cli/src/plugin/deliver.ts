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
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { totalDuration } from '@vosjs/timeline'
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
  ratedSegments,
} from '@vosjs/studio-core'
import { loadTake } from './take'
import { framesTake } from './framesTake'
import { renderTake } from './renderTake'
import { momentCandidates, pickMoments } from './moments'
import { decodePng, differenceHash, inkCoverage } from './picture'
import { LOOP_DESTINATIONS, destinationMechanics } from './motionPlan'
import {
  findPosterDocs,
  posterClassFor,
  posterShotRect,
  posterStillTime,
  posterTextBoxes,
} from './posterDoc'
import type { PosterClass } from './posterDoc'
import type { MomentCandidate } from './moments'
import type { TextBox } from './kitPicture'
import type { Destination, Look, LookPlacement } from '@vosjs/studio-core'
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
   * LAUNCH.md's roles beside the take. The POSTER roles name the document a
   * card destination renders from (`poster: <path>`, `poster-landscape`,
   * `poster-square`, `poster-portrait`, `poster-tile`); the folder
   * convention `poster/<class>/doc.json` needs no role.
   */
  launchRoles?: Record<string, string> | null
  /**
   * Keep the cut's camera and the frame chrome on SCREENSHOT-genre stills.
   * By default a store screenshot is the real page at that moment, full
   * bleed: no zoom, no tilt, no browser bar, no padding (store policy says
   * real UX, full bleed, square corners; a zoomed crop under a mac bar on a
   * gradient reads as a marketing frame, and a text-heavy page zoomed to a
   * corner reads as an empty page).
   */
  composed?: boolean
  /**
   * The card's presentation, resolved before the run (`resolveLook`): a
   * house look, the maker's BRAND.md, or null for the pre-look behaviour
   * (cards as cover crops, videos as the doc frames them). Card-genre
   * stills without a poster and every video destination ride it; the
   * screenshot genre never does (store policy: the real page, full bleed).
   */
  look?: Look | null
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
  /** Where the pixels came from: the take (absent = take), or a poster DOCUMENT beside it. */
  source?: 'poster'
  /** The poster document a card rendered from: its class, its file (relative to the take), the vos it tracks. */
  poster?: { class: PosterClass; file: string; vosId?: string }
  /** Where the words landed, as fractions of the asset (the picture checks read them). */
  text?: TextBox[]
  /** Where the card sits on a poster, fractions of the asset (a bleed runs past the edge). */
  shot?: { x: number; y: number; w: number; h: number }
  /** The card runs past both edges: a close crop of the subject (a tile), so the picture checks skip the card band. */
  crop?: boolean
  /**
   * A screenshot-genre still rendered with the cut's camera and chrome
   * (`--composed`), which store policy refuses; the picture checks read it.
   */
  composed?: boolean
}

export interface KitManifest {
  release: string | null
  /** The look the cards and cuts were presented in (null = none). */
  look: string | null
  take: string
  produced: string
  /** channel-specs.json's own verified date — the spec sheet's freshness. */
  specsVerified: string
  /** The still moments, in order, and where each came from. */
  moments: MomentCandidate[]
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
 * The look a run presents its cards and cuts in, in precedence: `--look
 * none` (the pre-look behaviour), `--look <kind>` (a house look), the
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
 * both shadow layers and the hairline; a still also releases the camera
 * and hides the cursor (a card shows the whole window at rest, and a
 * zoomed crop inside a small card reads as a broken screenshot). The
 * document's bar kind stays. Pure, so the policy is testable.
 */
export function lookOverrides(
  look: Look,
  placement: LookPlacement,
  size: { w: number; h: number },
  video: { w: number; h: number },
  opts: { still: boolean; keepMedia?: boolean },
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
  if (opts.still) {
    set.push(
      'zoom=[]',
      'tilt=[]',
      'cursor.visible=false',
      'cursor.clickFx.style=none',
    )
  }
  return set
}

/** The probe's width: enough to read ink and a hash, cheap to capture. */
const PROBE_WIDTH = 640

/**
 * The still moments of a take: candidates from the step timeline, the
 * zoom apexes and the spread (moments.ts), captured ONCE at probe size as
 * the real page (camera released, no chrome), then kept only when
 * populated and distinct. What is dropped is said in `skipped`.
 */
async function pickStillTimes(
  browser: Browser,
  dir: string,
  doc: NonNullable<Awaited<ReturnType<typeof loadTake>>['doc']>,
  duration: number,
  opts: DeliverOptions,
): Promise<{ times: number[]; moments: MomentCandidate[]; notes: string[] }> {
  const { candidates, dropped } = momentCandidates(doc, duration)
  const notes: string[] = []
  if (dropped > 0)
    notes.push(
      `${dropped} of ${doc.zoom.length} zoom apex(es) fall outside the cut`,
    )
  if (!candidates.length) return { times: [], moments: [], notes }
  const meta = doc.source.meta
  const vw = meta.captureWidth ?? meta.width
  const vh = meta.captureHeight ?? meta.height
  const probeDir = await mkdtemp(join(tmpdir(), 'vos-moments-'))
  try {
    const probe = await framesTake(browser, dir, {
      times: candidates.map((c) => c.time),
      width: PROBE_WIDTH,
      height: Math.max(2, Math.round((PROBE_WIDTH * vh) / vw / 2) * 2),
      outDir: probeDir,
      overrides: {
        ...opts.overrides,
        set: [...SCREENSHOT_DEFAULTS, ...(opts.overrides?.set ?? [])],
      },
    })
    // The probe writes its frames in time order; the candidates are in
    // rung order (steps first), which is the order the pick must keep, so
    // measures are joined by TIME, never by index.
    const byTime = new Map<number, { ink: number; hash: string }>()
    for (const frame of probe.frames) {
      const img = decodePng(new Uint8Array(await readFile(frame.file)))
      if (!img) continue
      const whole = { x: 0, y: 0, w: img.w, h: img.h }
      byTime.set(+frame.time.toFixed(3), {
        ink: inkCoverage(img, whole),
        hash: differenceHash(img, whole),
      })
    }
    const measured = []
    for (const c of candidates) {
      const m = byTime.get(+c.time.toFixed(3))
      if (m) measured.push({ time: c.time, ...m })
    }
    const pick = pickMoments(measured)
    const kept = candidates.filter((c) => pick.times.includes(c.time))
    const bySource = (s: MomentCandidate['source']) =>
      candidates.filter((c) => c.source === s).length
    notes.push(
      `${candidates.length} candidate(s): ${bySource('step')} from steps, ${bySource('zoom')} from zoom apexes, ${bySource('spread')} from the spread; ${kept.length} kept`,
    )
    return {
      times: pick.times,
      moments: kept,
      notes: [...notes, ...pick.dropped.map((d) => `moment: ${d}`)],
    }
  } finally {
    await rm(probeDir, { recursive: true, force: true })
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
  d: Pick<Destination, 'fit' | 'genre'> & { px?: Destination['px'] },
  opts: Pick<DeliverOptions, 'overrides' | 'composed' | 'look'>,
  video?: { w: number; h: number },
): DocOverrides | undefined {
  const set: string[] = []
  if (d.genre === 'screenshot' && !opts.composed) {
    if (d.fit === 'cover') set.push('frame.fit=cover')
    set.push(...SCREENSHOT_DEFAULTS)
  } else if (
    d.genre === 'card' &&
    !opts.composed &&
    opts.look &&
    video &&
    d.px
  ) {
    // A card with no poster program is the whole window on the look's
    // ground: centred with room around it, or, on a frame too wide to hold
    // it, given headroom and run off the bottom (the feature-clip grammar).
    set.push(
      ...lookOverrides(opts.look, 'card', d.px, video, {
        still: true,
        keepMedia: opts.overrides?.background !== undefined,
      }),
    )
  } else {
    if (d.fit === 'cover') set.push('frame.fit=cover')
    // No look: a card with no poster program is a cover crop of the real
    // page (the cut's camera kept): never the card chrome and the padding
    // band, which a 2.5:1 marquee turns into a browser bar over a gradient.
    if (d.genre === 'card' && !opts.composed) set.push(...FULL_BLEED)
  }
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
  const outDir = resolve(opts.outDir ?? join(dir, 'kit'))
  await mkdir(outDir, { recursive: true })

  const destinations = opts.channels.flatMap((c) => destinationsForChannel(c))
  const assets: KitAsset[] = []
  const skipped: string[] = []

  let stillTimes: number[]
  let moments: MomentCandidate[]
  if (opts.times?.length) {
    stillTimes = opts.times
    moments = opts.times.map((time) => ({ time, source: 'times' as const }))
  } else {
    opts.onPhase?.('moments (the step timeline, the zoom apexes, the spread)')
    const picked = await pickStillTimes(browser, dir, doc, duration, opts)
    stillTimes = picked.times
    moments = picked.moments
    for (const n of picked.notes) {
      if (n.startsWith('moment: ')) skipped.push(n)
      else opts.onPhase?.(`note: ${n}`)
    }
  }
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
          still: false,
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

  // The poster leg: a CARD destination renders from the POSTER DOCUMENT of
  // its aspect class, found beside the take (poster/<class>/doc.json, or
  // named in LAUNCH.md), at the document's REST (the trailing hold's
  // start), so the still is a frame of the poster's own video by
  // construction. Deliver renders and verifies; the composition is the
  // document's, written by an agent or the studio. A class with no
  // document falls to the take's own frame, said once in words.
  const posters = await findPosterDocs(dir, opts.launchRoles)
  const posterCardIds = new Set<string>()
  const missing = new Set<PosterClass>()
  for (const d of destinations) {
    if (d.kind === 'video' || d.genre !== 'card' || NOT_FROM_FOOTAGE[d.id])
      continue
    const cls = posterClassFor(d.px)
    const ref = posters[cls]
    if (!ref) {
      missing.add(cls)
      continue
    }
    posterCardIds.add(d.id)
    const label = `${d.channel} ${d.asset}`
    const posterDuration = totalDuration(ratedSegments(ref.doc))
    const time = posterStillTime(ref.doc, posterDuration)
    opts.onPhase?.(
      `${label} (${specWords(d)}) from ${ref.from}${ref.vosId ? ` ${ref.vosId}` : ''}, the rest at ${time.toFixed(2)}s`,
    )
    const shotDir = await mkdtemp(join(tmpdir(), 'vos-poster-'))
    try {
      const captured = await framesTake(browser, ref.takeDir, {
        times: [time],
        width: d.px.w,
        height: d.px.h,
        outDir: shotDir,
        doc: ref.doc,
        overrides: opts.overrides,
      })
      const to = join(outDir, `${d.id}.png`)
      await rename(captured.frames[0].file, to)
      const bytes = (await stat(to)).size
      if (d.maxBytes !== undefined && bytes > d.maxBytes) {
        skipped.push(
          `${label}: ${overCeiling(bytes, d.maxBytes)} (kept at ${to})`,
        )
        continue
      }
      const shot = posterShotRect(ref.doc, d.px)
      assets.push({
        channel: d.channel,
        asset: d.asset,
        destination: d.id,
        path: relative(outDir, to),
        w: d.px.w,
        h: d.px.h,
        bytes,
        seconds: null,
        frameTime: time,
        source: 'poster',
        poster: {
          class: cls,
          file: relative(dir, ref.file),
          ...(ref.vosId ? { vosId: ref.vosId } : {}),
        },
        text: posterTextBoxes(ref.doc, d.px, time),
        shot,
        ...(shot.x < 0 && shot.x + shot.w > 1 ? { crop: true } : {}),
      })
    } finally {
      await rm(shotDir, { recursive: true, force: true })
    }
  }
  if (missing.size) {
    const classes = [...missing].sort().join(', ')
    skipped.push(
      `note: no poster document for the ${classes} class${missing.size > 1 ? 'es' : ''} beside the take (poster/<class>/doc.json, or LAUNCH.md poster:), so those cards are the take's own frame`,
    )
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
          ? Math.min(
              10_000_000,
              Math.floor(((d.maxBytes * 8) / seconds) * 0.85),
            )
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
    const overrides = stillOverridesFor(d, opts, video)
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
        ...(d.genre === 'screenshot' && opts.composed
          ? { composed: true }
          : {}),
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
    look: opts.look?.kind ?? null,
    take: dir,
    produced: new Date().toISOString(),
    specsVerified: CHANNEL_SPECS_VERIFIED,
    moments,
    skipped,
    assets,
  }
  const kitFile = join(outDir, 'kit.json')
  await writeFile(kitFile, JSON.stringify(kit, null, 2))
  return { kit, kitFile, outDir }
}
