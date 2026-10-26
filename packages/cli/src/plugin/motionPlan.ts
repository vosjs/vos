/**
 * The cut's presenting MOTION as planner proposals on the document, and the
 * spec MECHANICS a destination applies at render time. Two halves, drawn
 * once:
 *
 * TASTE lives in the document, in the one vocabulary. `proposeMotion`
 * writes the card's `anim.enter`, lays the templates the recipe names at
 * their anchors (a template is a vos; its clips come stamped `from`), the
 * house end card as clips after the footage plus a card exit, a caption
 * per beat, a music bed and click sounds onto the cut's doc.json (`vos
 * plan`), keyed on the recipe's roles (LAUNCH.md) and never on measured
 * audio, so the studio shows exactly what the kit will render and a
 * human's deletion stays deleted (a re-plan never re-proposes onto a
 * document that already carries a cut).
 *
 * MECHANICS live in the spec. `destinationMechanics` is what a VIDEO
 * destination does to a document at render time and nothing more: a loop
 * drops the card's motion, every clip a template placed and every sound
 * (it must be seamless); a silent channel mutes the bed; a 9:16
 * destination reframes the card (a cover crop that follows the camera,
 * not a letterbox). Pure; the catalog and the words come in as data.
 */
import {
  END_CARD_FROM,
  END_CARD_SECONDS,
  applyTemplate,
  docOutputDuration,
  dropTemplate,
  endCardClips,
  hasReplay,
  migrateMotion,
  momentOutputs,
  ratedSegments,
  resolveAnchor as resolveLayerAnchor,
  sameMedia,
  spanOutputExtent,
} from '@vosjs/studio-core'
import { rankBeds, trackBySlug } from '@vosjs/shared/music'
import { fitCaptions, heldLine } from './captionFit'
import type { BedTrack, FilmSummary, RankedBed } from '@vosjs/shared/music'
import { STEP_SETTLE_SECONDS, stepOutputTime } from './moments'
import type {
  Anim,
  AnimKind,
  Destination,
  EndCard,
  Look,
  ProjectDoc,
  TemplateAnchor,
  TextOverlayClip,
} from '@vosjs/studio-core'

/** The release's words a plan writes into the cut's titles and end card. */
export interface ReleaseWords {
  headline?: string | null
  kicker?: string | null
  brand?: string | null
  release?: string | null
}

/** Destinations that play sound (a feed autoplays muted; a demo has a speaker). */
export const SOUND_DESTINATIONS = new Set([
  'x-feed-cut',
  'youtube-main-demo',
  'shorts-linkedin-vertical-cut',
])

/** Destinations that must loop seamlessly: no entrance, no end card, no sound. */
export const LOOP_DESTINATIONS = new Set(['github-readme-loop'])

/**
 * The catalog as `GET /api/music` answers it: each track with what the
 * library measured and a person wrote about it (`BedTrack`, the ranking's
 * input), plus the built-in effects.
 */
export interface MusicCatalog {
  tracks: BedTrack[]
  sfx: { slug: string; title: string; duration: number; url: string }[]
}

/** The ids the proposals write, so a re-proposal replaces its own work and nothing else. */
export const BED_ID = 'bed'
export const CLICK_ID_PREFIX = 'click-'
export const CAPTION_ID_PREFIX = 'caption-'
/** The longest a beat's caption stays, seconds. */
const CAPTION_BEAT_MAX = 3.5

/** The house caption: a lower-third in a dark box, rising in and fading out. */
export function houseCaption(
  id: string,
  text: string,
  start: number,
  duration: number,
): TextOverlayClip {
  return {
    id,
    kind: 'text',
    text,
    preset: 'caption',
    start,
    duration,
    transform: { x: 0.5, y: 0.86, scale: 1, rotation: 0 },
    anim: { enter: 'rise', exit: 'fade' },
    align: 'center',
    box: { color: 'rgba(17,17,17,0.72)' },
  }
}

