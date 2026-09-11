/**
 * Style as DATA: the fields of a signed-off take's doc that ARE its
 * style — camera, speed, tilt personality, frame, cursor, cam bubble, export.
 * `copyStyle` carries them onto another take deterministically, so a series
 * shares them by construction and the recipe (CUT.md) only has to say what a
 * number cannot. Never the spans, overlays or audio: those are the cut.
 *
 * A LAYOUT is the same idea for a poster: an exemplar document holds the
 * card's placement and presentation, the words' clips, the rest lean and
 * the trailing hold, and `copyLayout` carries exactly those onto another
 * take. A layout is never a name a document learns; it is a document on a
 * shelf, applied by copy.
 */
import { totalDuration } from '@vosjs/timeline'
import { sameMedia } from '../media'
import { anchorSourceDuration } from '../doc/studioDoc'
import { docOutputDuration } from '../audioBeds'
import { ratedSegments } from '../lower/lowerToComposition'
import { docFreezes } from '../lower/motion'
import type {
  AudioClip,
  FrameStyle,
  FreezeSpan,
  ObjectClip,
  OverlayClip,
  ProjectDoc,
} from '../types'

export const STYLE_FIELDS = [
  'zoomStyle',
  'zoomParams',
  'speedParams',
  'tiltStyle',
  'frame',
  'cursor',
  'cam',
  'export',
] as const satisfies readonly (keyof ProjectDoc)[]

export type StyleField = (typeof STYLE_FIELDS)[number]

/** The style fields present on a doc, deep-cloned. */
export function pickStyle(
  doc: ProjectDoc,
): Partial<Pick<ProjectDoc, StyleField>> {
  const out: Record<string, unknown> = {}
  for (const k of STYLE_FIELDS) {
    const v: unknown = doc[k]
    if (v !== undefined) out[k] = structuredClone(v)
  }
  return out as Partial<Pick<ProjectDoc, StyleField>>
}

export interface CopyStyleOptions {
  /**
   * Carry the seed's LAYOUT too (`copyLayout`): its stage clips by id, its
   * rest lean and its trailing hold. Off by default, so a series cut keeps
   * copying style alone.
   */
  layout?: boolean
  /** Passed through to `copyLayout`. */
  keys?: Record<string, string>
}

/**
 * A new doc: `to` with `from`'s style fields. A field absent on `from` is
 * removed from the result (the seed's absence is a choice — the default).
 */
export function copyStyle(
  from: ProjectDoc,
  to: ProjectDoc,
  opts: CopyStyleOptions = {},
): ProjectDoc {
  const next = structuredClone(to) as unknown as Record<string, unknown>
  const style = pickStyle(from) as Record<string, unknown>
  for (const k of STYLE_FIELDS) {
    if (k in style) next[k] = style[k]
    else delete next[k]
  }
  const styled = next as unknown as ProjectDoc
  return opts.layout
    ? copyLayout(from, styled, { keys: opts.keys }).doc
    : styled
}

// ── layout ──────────────────────────────────────────────────────────────

/** The frame fields a layout owns. Never `aspectRatio` or `browserBar`. */
export const LAYOUT_FRAME_FIELDS = [
  'background',
  'padding',
  'radius',
  'shadow',
  'shadowContact',
  'shadowColor',
  'inset',
  'border',
  'borderWidth',
  'borderColor',
  'fit',
  'focus',
  'focusFollow',
  'parallax',
  'anim',
] as const satisfies readonly (keyof FrameStyle)[]

/**
 * The id prefix an exemplar reserves for the clips that ARE its layout:
 * the words and the mark a poster places (`stage-title`, `stage-kicker`,
 * `stage-brand`, `stage-mark`). Every other clip is the take's own.
 */
export const STAGE_CLIP_PREFIX = 'stage-'

/** The id of the whole-take lean a layout or a canvas gesture writes. */
export const REST_TILT_ID = 'rest'

export const isStageClip = (clip: Pick<OverlayClip, 'id'>): boolean =>
  clip.id.startsWith(STAGE_CLIP_PREFIX)

/** The exemplar's rest lean: its `rest`/`stage` span, or a span covering (nearly) the whole source. */
export function restLeanOf(doc: ProjectDoc): { rx: number; ry: number } | null {
  const spans = doc.tilt ?? []
  const named = spans.find((z) => z.id === REST_TILT_ID || z.id === 'stage')
  if (named) return { rx: named.rx, ry: named.ry }
  const total = anchorSourceDuration(doc)
  const whole = spans.find((z) => z.out - z.in >= total * 0.9)
  return whole ? { rx: whole.rx, ry: whole.ry } : null
}

