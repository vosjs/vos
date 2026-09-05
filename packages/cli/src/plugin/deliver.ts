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
import { renderPosterStills } from './posterStill'
import { momentCandidates, pickMoments } from './moments'
import { decodePng, differenceHash, inkCoverage } from './picture'
import { bakeShot, encodePng } from './shotBake'
import {
  fillTemplate,
  templateOf,
  templateProblems,
  textLimitProblems,
} from './template'
import { templateByName } from './templates'
import { posterValues } from './posterValues'
import { isTileSize, stageSplitCover, stageTile } from './stages'
import { LOOP_DESTINATIONS, planMotion } from './motionPlan'
import type { MusicCatalog } from './motionPlan'
import type { MomentCandidate } from './moments'
import type { ReleaseWords } from './posterValues'
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
   * The maker's poster program (the split-cover family). With one in hand,
   * CARD-genre destinations (OG, LinkedIn, X, YouTube thumbnail, the CWS
   * tile + marquee, GitHub social preview) render from the POSTER — the
   * verdict: the cover is a composition, never a raw frame — with this
   * release's full-bleed shot baked in as the poster's image element.
   * Screenshot-genre destinations always stay real take frames (store
   * policy demands real UX).
   */
  poster?: { config: Record<string, unknown>; from: string } | null
  /**
   * The release's words for the templates: the headline (LAUNCH.md's
   * `headline` role or --headline), an optional kicker, the wordmark. With
   * no headline, destinations whose template carries one fall to the
   * headline-less template, said in words.
   */
  words?: ReleaseWords
  /** The brand kit's frontmatter roles, when a BRAND.md sits beside the take. */
  brandRoles?: Record<string, string> | null
  /** LAUNCH.md's roles beside the take (music, entrance, endCard, captions, clicks). */
  launchRoles?: Record<string, string> | null
  /** The platform's music catalog, read when a destination plays sound; null = silent. */
  catalog?: MusicCatalog | null
  /** actions.json captions by step, for the beat captions on feed cuts. */
  captions?: { step: number; id?: string; caption: string }[]
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
  /** Where the pixels came from: the take (absent = take), a poster program, or a stage (the take's own card composed). */
  source?: 'poster' | 'stage'
  /** The template family a poster card rendered from. */
  template?: string
  /** Where the words landed, as fractions of the asset (the picture checks read them). */
  text?: TextBox[]
  /** Where the release's shot sits on a poster card, fractions of the asset (bleeds may exceed 1). */
  shot?: { x: number; y: number; w: number; h: number }
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
 * The template each card destination renders from: an explicit --poster
 * config for every card; null (`--poster none`) for the take path; else
 * the destination's own default from the channel specs, by name from the
 * bundled family. A headline-carrying template with no headline in hand
 * falls to card-on-gradient, said in words.
 */