export interface MotionProposalInput {
  words: ReleaseWords
  /** LAUNCH.md roles: music (a slug or mood), entrance, endCard, captions, clicks. */
  launch: Record<string, string>
  /** The end card's ink: the brand's ink over a light ground, white over a dark one. */
  ink?: string | null
  /** The brand's mark for the end card (a take-dir key and its aspect), or none. */
  mark?: { key: string; aspect: number } | null
  /** actions.json steps with their optional captions, by index. */
  captions: { step: number; id?: string; caption: string }[]
  catalog: MusicCatalog | null
  /**
   * The film as the music ranking reads it (`filmSummaryOf`), so a mood
   * or a few words in `music:` pick the bed that fits THIS cut; absent,
   * a mood picks the first track of that mood.
   */
  film?: FilmSummary
  /** The templates the recipe or the flags named, resolved, in order. */
  templates?: MotionTemplate[]
}

export interface MotionProposals {
  doc: ProjectDoc
  /** What was proposed, for the phase note. */
  notes: string[]
  /** What could not be proposed, in words. */
  skipped: string[]
  /** Captions kept past their step to be read, in words, with the room they need. */
  held: string[]
}

const off = (v: string | undefined) =>
  v !== undefined && /^(none|off|false|no)$/i.test(v.trim())

/** The kinds a boundary moves by. */
export type TransitionKind = 'slide' | 'fade' | 'scale'

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** A clip on either side of a page change keeps at least this much footage. */
const TRANSITION_CLIP_MIN = 1

/**
 * A transition at every page change: a recorded step that navigated (a
 * click, or the wait that let the load land) splits its clip, the outgoing
 * ending on the frame BEFORE the change and the incoming beginning once
 * the page has settled (the load between them is dropped), and the two
 * meet by the kind. A boundary that already sits there is left as it is
 * (a re-plan never doubles a cut); a change too close to a clip's edge is
 * named and skipped. Pure; the primary's steps only.
 */
export function proposeTransitions(
  input: ProjectDoc,
  kind: TransitionKind,
): { doc: ProjectDoc; count: number; skipped: string[] } {
  const doc = structuredClone(input)
  const skipped: string[] = []
  let count = 0
  const steps = doc.source.meta.steps ?? []
  for (const step of steps) {
    if (!step.navigated || step.skipped) continue
    const name = step.id ?? String(step.step)
    const wait = step.do === 'wait'
    const outEnd = round3(wait ? step.tStart : step.tEnd)
    const inStart = round3(wait ? step.tEnd : step.tEnd + STEP_SETTLE_SECONDS)
    const segs = doc.segments
    if (
      segs.some(
        (s) => !s.media && Math.abs(s.out - outEnd) < 0.05 && s !== segs.at(-1),
      )
    )
      continue
    const i = segs.findIndex(
      (s) =>
        !s.media &&
        outEnd >= s.in + TRANSITION_CLIP_MIN &&
        inStart <= s.out - TRANSITION_CLIP_MIN,
    )
    if (i < 0) {
      skipped.push(
        `no transition at step ${name}: the page change sits too close to a clip's edge`,
      )
      continue
    }
    const seg = segs[i]
    const before = { ...seg, out: outEnd, anim: { exit: kind } as Anim }
    const after = { ...seg, in: inStart, anim: { enter: kind } as Anim }
    if (seg.anim?.enter !== undefined) before.anim.enter = seg.anim.enter
    if (seg.anim?.exit !== undefined) after.anim.exit = seg.anim.exit
    doc.segments = [...segs.slice(0, i), before, after, ...segs.slice(i + 1)]
    count++
  }
  return { doc, count, skipped }
}

/** A bed the plan picked: the track, how, and the runner-up when a ranking chose. */
export interface PickedBed {
  track: BedTrack
  /** `slug`: named exactly; `ranked`: the ranking over the film; `first`: the first of the mood (no film to rank against). */
  via: 'slug' | 'ranked' | 'first'
  ranked: RankedBed | null
  runnerUp: RankedBed | null
}

/**
 * The bed: LAUNCH.md names a track slug, a mood or a few words. A slug is
 * that track. Anything else goes through the ranking over the film's
 * summary (the asked word as the mood, the whole ask as the words),
 * so every `music: upbeat` no longer gets the same song; with no film to
 * rank against, the first track of that mood, as before. Null when nothing
 * was asked or nothing matched.
 */