/** What a document carries of a layout, for a report. */
export interface LayoutParts {
  /** The layout-owned frame fields present on the document. */
  frame: string[]
  /** The stage clips' ids. */
  clips: string[]
  lean: boolean
  /** A trailing freeze (the poster's rest). */
  freeze: boolean
}

export function layoutOf(doc: ProjectDoc): LayoutParts {
  const frame = doc.frame as unknown as Record<string, unknown>
  return {
    frame: LAYOUT_FRAME_FIELDS.filter((k) => frame[k] !== undefined),
    clips: (doc.overlays ?? []).filter(isStageClip).map((o) => o.id),
    lean: restLeanOf(doc) !== null,
    freeze: trailingFreeze(doc) !== null,
  }
}

export interface CopyLayoutOptions {
  /**
   * Media keys this document should show in the exemplar's image clips,
   * by clip id (`{ 'stage-mark': 'brand/mark.svg' }`): an exemplar's mark
   * is its brand's, so without a key of its own (here, or already on the
   * document) an image stage clip is left out and said in `notes`.
   */
  keys?: Record<string, string>
}

export interface CopiedLayout {
  doc: ProjectDoc
  /** What the copy left alone, in plain words (empty when nothing was). */
  notes: string[]
}

/**
 * `to` with `from`'s layout. Pure: returns a new document; never mutates
 * either input.
 *
 * Copied: the layout-owned frame fields (present on the exemplar ⇒ copied,
 * absent ⇒ removed; the animated ground rides along only when the exemplar
 * has one), the stage clips by id (a same-id text clip keeps the words this
 * document already has; an image clip keeps this document's key, or takes
 * one from `keys`), the rest lean as one whole-take span where this
 * document has no tilt spans of its own, and the trailing hold. Kept: the
 * aspect, the browser chrome, every clip that is not a stage clip, the cut.
 */
export function copyLayout(
  from: ProjectDoc,
  to: ProjectDoc,
  opts: CopyLayoutOptions = {},
): CopiedLayout {
  const doc = structuredClone(to)
  const notes: string[] = []

  const frame = doc.frame as unknown as Record<string, unknown>
  const src = from.frame as unknown as Record<string, unknown>
  for (const k of LAYOUT_FRAME_FIELDS) {
    if (src[k] !== undefined) frame[k] = structuredClone(src[k])
    else delete frame[k]
  }
  if (from.frame.backgroundMedia)
    doc.frame.backgroundMedia = structuredClone(from.frame.backgroundMedia)

  const outDur = docOutputDuration(doc)
  const own = new Map((doc.overlays ?? []).map((o) => [o.id, o]))
  const merged: OverlayClip[] = (doc.overlays ?? []).filter(
    (o) => !isStageClip(o),
  )
  const skippedMarks: string[] = []
  for (const clip of (from.overlays ?? []).filter(isStageClip)) {
    const mine = own.get(clip.id)
    const next = structuredClone(clip)
    next.start = 0
    next.duration = Math.max(0.3, Math.round(outDur * 1000) / 1000)
    if (next.kind === 'text') {
      if (mine?.kind === 'text') next.text = mine.text
    } else if (next.kind === 'html') {
      // An HTML layer has no key: its content IS its source. There is nothing
      // to swap in, and nothing missing to skip the clip for.
    } else if (opts.keys?.[clip.id]) {
      next.key = opts.keys[clip.id]
    } else if (mine && mine.kind !== 'text' && mine.kind !== 'html') {
      next.key = mine.key
    } else {
      skippedMarks.push(clip.id)
      continue
    }
    merged.push(next)
  }
  for (const o of doc.overlays ?? []) {
    if (isStageClip(o) && !merged.some((m) => m.id === o.id)) merged.push(o)
  }
  doc.overlays = merged.length ? merged : undefined
  if (skippedMarks.length)
    notes.push(
      `${skippedMarks.join(', ')} left out: the layout's image is its own brand's; add yours`,
    )

  const lean = restLeanOf(from)
  if (lean) {
    if (!doc.tilt?.length) {
      doc.tilt = [
        {
          id: REST_TILT_ID,
          in: 0,
          out: Math.round(anchorSourceDuration(doc) * 1000) / 1000,
          rx: lean.rx,
          ry: lean.ry,
          source: 'manual',
        },
      ]
    } else {
      notes.push('lean kept: this take has tilt spans of its own')
    }
  }

  // The trailing freeze: the exemplar's rest becomes this take's, at the
  // end of ITS last segment, with the same seconds.
  const freeze = trailingFreeze(from)
  const last = doc.segments.at(-1)
  if (freeze && last) {
    // The last clip may play another media (concat): the freeze names
    // it, or its seconds would land on the primary's footage instead.
    const atEnd = (f: FreezeSpan) =>
      Math.abs(f.at - last.out) <= 1e-9 && sameMedia(f.media, last.media)
    const own = (doc.freeze ?? []).filter((f) => !atEnd(f))
    // A freeze the take OWNS at its end survives (it is the take's rest,
    // the frame that stands for it); it grows to the layout's seconds.
    const kept = (doc.freeze ?? []).find((f) => atEnd(f) && !f.from)
    const taken = new Set(own.map((f) => f.id))
    let n = 0
    while (taken.has(`f${n}`)) n++
    doc.freeze = [
      ...own,
      kept
        ? { ...kept, seconds: Math.max(kept.seconds, freeze.seconds) }
        : {
            id: `f${n}`,
            at: last.out,
            seconds: freeze.seconds,
            ...(last.media ? { media: last.media } : {}),
          },
    ].sort((a, b) => a.at - b.at)
    doc.segments = doc.segments.map((s) => {
      if (s.hold === undefined) return s
      const next = { ...s }
      delete next.hold
      return next
    })
  }

  return { doc, notes }
}

