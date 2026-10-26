/**
 * A film as the music ranking reads it: its output length, the
 * instants a beat should land on, the moment the music should open up,
 * whether a voice plays. Built from the document here, where the document
 * is known, and handed to `@vosjs/shared/music`'s `rankBeds`, which never
 * reads one; the CLI's `vos music pick` and the studio's Sound panel read
 * the same summary, so one rule says what a cut is.
 *
 * A recording's cuts are its layers' starts (a caption landed on a step,
 * a callout), its segment boundaries (a join, a page change, a freeze) and
 * the page changes the recorder marked; its payoff is the last step the
 * script marks `"zoom": true`, else the last cut. A program's cuts are its
 * scene labels (`tl.addLabel`), its payoff the last scene. Pure.
 */
import type { FilmSummary } from '@vosjs/shared/music'
import { docOutputDuration, voiceKey } from './audioBeds'
import { isRecordingDoc } from './doc/studioDoc'
import { layerStart, resolveAnchor, sourceMomentToOutput } from './lower/anchor'
import { ratedSegments } from './lower/lowerToComposition'
import { docMediaList } from './media'
import type { StudioDoc } from './doc/studioDoc'
import type { ProjectDoc } from './types'

export type { FilmSummary }

export interface FilmSummaryOptions {
  /** Stable identity: the vos id, else the take directory's name. */
  seed: string
  /** The payoff, output seconds, when the person said it (`--at`). */
  payoff?: number
  /** Override what the document says about a voice. */
  voice?: boolean
  mood?: string
  words?: string
  like?: string[]
  fadeIn?: boolean
}

/** Two instants this close are one cut. */
const CUT_MERGE = 0.25

const r3 = (v: number) => Math.round(v * 1000) / 1000

/** A hosted library track's address, or a built-in effect's: not a voice. */
const isMusicOrEffect = (key: string): boolean =>
  /\/music\/[^/?#]+\.mp3(?:[?#]|$)/.test(key) || /\/audio-sfx\//.test(key)

/** The scene labels a program declares, output seconds, in order. */
export function programSceneTimes(config: Record<string, unknown>): number[] {
  const code = JSON.stringify(config)
  const times = new Set<number>()
  // Through JSON the function strings keep their quotes escaped: \" inside
  // the string is a quote, so the label's name is one of ', `, or \".
  for (const m of code.matchAll(
    /addLabel\(\s*(?:\\"|['`])[^'`"\\]*(?:\\"|['`])\s*,\s*([\d.]+)/g,
  )) {
    const t = Number(m[1])
    if (Number.isFinite(t) && t > 0) times.add(r3(t))
  }
  return [...times].sort((a, b) => a - b)
}

/** The steps the embedded script marks `"zoom": true`, by id or index. */
function markedSteps(source: ProjectDoc['source']): (string | number)[] {
  const steps = (source.script as { steps?: unknown } | undefined)?.steps
  if (!Array.isArray(steps)) return []
  const out: (string | number)[] = []
  steps.forEach((s, i) => {
    if (!s || typeof s !== 'object') return
    const step = s as { zoom?: unknown; id?: unknown }
    if (step.zoom === true) out.push(typeof step.id === 'string' ? step.id : i)
  })
  return out
}

/** Sorted, merged, inside (0, duration). */
function tidy(cuts: number[], duration: number): number[] {
  const sorted = cuts
    .filter((t) => Number.isFinite(t) && t > CUT_MERGE && t < duration - 0.05)
    .map(r3)
    .sort((a, b) => a - b)
  const out: number[] = []
  for (const t of sorted) {
    if (!out.length || t - out[out.length - 1] > CUT_MERGE) out.push(t)
  }
  return out
}

/**
 * The film summary of a document. `seed` is the caller's (a vos id when
 * the take is on vos.so, else its directory's name).
 */
export function filmSummaryOf(
  doc: StudioDoc,
  opts: FilmSummaryOptions,
): FilmSummary {
  const duration = r3(docOutputDuration(doc))
  const cuts: number[] = []
  let payoff: number | undefined = opts.payoff
  let voice = opts.voice ?? false
  if (isRecordingDoc(doc)) {
    const rated = ratedSegments(doc)
    // Segment boundaries: where one kept piece ends and the next starts.
    let t = 0
    for (const s of rated) {
      const rate = s.rate && s.rate > 0 ? s.rate : 1
      t += (s.out - s.in) / rate
      cuts.push(t)
    }
    // Every layer's start, an anchored one where its step plays.
    for (const clip of doc.overlays ?? []) {
      const start = layerStart(clip, doc, rated)
      if (start !== null) cuts.push(start)
    }
    // The page changes the recorder marked, and the steps the script marks
    // as a beat's payoff.
    let lastMarked: number | null = null
    for (const { id, source } of docMediaList(doc)) {
      for (const step of source.meta.steps ?? []) {
        if (step.navigated && typeof step.tEnd === 'number') {
          const out = sourceMomentToOutput(rated, step.tEnd, id || undefined)
          if (out !== null) cuts.push(out)
        }
      }
      for (const step of markedSteps(source)) {
        const r = resolveAnchor(
          doc,
          { step, ...(id ? { media: id } : {}) },
          rated,
        )
        if (r.start !== null) {
          cuts.push(r.start)
          if (lastMarked === null || r.start > lastMarked) lastMarked = r.start
        }
      }
    }
    if (payoff === undefined && lastMarked !== null) payoff = lastMarked
    if (opts.voice === undefined) {
      voice =
        voiceKey(doc) !== null ||
        (doc.audio ?? []).some((a) => !isMusicOrEffect(a.key))
    }
  } else {
    const scenes = programSceneTimes(doc.program.config)
    cuts.push(...scenes)
    if (payoff === undefined && scenes.length)
      payoff = scenes[scenes.length - 1]
    if (opts.voice === undefined) {
      voice = (doc.audio ?? []).some((a) => !isMusicOrEffect(a.key))
    }
  }
  const tidied = tidy(cuts, duration)
  if (payoff === undefined && tidied.length) payoff = tidied[tidied.length - 1]
  if (payoff !== undefined && !(payoff > 0 && payoff < duration)) {
    payoff = undefined
  }
  return {
    duration,
    ...(payoff !== undefined ? { payoff: r3(payoff) } : {}),
    cuts: tidied,
    voice,
    ...(opts.mood ? { mood: opts.mood } : {}),
    ...(opts.words ? { words: opts.words } : {}),
    seed: opts.seed,
    ...(opts.like?.length ? { like: opts.like } : {}),
    ...(opts.fadeIn ? { fadeIn: true } : {}),
  }
}

/** The library slugs a document's audio clips play, for a project's `like`. */
export function musicSlugsOfDoc(doc: Pick<StudioDoc, 'audio'>): string[] {
  const out = new Set<string>()
  for (const a of doc.audio ?? []) {
    const m = /\/music\/([a-z0-9][a-z0-9-]*)\.mp3(?:[?#]|$)/.exec(a.key)
    if (m) out.add(m[1])
  }
  return [...out].sort()
}