export function pickBed(
  catalog: MusicCatalog | null,
  ask: string | undefined,
  film?: FilmSummary,
): PickedBed | null {
  if (!catalog || !ask || off(ask)) return null
  const want = ask.trim().toLowerCase()
  const exact = trackBySlug(catalog.tracks, want)
  if (exact) return { track: exact, via: 'slug', ranked: null, runnerUp: null }
  if (film) {
    const oneWord = !/\s/.test(want)
    const ranked = rankBeds(catalog.tracks, {
      ...film,
      ...(oneWord ? { mood: want } : { words: want }),
    }).filter((r) => r.score !== null)
    // A single word that names neither a genre nor a tag is an ask the
    // library cannot answer, not a ranking of everything.
    const named = oneWord
      ? catalog.tracks.some(
          (t) =>
            (t.mood ?? '').toLowerCase() === want ||
            (t.tags ?? []).some((x) => x.toLowerCase() === want),
        )
      : ranked.some((r) => (r.scores?.fit ?? 0) > 0)
    if (!named || !ranked.length) return null
    return {
      track: ranked[0].track,
      via: 'ranked',
      ranked: ranked[0],
      runnerUp: ranked[1] ?? null,
    }
  }
  const first =
    catalog.tracks.find((t) => (t.mood ?? '').toLowerCase() === want) ?? null
  return first
    ? { track: first, via: 'first', ranked: null, runnerUp: null }
    : null
}

/** The bed's track alone (the older read); see `pickBed`. */
export function pickTrack(
  catalog: MusicCatalog | null,
  ask: string | undefined,
  film?: FilmSummary,
): BedTrack | null {
  return pickBed(catalog, ask, film)?.track ?? null
}

/** Click instants of the take in OUTPUT seconds, inside the range. */
export function clickTimes(doc: ProjectDoc, range: [number, number]): number[] {
  const rated = ratedSegments(doc)
  // A press plays each time the cut plays its seconds, as its ring does.
  const replayed = hasReplay(rated)
  const at: number[] = []
  for (const e of doc.source.cursor) {
    if (e.type !== 'down') continue
    const src = e.t / 1000
    if (replayed) {
      at.push(...momentOutputs(rated, src))
      continue
    }
    const ext = spanOutputExtent(rated, src, src + 0.001)
    if (ext) at.push(ext.start)
  }
  if (replayed) at.sort((a, b) => a - b)
  const out: number[] = []
  for (const t of at) {
    if (t < range[0] || t > range[1]) continue
    if (out.length && t - out[out.length - 1] < 0.12) continue
    out.push(+(t - range[0]).toFixed(3))
  }
  return out
}

const outputLength = (doc: ProjectDoc) =>
  ratedSegments(doc).reduce((acc, s) => {
    const rate = s.rate && s.rate > 0 ? s.rate : 1
    return acc + (s.out - s.in) / rate
  }, 0)

/**
 * The end card's cursor-off range: the drawn cursor leaves where the card
 * begins and stays off to the end of the film, so it never sits under the
 * card's words. Stamped `from: 'endcard'`, it replaces an earlier one and
 * goes wherever the end card goes; a person's own ranges are kept.
 */
function withEndCardCursorOff(doc: ProjectDoc, start: number): ProjectDoc {
  const own = (doc.cursor.off ?? []).filter((r) => r.from !== END_CARD_FROM)
  return {
    ...doc,
    cursor: {
      ...doc.cursor,
      off: [
        ...own,
        { in: +Math.max(0, start).toFixed(3), from: END_CARD_FROM },
      ],
    },
  }
}

/** Where a template lands: the studio-core anchor, or a recorded step's settle. */
export type MotionAnchor = TemplateAnchor | { step: string }

/** A template the recipe or a flag named, resolved to its document. */
export interface MotionTemplate {
  /** What its clips say they came from (the vos id or the path it was read from). */
  from: string
  doc: ProjectDoc
  at: MotionAnchor
}