/** The freeze at the end of the document's last segment, if any. */
function trailingFreeze(doc: ProjectDoc): FreezeSpan | null {
  const last = doc.segments.at(-1)
  if (!last) return null
  return docFreezes(doc).find((f) => Math.abs(f.at - last.out) < 1e-9) ?? null
}

/** Where a template's clips land on the take. */
export type TemplateAnchor = 'start' | 'end' | number

export interface ApplyTemplateOptions {
  /**
   * The anchor: `start` keeps the template's times; `end` lays them
   * relative to the take's footage end as they sat relative to the
   * template's own (an end card); a number is an output second the
   * template's clock starts at (a caption at a step's settle).
   */
  at: TemplateAnchor
  /** Words for the template's text clips, by clip id. */
  words?: Record<string, string>
  /** Media keys for the template's image and video clips, by clip id. */
  keys?: Record<string, string>
  /**
   * What the clips say they came from (the template's vos id). Absent =
   * `'template'`. A re-apply with the same `from` replaces its earlier
   * clips and leaves everything else.
   */
  from?: string
  /**
   * Carry the template's look too (the layout-owned frame fields, its
   * backdrop, the rest lean, the trailing hold): a poster. Absent = the
   * clips and the card's animation only.
   */
  look?: boolean
}

export interface AppliedTemplate {
  doc: ProjectDoc
  notes: string[]
}

const shiftBy = (at: TemplateAnchor, templateEnd: number, takeEnd: number) =>
  at === 'start' ? 0 : at === 'end' ? takeEnd - templateEnd : at

/**
 * The clips a template placed on a document (by `from`), in document order.
 */
export function clipsFrom(
  doc: Pick<ProjectDoc, 'overlays' | 'objects' | 'audio'>,
  from: string,
): { overlays: OverlayClip[]; objects: ObjectClip[]; audio: AudioClip[] } {
  return {
    overlays: (doc.overlays ?? []).filter((o) => o.from === from),
    objects: (doc.objects ?? []).filter((o) => o.from === from),
    audio: (doc.audio ?? []).filter((a) => a.from === from),
  }
}

/**
 * The document without the clips a template placed. The card's `anim` is
 * the card's own once set, so it stays; a caller that wants the card still
 * clears it. Returns the same object when nothing came from `from`.
 */
export function dropTemplate(doc: ProjectDoc, from: string): ProjectDoc {
  const has = clipsFrom(doc, from)
  const freezes = (doc.freeze ?? []).some((f) => f.from === from)
  if (
    !has.overlays.length &&
    !has.objects.length &&
    !has.audio.length &&
    !freezes
  )
    return doc
  const out: ProjectDoc = { ...doc }
  if (doc.overlays) out.overlays = doc.overlays.filter((o) => o.from !== from)
  if (doc.objects) out.objects = doc.objects.filter((o) => o.from !== from)
  out.audio = doc.audio.filter((a) => a.from !== from)
  if (doc.freeze) out.freeze = doc.freeze.filter((f) => f.from !== from)
  return out
}

/**
 * A TEMPLATE is a vos: a plain take document whose clips carry stable ids.
 * Applying it lays those clips onto another take at an ANCHOR, stamped
 * `from`, with the release's words and keys patched in by id; the take's
 * own same-id clip keeps its words unless `words` names them (the layout
 * rule); the template's card `anim` merges over the take's (an end card
 * brings the exit, a poster the entrance); with `look`, the layout-owned
 * frame fields, the backdrop, the rest lean and the hold come too, which
 * is `copyLayout`. The one assembly verb; a recipe says which template and
 * where, never the document.
 */