export function templateForCard(
  d: Pick<Destination, 'id' | 'template' | 'px'>,
  opts: Pick<DeliverOptions, 'poster' | 'words'>,
): {
  config: Record<string, unknown>
  from: string
  note?: string
  stage?: 'split-cover' | 'tile'
} | null {
  if (opts.poster === null) return null
  if (opts.poster) return { config: opts.poster.config, from: opts.poster.from }
  if (!d.template) return null
  // A TILE (long side under TILE_MAX_PX) composes as a stage whatever its
  // template names: a headline over a close crop of the page's hero. The
  // whole page in a 370 px card is unreadable by construction.
  if (isTileSize(d.px)) {
    const config =
      templateByName(d.template) ?? templateByName('card-on-gradient')
    if (config) return { config, from: 'stage tile', stage: 'tile' }
  }
  let name = d.template
  let note: string | undefined
  const wants = templateOf(templateByName(name) ?? {})
  const needsHeadline = wants?.text.some((t) => t.role === 'headline')
  if (needsHeadline && !opts.words?.headline?.trim()) {
    name = 'card-on-gradient'
    note = `${d.id}: no headline (LAUNCH.md headline: or --headline), so the ${d.template} template stands down for card-on-gradient`
  }
  const config = templateByName(name)
  if (!config) return null
  // The split cover composes as a STAGE by default: the take's own card in
  // perspective with its chrome and shadow (the program template is one
  // --poster away, for a maker who wants the grained ground).
  if (name === 'split-cover')
    return { config, from: 'stage split-cover', note, stage: 'split-cover' }
  return { config, from: `template ${name}`, note }
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

/**
 * The end card's ink: the brand's ink (or near-black) over a light ground,
 * white over a dark one, decided from the look's ground.
 */
export function endCardInk(
  look: Look | null | undefined,
  brand: Record<string, string> | null | undefined,
): string | null {
  if (!look) return null
  const ground = look.ground
  const m = /#([0-9a-f]{6})/i.exec(ground)
  const hex = m ? m[0] : null
  const light =
    look.kind === 'plate' ||
    (hex ? isLightHexGround(hex) : look.kind === 'gradient')
  if (!light) return '#ffffff'
  const ink = brand?.ink
  return ink && /^#[0-9a-f]{6}$/i.test(ink) ? ink : '#111111'
}

function isLightHexGround(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 >= 0.6
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
   * then the destination's motion plan (entrance, end card, captions,
   * sound, the vertical reframe), then the user's own sets, which win.
   */
  const videoOverrides = (
    d: Destination,
    range: [number, number] | undefined,
  ): DocOverrides | undefined => {
    const set: string[] = []
    if (opts.look) {
      set.push(
        ...lookOverrides(opts.look, 'hero', d.px, video, {
          still: false,
          keepMedia: opts.overrides?.background !== undefined,
        }),
      )
    }
    const plan = planMotion({
      destination: d,
      doc,
      range: range ?? [0, duration],
      words: opts.words ?? {},
      launch: opts.launchRoles ?? {},
      captions: opts.captions ?? [],
      catalog: opts.catalog ?? null,
      ink: endCardInk(opts.look, opts.brandRoles),
    })
    set.push(...plan.set)
    if (plan.notes.length) opts.onPhase?.(`${d.id}: ${plan.notes.join(', ')}`)
    for (const s of plan.skipped) skipped.push(`note: ${s}`)
    set.push(...(opts.overrides?.set ?? []))
    if (!set.length) return opts.overrides
    return { ...opts.overrides, set }
  }

  // The poster leg: card-genre stills COMPOSE by default. Each card
  // destination names its template (an explicit --poster config wins;
  // --poster none keeps the take path), the release's full-bleed shot is
  // captured once at the hero moment, baked into an object (padded,
  // rounded, shadowed, a hairline on a light ground), and the template is
  // filled per destination: the shot placed for that aspect, the brand's
  // colours and faces, the release's words. PNG from our own page.
  const cardPlans = destinations
    .filter(
      (d) =>
        d.kind !== 'video' && d.genre === 'card' && !NOT_FROM_FOOTAGE[d.id],
    )
    .map((d) => ({ d, plan: templateForCard(d, opts) }))
    .filter(
      (
        p,
      ): p is {
        d: Destination
        plan: NonNullable<ReturnType<typeof templateForCard>>
      } => p.plan !== null,
    )
  const posterCardIds = new Set(cardPlans.map((p) => p.d.id))
  for (const p of cardPlans)
    if (p.plan.note) skipped.push(`note: ${p.plan.note}`)

  if (cardPlans.length) {
    const meta = doc.source.meta
    const heroTime =
      opts.shotTime ?? (stillTimes.length ? stillTimes[0] : duration / 2)
    const fill = posterValues(opts.brandRoles, opts.words ?? {})
    opts.onPhase?.(
      `poster shot (full bleed at ${heroTime.toFixed(2)}s), baked as an object`,
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
            'cursor.visible=false',
            'cursor.clickFx.style=none',
            ...(opts.overrides?.set ?? []),
          ],
        },
      })
      const raw = decodePng(new Uint8Array(await readFile(shot.frames[0].file)))
      if (!raw) throw new Error('the poster shot could not be decoded')
      const PAD = 0.06
      const baked = bakeShot(raw, {
        margin: PAD,
        hairline: fill.lightGround ? 0.14 : 0,
        shadow: fill.lightGround ? 0.28 : 0.4,
      })
      await writeFile(join(serveDir, 'shot.png'), encodePng(baked))
      const shotAspect = raw.w / raw.h

      for (const { d, plan } of cardPlans) {
        if (plan.stage) {
          const stageInput = {
            size: d.px,
            values: fill.values,
            sourceSeconds: meta.durationMs / 1000,
            outputSeconds: duration,
            text: d.text,
          }
          const staged =
            plan.stage === 'tile'
              ? stageTile(stageInput)
              : stageSplitCover(stageInput)
          opts.onPhase?.(
            `${d.channel} ${d.asset} (${specWords(d)}) from ${plan.from}`,
          )
          const shotDir = await mkdtemp(join(tmpdir(), 'vos-stage-'))
          try {
            const captured = await framesTake(browser, dir, {
              times: [heroTime],
              width: d.px.w,
              height: d.px.h,
              outDir: shotDir,
              overrides: {
                ...opts.overrides,
                set: [...staged.set, ...(opts.overrides?.set ?? [])],
              },
            })
            const to = join(outDir, `${d.id}.png`)
            await rename(captured.frames[0].file, to)
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
              frameTime: heroTime,
              source: 'stage',
              template: `${plan.stage}-stage`,
              text: staged.text,
              shot: staged.shot,
              ...(plan.stage === 'tile' ? { crop: true } : {}),
            })
          } finally {
            await rm(shotDir, { recursive: true, force: true })
          }
          continue
        }
        const problems = templateProblems(plan.config)
        if (problems.length) {
          skipped.push(
            `${d.channel} ${d.asset}: ${plan.from} is not a valid template (${problems[0]}) — kept from the take`,
          )
          posterCardIds.delete(d.id)
          continue
        }
        const filled = fillTemplate(plan.config, {
          size: d.px,
          slots: { shot: { src: '/shot.png', aspect: shotAspect, pad: PAD } },
          values: fill.values,
        })
        const limits = textLimitProblems(templateOf(plan.config)!, fill.values)
        for (const l of limits) skipped.push(`note: ${d.id}: ${l}`)
        if (filled.missing.length) {
          skipped.push(
            `${d.channel} ${d.asset}: ${plan.from} needs ${filled.missing.join(', ')} — kept from the take`,
          )
          posterCardIds.delete(d.id)
          continue
        }
        const config = filled.config
        if (fill.fonts.length) {
          const declared = Array.isArray(config.fonts)
            ? (config.fonts as unknown[])
            : []
          config.fonts = [...declared, ...fill.fonts]
        }
        const posterDuration =
          typeof config.duration === 'number' ? config.duration : 6
        const time = Math.min(
          opts.posterTime ?? posterDuration * 0.9,
          Math.max(0, posterDuration - 0.05),
        )
        opts.onPhase?.(
          `${d.channel} ${d.asset} (${specWords(d)}) from ${plan.from}, ${filled.aspect}`,
        )
        await renderPosterStills(
          browser,
          config,
          serveDir,
          [{ name: `${d.id}.png`, width: d.px.w, height: d.px.h }],
          time,
        )
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
          frameTime: heroTime,
          source: 'poster',
          template: templateOf(plan.config)?.family ?? plan.from,
          text: filled.text,
          shot: filled.slots.shot,
        })
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
        overrides: videoOverrides(d, range),
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