/**
 * The words a template's clips take, by the ids the house templates use:
 * a poster's `stage-*` clips and an end card's `endcard-*` clips. A
 * template with other ids keeps its own words.
 */
export function templateWords(words: ReleaseWords): Record<string, string> {
  const headline = (words.headline ?? '').trim()
  const kicker = (words.kicker ?? '').trim()
  const brand = (words.brand ?? '').trim()
  const sub = [brand, (words.release ?? '').trim()].filter(Boolean).join(' ')
  const out: Record<string, string> = {}
  if (headline) {
    out['stage-title'] = headline
    out['endcard-title'] = headline
  }
  if (kicker) out['stage-kicker'] = kicker
  if (brand) {
    out['stage-brand'] = brand
    out['endcard-mark'] = brand
  }
  if (sub && sub !== headline) out['endcard-sub'] = sub
  return out
}

function resolveAnchor(
  doc: ProjectDoc,
  at: MotionAnchor,
): TemplateAnchor | null {
  if (typeof at !== 'object') return at
  const steps = doc.source.meta.steps ?? []
  const step = steps.find((s) => s.id === at.step || String(s.step) === at.step)
  if (!step || step.skipped) return null
  const t = stepOutputTime(ratedSegments(doc), step, 0.2)
  return t === null ? null : +t.toFixed(3)
}

const anchorWord = (at: MotionAnchor): string =>
  typeof at === 'object'
    ? `step ${at.step}`
    : typeof at === 'number'
      ? `${at}s`
      : `the ${at}`

const onWord = (v: string | undefined) =>
  v === undefined || /^(on|yes|true)$/i.test(v.trim())

/**
 * Propose the cut's motion onto a copy of the document, in the one
 * vocabulary: the card's `anim.enter`, the templates the recipe names
 * laid at their anchors (stamped `from`), the house end card as clips
 * after the footage plus a card exit (`from: 'endcard'`, the migration's
 * shape, until a shelf template replaces it), a caption per beat, a bed
 * and click sounds. Every proposal writes a STABLE id or a `from`, and
 * replaces only its own earlier work, so a maker's clips survive a second
 * pass. A legacy document is read into the vocabulary first.
 */
