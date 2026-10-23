/**
 * The document features a RENDERER must understand, each with the release
 * of this package that taught the lowering to read it.
 *
 * A document is data, and a field the lowering does not know is skipped,
 * never refused: a host that renders with an older release takes a newer
 * document and draws it wrong without a word (a caption anchored to a step
 * plays at its fallback start; a clip with a loudness target plays at its
 * trim). A tool that hands a document to such a host reads this table
 * against the host's release and says so before anything is sent.
 *
 * Each entry finds its feature in a document (`uses`, how many places) and,
 * where the feature can be said in what an older renderer reads, BAKES it
 * (`bake`): the document as it plays, the feature resolved into the fields
 * it stood for. Baking is lossy on purpose (an anchored caption keeps the
 * time it resolves to in THIS cut and stops following its step), so it is
 * for a copy that is sent, never for the document on disk.
 *
 * Pure: no I/O, the input never mutated.
 */
import {
  hasElapsed,
  resolveAnchor,
  resolveOverlayAnchors,
} from './lower/anchor'
import { clipGain } from './lower/loudness'
import { ratedSegments } from './lower/lowerToComposition'
import { migrateMotion } from './lower/motion'
import { isRecordingDoc } from './doc/studioDoc'
import type { StudioDoc } from './doc/studioDoc'
import type { AudioClip, OverlayClip } from './types'

export interface DocFeature {
  /** A stable name for the feature. */
  id: string
  /** The release of `@vosjs/studio-core` that first renders it. */
  since: string
  /** What it is, in words, as a list of things: `caption anchors`. */
  name: string
  /** What a renderer before `since` does with them, in words. */
  before: string
  /** How many places in the document use it (0 = not used). */
  uses: (doc: StudioDoc) => number
  /**
   * The document with the feature said in what a renderer before `since`
   * reads, and anything that changed how it plays. Absent: it cannot be.
   */
  bake?: (doc: StudioDoc) => { doc: StudioDoc; notes: string[] }
}

const overlaysOf = (doc: StudioDoc): OverlayClip[] =>
  Array.isArray(doc.overlays) ? doc.overlays : []

const audioOf = (doc: StudioDoc): AudioClip[] =>
  Array.isArray(doc.audio) ? doc.audio : []

const anchored = (o: OverlayClip | null | undefined): boolean =>
  !!o && !!o.anchor && typeof o.anchor === 'object'

/** Every anchored layer at the time it plays in this cut, its anchor dropped. */
function bakeAnchors(doc: StudioDoc): { doc: StudioDoc; notes: string[] } {
  const layers = overlaysOf(doc)
  if (!layers.some(anchored)) return { doc, notes: [] }
  const notes: string[] = []
  // Resolved as the lowering resolves them: against the rated pieces of
  // the document as the lowering reads it. A program has no steps, so its
  // anchors play at their fallback start in every release.
  let resolved = doc
  if (isRecordingDoc(doc)) {
    const rated = ratedSegments(migrateMotion(doc))
    resolved = resolveOverlayAnchors(doc, rated)
    for (const o of layers) {
      if (!anchored(o) || !o.anchor) continue
      const r = resolveAnchor(doc, o.anchor, rated)
      if (r.start === null)
        notes.push(
          `overlay ${o.id}: its step ${r.miss === 'cut' ? 'is cut out of the film' : r.miss === 'skipped' ? 'was skipped by the recorder' : 'is not in the take'}, so it plays at its fallback start (${o.start.toFixed(2)}s)`,
        )
    }
  }
  const overlays = overlaysOf(resolved).map((o) => {
    if (!anchored(o)) return o
    const { anchor: _anchor, ...rest } = o
    return rest as OverlayClip
  })
  return { doc: { ...resolved, overlays }, notes }
}