export function applyTemplate(
  template: ProjectDoc,
  take: ProjectDoc,
  opts: ApplyTemplateOptions,
): AppliedTemplate {
  const from = opts.from ?? 'template'
  const notes: string[] = []
  const base = dropTemplate(take, from)
  const doc: ProjectDoc = structuredClone(base)
  // A template that ends on a freeze keeps its card under its clips; laid
  // at the end of a take, the same freeze goes on the take's last frame
  // (stamped `from`), and the clips place against the end that includes it.
  const tail = trailingFreeze(template)
  const lastSeg = doc.segments.at(-1)
  if (tail && opts.at === 'end' && lastSeg) {
    // The last clip may play another media (concat): the freeze names
    // it, or its seconds would land on the primary's footage instead.
    const atEnd = (f: FreezeSpan) =>
      Math.abs(f.at - lastSeg.out) <= 1e-9 && sameMedia(f.media, lastSeg.media)
    // A freeze the take OWNS at its end survives the template (it is the
    // take's rest, the frame that stands for it) and grows to the
    // template's seconds; only then is the template's own freeze laid,
    // stamped `from`, so a still never reads it as the rest.
    const kept = (doc.freeze ?? []).find((f) => atEnd(f) && !f.from)
    const own = (doc.freeze ?? []).filter((f) => !atEnd(f))
    const taken = new Set(own.map((f) => f.id))
    let n = 0
    while (taken.has(`f${n}`)) n++
    doc.freeze = [
      ...own,
      kept
        ? { ...kept, seconds: Math.max(kept.seconds, tail.seconds) }
        : {
            id: `f${n}`,
            at: lastSeg.out,
            seconds: tail.seconds,
            from,
            ...(lastSeg.media ? { media: lastSeg.media } : {}),
          },
    ].sort((a, b) => a.at - b.at)
  }
  const templateEnd = totalDuration(ratedSegments(template))
  const takeEnd = totalDuration(ratedSegments(doc))
  const shift = shiftBy(opts.at, templateEnd, takeEnd)
  const own = new Map((take.overlays ?? []).map((o) => [o.id, o]))

  const overlays: OverlayClip[] = (doc.overlays ?? []).filter(
    (o) => !(template.overlays ?? []).some((t) => t.id === o.id),
  )
  const skipped: string[] = []
  for (const clip of template.overlays ?? []) {
    const next = structuredClone(clip) as OverlayClip
    next.start = Math.max(0, round3(clip.start + shift))
    next.from = from
    const mine = own.get(clip.id)
    if (next.kind === 'text') {
      const word = opts.words?.[clip.id]
      if (word !== undefined) next.text = word
      else if (mine?.kind === 'text') next.text = mine.text
    } else if (next.kind === 'html') {
      // No key to swap: an HTML layer carries its own source.
    } else if (opts.keys?.[clip.id]) {
      next.key = opts.keys[clip.id]
    } else if (mine && mine.kind !== 'text' && mine.kind !== 'html') {
      next.key = mine.key
    } else if (!/^(https?:|\/\/)/.test(next.key)) {
      skipped.push(clip.id)
      continue
    }
    overlays.push(next)
  }
  if (skipped.length)
    notes.push(
      `${skipped.join(', ')}: the template's media key is its own; pass keys[id] or the take's clip`,
    )
  if (overlays.length || doc.overlays) doc.overlays = overlays

  const objects: ObjectClip[] = (doc.objects ?? []).filter(
    (o) => !(template.objects ?? []).some((t) => t.id === o.id),
  )
  for (const clip of template.objects ?? []) {
    const next = structuredClone(clip) as ObjectClip
    if (next.span)
      next.span.start = Math.max(0, round3(next.span.start + shift))
    next.from = from
    objects.push(next)
  }
  if (objects.length || doc.objects) doc.objects = objects

  const audio: AudioClip[] = doc.audio.filter(
    (a) => !template.audio.some((t) => t.id === a.id),
  )
  for (const clip of template.audio) {
    const next = structuredClone(clip) as AudioClip
    next.start = Math.max(0, round3(clip.start + shift))
    next.from = from
    audio.push(next)
  }
  doc.audio = audio

  if (template.frame.anim) {
    doc.frame = {
      ...doc.frame,
      anim: { ...(doc.frame.anim ?? {}), ...template.frame.anim },
    }
  }

  if (opts.look) {
    const laid = copyLayout(template, doc, { keys: opts.keys })
    // copyLayout owns the stage clips; everything above stays as placed.
    laid.doc.overlays = (laid.doc.overlays ?? []).map((o) =>
      isStageClip(o) ? { ...o, from } : o,
    )
    notes.push(...laid.notes)
    return { doc: laid.doc, notes }
  }
  return { doc, notes }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