export function proposeMotion(
  input: ProjectDoc,
  opts: MotionProposalInput,
): MotionProposals {
  let doc = migrateMotion(structuredClone(input))
  const { words, launch, catalog } = opts
  const notes: string[] = []
  const skipped: string[] = []
  const held: string[] = []
  const footage = outputLength(doc)
  const range: [number, number] = [0, footage]

  // The card's enter: the clip opens on a move.
  const entrance = launch.entrance
  delete doc.frame.entrance
  if (!off(entrance)) {
    const kind =
      entrance && /^(tilt-in|pull-out|rise|fade)$/.test(entrance.trim())
        ? (entrance.trim() as AnimKind)
        : 'tilt-in'
    doc.frame.anim = { ...(doc.frame.anim ?? {}), enter: kind }
    notes.push(`enter ${kind}`)
  } else if (doc.frame.anim?.enter !== undefined) {
    const { enter: _enter, ...rest } = doc.frame.anim
    if (Object.keys(rest).length) doc.frame.anim = rest
    else delete doc.frame.anim
  }

  // Page changes: a recorded step that navigated is a cut with a
  // transition at the boundary. LAUNCH.md's `transitions` role picks the
  // kind (slide, the house default; fade; scale; none switches it off).
  const trRole = launch.transitions
  if (!off(trRole)) {
    const trKind =
      trRole && /^(slide|fade|scale)$/.test(trRole.trim())
        ? (trRole.trim() as TransitionKind)
        : 'slide'
    const made = proposeTransitions(doc, trKind)
    doc = made.doc
    if (made.count) notes.push(`${made.count} transition(s) ${trKind}`)
    for (const n of made.skipped) skipped.push(n)
  }

  // The end card the recipe names, or the official one the platform holds,
  // arrives as a template stamped `from: 'endcard'` (the house clips below
  // are the offline fallback); a re-plan replaces its earlier work first,
  // and `endCard: none` drops it with the rest.
  const endCardRole = launch.endCard
  doc = dropTemplate(doc, END_CARD_FROM)
  const templates = (opts.templates ?? []).filter(
    (t) => !(t.from === END_CARD_FROM && off(endCardRole)),
  )
  const namedEndCard = templates.some((t) => t.from === END_CARD_FROM)

  // The templates the recipe or the flags named, at their anchors: a
  // template is a vos, its clips come stamped with where they came from.
  const tWords = templateWords(words)
  const keys = opts.mark
    ? { 'stage-mark': opts.mark.key, 'endcard-markimg': opts.mark.key }
    : undefined
  for (const t of templates) {
    const at = resolveAnchor(doc, t.at)
    if (at === null) {
      skipped.push(`${t.from}: ${anchorWord(t.at)} was not recorded`)
      continue
    }
    const before = outputLength(doc)
    const applied = applyTemplate(t.doc, doc, {
      at,
      from: t.from,
      words: tWords,
      keys,
    })
    doc = applied.doc
    if (t.from === END_CARD_FROM) {
      // The cursor leaves where the moving footage ends, as under the
      // house card, or where the card's first clip begins if that is
      // sooner.
      const starts = (doc.overlays ?? [])
        .filter((o) => o.from === END_CARD_FROM && o.start !== undefined)
        .map((o) => o.start as number)
      doc = withEndCardCursorOff(doc, Math.min(before, ...starts))
    }
    notes.push(`${t.from} at ${anchorWord(t.at)}`)
    for (const n of applied.notes) skipped.push(`${t.from}: ${n}`)
  }

  // The end card: on (or absent) with no template in hand is the house
  // shape, a freeze under clips and a card exit; a named or official
  // template took its place above; off drops it.
  if (off(endCardRole)) {
    if (doc.frame.anim?.exit !== undefined) {
      const { exit: _exit, ...rest } = doc.frame.anim
      if (Object.keys(rest).length) doc.frame.anim = rest
      else delete doc.frame.anim
    }
  } else if (onWord(endCardRole) && !namedEndCard) {
    const headline = (words.headline ?? '').trim()
    const brand = (words.brand ?? '').trim()
    const sub = [brand, (words.release ?? '').trim()].filter(Boolean).join(' ')
    if (headline || brand) {
      const card: EndCard = { seconds: END_CARD_SECONDS }
      // Over a light plate the presets' white would vanish: the brand's ink.
      if (opts.ink) card.ink = opts.ink
      if (headline) card.headline = headline
      if (sub && sub !== headline) card.sub = sub
      if (brand) card.wordmark = brand
      if (opts.mark) card.mark = opts.mark
      // The words start where the moving footage ends; the card stays
      // under them as a freeze of its last frame (past its clip the card
      // is gone), receding over the card's seconds.
      const endStart = outputLength(doc)
      const lastSeg = doc.segments.at(-1)
      if (lastSeg) {
        // The last clip may play another media (concat): the freeze
        // names it, or its seconds would land on the primary's footage.
        const atEnd = (f: { at: number; media?: string }) =>
          Math.abs(f.at - lastSeg.out) <= 1e-9 &&
          sameMedia(f.media, lastSeg.media)
        // A freeze the take OWNS at its end survives (its rest, the frame
        // that stands for it) and grows to the card's seconds; only a
        // take with none gets the house freeze, stamped from.
        const kept = (doc.freeze ?? []).find((f) => atEnd(f) && !f.from)
        const own = (doc.freeze ?? []).filter((f) => !atEnd(f))
        const taken = new Set(own.map((f) => f.id))
        let n = 0
        while (taken.has(`f${n}`)) n++
        doc.freeze = [
          ...own,
          kept
            ? { ...kept, seconds: Math.max(kept.seconds, END_CARD_SECONDS) }
            : {
                id: `f${n}`,
                at: lastSeg.out,
                seconds: END_CARD_SECONDS,
                from: END_CARD_FROM,
                ...(lastSeg.media ? { media: lastSeg.media } : {}),
              },
        ].sort((a, b) => a.at - b.at)
      }
      doc.overlays = [
        ...(doc.overlays ?? []),
        ...endCardClips(card, doc, endStart),
      ]
      doc.frame.anim = {
        ...(doc.frame.anim ?? {}),
        exit: { kind: 'recede', seconds: END_CARD_SECONDS },
      }
      doc = withEndCardCursorOff(doc, endStart)
      notes.push('end card')
    } else {
      skipped.push(
        'no end card (no headline or wordmark in LAUNCH.md, BRAND.md or the flags)',
      )
    }
  }

  // Captions per beat: a step's caption is a lower-third that lands as the
  // step BEGINS, so its words name the beat while it plays, and leaves when
  // the step ends (landing after the step put its words over the next one).
  const kept = (doc.overlays ?? []).filter(
    (o) => !o.id.startsWith(CAPTION_ID_PREFIX),
  )
  const captionClips: NonNullable<ProjectDoc['overlays']> = []
  if (opts.captions.length && !off(launch.captions)) {
    const rated = ratedSegments(doc)
    const steps = doc.source.meta.steps ?? []
    const beats: {
      caption: (typeof opts.captions)[number]
      t: number
      until?: number
    }[] = []
    for (const c of opts.captions) {
      const step = steps.find(
        (s) => (c.id !== undefined && s.id === c.id) || s.step === c.step,
      )
      if (!step || step.skipped) continue
      const ref = step.id ?? step.step
      const t = resolveLayerAnchor(doc, { step: ref, at: 'start' }, rated).start
      if (t === null || t < 0 || t >= footage) continue
      const until = resolveLayerAnchor(
        doc,
        { step: ref, at: 'end' },
        rated,
      ).start
      beats.push({
        caption: c,
        t: +t.toFixed(3),
        ...(until !== null ? { until } : {}),
      })
    }
    // Each leaves with its step (or once its words are read), gives way to
    // the next and leaves before the footage ends, so a caption never sits
    // beside another one, over the next beat, or into the end card.
    const fit = fitCaptions(
      beats,
      (b) => ({
        start: b.t,
        end: footage,
        ...(b.until !== undefined ? { until: b.until } : {}),
        text: b.caption.caption,
      }),
      { max: CAPTION_BEAT_MAX },
    )
    for (const { item, why } of fit.dropped)
      skipped.push(`caption for step ${item.caption.step}: ${why}`)
    for (const k of fit.kept)
      if (k.held)
        held.push(
          heldLine(`the caption for step ${k.item.caption.step}`, k.held),
        )
    for (const { item, duration } of fit.kept)
      captionClips.push(
        houseCaption(
          `${CAPTION_ID_PREFIX}${item.caption.step}`,
          item.caption.caption,
          item.t,
          duration,
        ),
      )
    if (captionClips.length) notes.push(`${captionClips.length} caption(s)`)
  }
  const overlays = [...kept, ...captionClips]
  if (overlays.length) doc.overlays = overlays
  else delete doc.overlays

  // Sound: a bed and click sounds. A destination that plays no sound mutes
  // them at render time (`destinationMechanics`); the document carries
  // them, so the studio plays what the demo will. The bed fills the whole
  // OUTPUT, the clips after the footage included.
  const length = docOutputDuration(doc)
  const clips = (doc.audio ?? []).filter(
    (a) => a.id !== BED_ID && !a.id.startsWith(CLICK_ID_PREFIX),
  )
  const picked = pickBed(catalog, launch.music, opts.film)
  if (picked) {
    const { track } = picked
    const hasMic = !!doc.source.micKey
    const fadeOut = Math.min(2.5, length * 0.15)
    // A ranked pick carries where the track starts under the film (its
    // swell on the payoff, past a quiet intro, on a beat); a named one
    // plays from its top as it always did.
    const place = picked.ranked?.placement ?? null
    const start = place ? place.in : 0
    const covers = track.duration - start >= length
    clips.push({
      id: BED_ID,
      key: track.url,
      name: track.title,
      start: 0,
      in: start,
      out: place ? place.out : Math.min(track.duration, length),
      duration: track.duration,
      gain: hasMic ? 0.35 : 0.5,
      fadeIn: start > 0 ? 0.8 : 0.6,
      fadeOut,
      loop: place ? place.loop : !covers,
      loopLen: place
        ? place.loopLen
        : !covers
          ? Math.round(length * 1000) / 1000
          : undefined,
      duck: hasMic,
    })
    notes.push(
      picked.via === 'ranked' && picked.ranked
        ? `bed ${track.slug} (${picked.ranked.reasons.slice(0, 2).join(', ') || 'ranked'}${picked.runnerUp ? `; runner-up ${picked.runnerUp.slug}` : ''})`
        : `bed ${track.slug}`,
    )
  } else if (launch.music && !off(launch.music)) {
    skipped.push(
      `music "${launch.music}" is not a catalog track or mood${catalog ? '' : ' (the catalog could not be read)'}`,
    )
  }
  const click = catalog?.sfx.find((s) => s.slug === 'sfx-click')
  if (click && !doc.source.micKey && !off(launch.clicks)) {
    const times = clickTimes(doc, range)
    for (const [i, t] of times.entries()) {
      clips.push({
        id: `${CLICK_ID_PREFIX}${i}`,
        key: click.url,
        name: click.title,
        start: t,
        in: 0,
        out: click.duration,
        duration: click.duration,
        gain: 0.4,
        fadeIn: 0,
        fadeOut: 0,
      })
    }
    if (times.length) notes.push(`${times.length} click sound(s)`)
  }
  doc.audio = clips

  return { doc, notes, skipped, held }
}

