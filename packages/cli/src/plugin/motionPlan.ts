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
  END_CARD_RECEDE,
  END_CARD_SECONDS,
  applyTemplate,
  docOutputDuration,
  dropTemplate,
  endCardClips,
  migrateMotion,
  ratedSegments,
  spanOutputExtent,
} from '@vosjs/studio-core'
import { stepOutputTime } from './moments'
import type {
  AnimKind,
  Destination,
  EndCard,
  Look,
  ProjectDoc,
  TemplateAnchor,
} from '@vosjs/studio-core'
import type { ReleaseWords } from './posterValues'

/** Destinations that play sound (a feed autoplays muted; a demo has a speaker). */
export const SOUND_DESTINATIONS = new Set([
  'x-feed-cut',
  'youtube-main-demo',
  'shorts-linkedin-vertical-cut',
])

/** Destinations that must loop seamlessly: no entrance, no end card, no sound. */
export const LOOP_DESTINATIONS = new Set(['github-readme-loop'])

export interface MusicCatalog {
  tracks: {
    slug: string
    title: string
    mood?: string
    duration: number
    url: string
  }[]
  sfx: { slug: string; title: string; duration: number; url: string }[]
}

/** The ids the proposals write, so a re-proposal replaces its own work and nothing else. */
export const BED_ID = 'bed'
export const CLICK_ID_PREFIX = 'click-'
export const CAPTION_ID_PREFIX = 'caption-'

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
  /** The templates the recipe or the flags named, resolved, in order. */
  templates?: MotionTemplate[]
}

export interface MotionProposals {
  doc: ProjectDoc
  /** What was proposed, for the phase note. */
  notes: string[]
  /** What could not be proposed, in words. */
  skipped: string[]
}

const off = (v: string | undefined) =>
  v !== undefined && /^(none|off|false|no)$/i.test(v.trim())

/**
 * The bed: LAUNCH.md names a track slug or a mood; a mood picks the first
 * track of that mood. Null when nothing was asked or nothing matched.
 */
export function pickTrack(
  catalog: MusicCatalog | null,
  ask: string | undefined,
): MusicCatalog['tracks'][number] | null {
  if (!catalog || !ask || off(ask)) return null
  const want = ask.trim().toLowerCase()
  return (
    catalog.tracks.find((t) => t.slug.toLowerCase() === want) ??
    catalog.tracks.find((t) => (t.mood ?? '').toLowerCase() === want) ??
    null
  )
}

/** Click instants of the take in OUTPUT seconds, inside the range. */
export function clickTimes(doc: ProjectDoc, range: [number, number]): number[] {
  const rated = ratedSegments(doc)
  const out: number[] = []
  for (const e of doc.source.cursor) {
    if (e.type !== 'down') continue
    const src = e.t / 1000
    const ext = spanOutputExtent(rated, src, src + 0.001)
    if (!ext) continue
    const t = ext.start
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

  // The templates the recipe or the flags named, at their anchors: a
  // template is a vos, its clips come stamped with where they came from.
  const tWords = templateWords(words)
  const keys = opts.mark
    ? { 'stage-mark': opts.mark.key, 'endcard-markimg': opts.mark.key }
    : undefined
  for (const t of opts.templates ?? []) {
    const at = resolveAnchor(doc, t.at)
    if (at === null) {
      skipped.push(`${t.from}: ${anchorWord(t.at)} was not recorded`)
      continue
    }
    const applied = applyTemplate(t.doc, doc, {
      at,
      from: t.from,
      words: tWords,
      keys,
    })
    doc = applied.doc
    notes.push(`${t.from} at ${anchorWord(t.at)}`)
    for (const n of applied.notes) skipped.push(`${t.from}: ${n}`)
  }

  // The end card: on (or absent) is the house shape, clips after the
  // footage and a card exit; a named template took its place above; off
  // drops it.
  const endCardRole = launch.endCard
  doc = dropTemplate(doc, END_CARD_FROM)
  if (off(endCardRole)) {
    if (doc.frame.anim?.exit !== undefined) {
      const { exit: _exit, ...rest } = doc.frame.anim
      if (Object.keys(rest).length) doc.frame.anim = rest
      else delete doc.frame.anim
    }
  } else if (onWord(endCardRole)) {
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
      doc.overlays = [
        ...(doc.overlays ?? []),
        ...endCardClips(card, doc, outputLength(doc)),
      ]
      doc.frame.anim = {
        ...(doc.frame.anim ?? {}),
        exit: { kind: 'recede', seconds: END_CARD_RECEDE },
      }
      notes.push('end card')
    } else {
      skipped.push(
        'no end card (no headline or wordmark in LAUNCH.md, BRAND.md or the flags)',
      )
    }
  }

  // Captions per beat: a step's caption lands at the step's settled moment
  // as a lower-third.
  const kept = (doc.overlays ?? []).filter(
    (o) => !o.id.startsWith(CAPTION_ID_PREFIX),
  )
  const captionClips: NonNullable<ProjectDoc['overlays']> = []
  if (opts.captions.length && !off(launch.captions)) {
    const rated = ratedSegments(doc)
    const steps = doc.source.meta.steps ?? []
    for (const c of opts.captions) {
      const step = steps.find(
        (s) => (c.id !== undefined && s.id === c.id) || s.step === c.step,
      )
      if (!step || step.skipped) continue
      const t = stepOutputTime(rated, step, 0.2)
      if (t === null || t < 0 || t > footage - 1) continue
      captionClips.push({
        id: `${CAPTION_ID_PREFIX}${c.step}`,
        kind: 'text',
        text: c.caption,
        preset: 'caption',
        start: +t.toFixed(3),
        duration: Math.min(3.5, Math.max(2.5, footage - t - 0.2)),
        transform: { x: 0.5, y: 0.86, scale: 1, rotation: 0 },
        anim: { enter: 'rise', exit: 'fade' },
        align: 'center',
        box: { color: 'rgba(17,17,17,0.72)' },
      })
    }
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
  const track = pickTrack(catalog, launch.music)
  if (track) {
    const hasMic = !!doc.source.micKey
    const fadeOut = Math.min(2.5, length * 0.15)
    clips.push({
      id: BED_ID,
      key: track.url,
      name: track.title,
      start: 0,
      in: 0,
      out: Math.min(track.duration, length),
      duration: track.duration,
      gain: hasMic ? 0.35 : 0.5,
      fadeIn: 0.6,
      fadeOut,
      loop: track.duration < length,
      loopLen: track.duration < length ? length : undefined,
      duck: hasMic,
    })
    notes.push(`bed ${track.slug}`)
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

  return { doc, notes, skipped }
}

/**
 * What a VIDEO destination does to the document at render time, as doc
 * overrides for that one render: the spec's mechanics, never taste.
 */
export function destinationMechanics(
  d: Pick<Destination, 'id' | 'kind' | 'px' | 'text'>,
  doc: Pick<ProjectDoc, 'overlays'>,
): { set: string[]; unset: string[]; notes: string[] } {
  const set: string[] = []
  const unset: string[] = []
  const notes: string[] = []
  if (d.kind !== 'video') return { set, unset, notes }
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
