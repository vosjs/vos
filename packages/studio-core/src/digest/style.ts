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
import { anchorSourceDuration } from '../doc/studioDoc'
import { docOutputDuration } from '../audioBeds'
import type { FrameStyle, OverlayClip, ProjectDoc } from '../types'

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
  'entrance',
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
  hold: boolean
}

export function layoutOf(doc: ProjectDoc): LayoutParts {
  const frame = doc.frame as unknown as Record<string, unknown>
  return {
    frame: LAYOUT_FRAME_FIELDS.filter((k) => frame[k] !== undefined),
    clips: (doc.overlays ?? []).filter(isStageClip).map((o) => o.id),
    lean: restLeanOf(doc) !== null,
    hold: (doc.segments.at(-1)?.hold ?? 0) > 0,
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
    } else if (opts.keys?.[clip.id]) {
      next.key = opts.keys[clip.id]
    } else if (mine && mine.kind !== 'text') {
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

  const hold = from.segments.at(-1)?.hold
  const last = doc.segments.at(-1)
  if (typeof hold === 'number' && hold > 0 && last) last.hold = hold

  return { doc, notes }
}