/**
 * What a VIDEO destination does to the document at render time, as doc
 * overrides for that one render: the spec's mechanics, never taste.
 */
export function destinationMechanics(
  d: Pick<Destination, 'id' | 'px' | 'text'>,
  doc: Pick<ProjectDoc, 'overlays' | 'freeze'> & {
    cursor?: Pick<ProjectDoc['cursor'], 'off'>
  },
): { set: string[]; unset: string[]; notes: string[] } {
  const set: string[] = []
  const unset: string[] = []
  const notes: string[] = []
  const loop = LOOP_DESTINATIONS.has(d.id)
  const sound = SOUND_DESTINATIONS.has(d.id)
  const portrait = d.px.w / d.px.h < 0.9

  if (loop) {
    // Seamless by contract: the card neither arrives nor leaves, nothing a
    // template placed plays, nothing sounds. The two legacy spellings go
    // with it for a document read unmigrated.
    unset.push('frame.anim', 'frame.entrance', 'endCard')
    notes.push('loop: no card motion')
  }
  if (loop || !sound) {
    set.push('audio=[]')
    if (!loop) notes.push('silent channel')
  }
  if (loop || d.text === 'none') {
    // A destination that takes no words drops the beat captions; a loop
    // drops every clip a template placed too. A maker's own titles stay.
    const kept = (doc.overlays ?? []).filter(
      (o) => !o.id.startsWith(CAPTION_ID_PREFIX) && !(loop && o.from),
    )
    if (kept.length !== (doc.overlays ?? []).length) {
      set.push(`overlays=${JSON.stringify(kept)}`)
      notes.push(loop ? 'no template clips, no captions' : 'no captions')
    }
  }
  if (loop) {
    // The freeze a template placed under its clips goes with the clips,
    // and so does the cursor-off range it placed (it would blink the
    // cursor out at the wrap).
    const keptFreezes = (doc.freeze ?? []).filter((f) => !f.from)
    if (keptFreezes.length !== (doc.freeze ?? []).length)
      set.push(`freeze=${JSON.stringify(keptFreezes)}`)
    const off = doc.cursor?.off ?? []
    const keptOff = off.filter((r) => !r.from)
    if (keptOff.length !== off.length)
      set.push(`cursor.off=${JSON.stringify(keptOff)}`)
  }
  if (portrait) {
    // The vertical cut is a reframe, not a letterbox: the card is the tall
    // inset area, the footage cover-fills it, and the crop follows the camera.
    set.push('frame.fit=cover')
    set.push('frame.inset={"left":0.06,"right":0.06,"top":0.17,"bottom":0.17}')
    set.push('frame.focusFollow=camera')
    notes.push('vertical reframe follows the camera')
  }
  return { set, unset, notes }
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