export const DOC_FEATURES: readonly DocFeature[] = [
  {
    id: 'text-runs',
    since: '0.38.0',
    name: 'styled text runs',
    before: 'would draw those layers without their words',
    uses: (doc) =>
      overlaysOf(doc).filter((o) => o?.kind === 'text' && Array.isArray(o.text))
        .length,
  },
  {
    id: 'overlay-anchor',
    since: '0.43.0',
    name: 'caption anchors',
    before: 'would show them at their fallback start',
    uses: (doc) => overlaysOf(doc).filter(anchored).length,
    bake: bakeAnchors,
  },
  {
    id: 'text-elapsed',
    since: '0.43.0',
    name: '{elapsed} in text',
    before: 'would show the placeholder as it is written',
    // Filled only on an anchored layer: anywhere else every release shows
    // the placeholder as written.
    uses: (doc) =>
      overlaysOf(doc).filter(
        (o) => anchored(o) && o.kind === 'text' && hasElapsed(o.text),
      ).length,
    // The anchors' bake fills it.
    bake: bakeAnchors,
  },
  {
    id: 'audio-normalize',
    since: '0.44.0',
    name: 'loudness targets on sound',
    before: 'would play those clips at their gain alone',
    // Only a target that applies: one with no measurement for its key is
    // ignored by every release alike.
    uses: (doc) =>
      audioOf(doc).filter((a) => a && clipGain(a).basis === 'normalize').length,
    bake: (doc) => {
      const notes: string[] = []
      const audio = audioOf(doc).map((a) => {
        if (!a || a.normalize === undefined) return a
        const { normalize: _normalize, ...rest } = a
        const g = clipGain(a)
        if (g.basis !== 'normalize') return rest
        const gain = Math.round(Math.min(1, g.gain) * 1000) / 1000
        if (g.gain > 1)
          notes.push(
            `audio ${a.id}: its target asks for gain ${g.gain.toFixed(2)}, which an older renderer cannot play; baked at 1, so it plays ${(20 * Math.log10(g.gain)).toFixed(1)} dB quieter than asked`,
          )
        return { ...rest, gain }
      })
      return { doc: { ...doc, audio } as StudioDoc, notes }
    },
  },
]

/** `a` against `b` as releases (`x.y.z`; a pre-release tag is ignored): -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

/** A feature a document uses, and how many places use it. */
export interface UsedFeature {
  feature: DocFeature
  count: number
}

/** The features the document uses, in table order. */
export function docFeatures(doc: StudioDoc): UsedFeature[] {
  const out: UsedFeature[] = []
  for (const feature of DOC_FEATURES) {
    const count = feature.uses(doc)
    if (count > 0) out.push({ feature, count })
  }
  return out
}

/** The features the document uses that a renderer at `version` does not read. */
export function featuresNewerThan(
  doc: StudioDoc,
  version: string,
): UsedFeature[] {
  return docFeatures(doc).filter(
    (u) => compareVersions(u.feature.since, version) > 0,
  )
}

export interface BakeResult {
  doc: StudioDoc
  /** The features baked. */
  baked: DocFeature[]
  /** The features newer than the renderer that cannot be baked. */
  unbakeable: DocFeature[]
  /** What changed in how the document plays, in words. */
  notes: string[]
}

/**
 * The document as a renderer at `version` reads it: every newer feature it
 * uses baked into the fields it stood for. A copy; the input is untouched.
 */
export function bakeDocFeatures(doc: StudioDoc, version: string): BakeResult {
  let next: StudioDoc = structuredClone(doc)
  const baked: DocFeature[] = []
  const unbakeable: DocFeature[] = []
  const notes: string[] = []
  const done = new Set<DocFeature['bake']>()
  for (const { feature } of featuresNewerThan(doc, version)) {
    if (!feature.bake) {
      unbakeable.push(feature)
      continue
    }
    baked.push(feature)
    // Two features can share one bake (an anchor fills its `{elapsed}`).
    if (done.has(feature.bake)) continue
    done.add(feature.bake)
    const r = feature.bake(next)
    next = r.doc
    notes.push(...r.notes)
  }
  return { doc: next, baked, unbakeable, notes }
}
