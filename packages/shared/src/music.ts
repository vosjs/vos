/**
 * Which music bed fits a film: one pure ranking over a hosted music
 * catalog (the shape `GET /api/music` answers at version 2) and a FILM
 * SUMMARY (its length, its payoff, the instants a beat should land on,
 * whether a voice plays, what was asked). Every track comes back scored,
 * with the placement it implies and reasons in words; a refused track
 * keeps its reason, so a pick can say why the obvious one was not chosen.
 *
 * Hard rules first (it covers the film or loops, its intro is not still
 * quiet on frame one, no sung lead under a voice), then preferences (a
 * swell on the payoff, cuts on the beat, the asked mood or words, a calm
 * bed under a voice, an ending that meets the film's). Deterministic: ties
 * fall to a stable hash of the film's seed and the slug, so two films
 * asking the same thing get different beds and one film always gets the
 * same answer. No I/O, no document: the caller builds the summary.
 */

export type BedVocals = 'none' | 'chops' | 'lead'
export type BedEnding = 'fade' | 'hard' | 'ring'
export type BeatConfidence = 'high' | 'low' | 'confirmed'

/** A catalog track as the ranking reads it: the wire's fields, nothing of a host's. */
export interface BedTrack {
  slug: string
  title: string
  artist?: string
  /** The genre's slug. */
  mood?: string
  /** Seconds. */
  duration: number
  url: string
  swells?: { from: number; at: number; peakAt: number; riseDb: number }[]
  bpm?: number | null
  beat?: { first: number; period: number; error: number } | null
  beatConfidence?: BeatConfidence | null
  /** The tracked beats, seconds; on the per-track read only. */
  beats?: number[] | null
  intro?: number | null
  seam?: number | null
  ending?: BedEnding | null
  sections?: { at: number; level: number }[] | null
  busyness?: number | null
  vocals?: BedVocals
  tags?: string[]
  description?: string | null
  loops?: boolean
  removedAt?: string | null
}

/** What a film is, as the ranking needs it; built by whoever holds the film. */
export interface FilmSummary {
  /** Output seconds. */
  duration: number
  /** The moment the music should open up, output seconds. */
  payoff?: number
  /** Output instants a beat should land on. */
  cuts: number[]
  /** A voice plays: a mic track, a voiceover clip. */
  voice: boolean
  /** Asked: a genre slug or a tag. */
  mood?: string
  /** Asked: free words, matched to descriptions and tags. */
  words?: string
  /** Stable identity: the vos id, else the take directory's name. */
  seed: string
  /** Beds the film's project already uses: a small nudge towards them. */
  like?: string[]
  /** The film fades in, so a quiet intro under its first frame is no fault. */
  fadeIn?: boolean
}

/** Where the track starts under the film, and how it fills it. */
export interface BedPlacement {
  /** Track seconds the clip starts at. */
  in: number
  /** Track seconds the clip ends at (the whole film, or the looped span). */
  out: number
  loop: boolean
  /** Output seconds the loop fills. */
  loopLen?: number
  /** Output seconds the landed swell arrives at, when one does. */
  swellAt: number | null
  /** The swell's rise in dB, when one landed. */
  riseDb: number | null
}

export interface BedScores {
  payoff: number
  beat: number
  fit: number
  bed: number
  shape: number
}

export interface RankedBed {
  slug: string
  track: BedTrack
  /** 0..1, or null when refused. */
  score: number | null
  /** Why it is out, in words; null when ranked. */
  refused: string | null
  placement: BedPlacement | null
  scores: BedScores | null
  /** Short and checkable, one per score that moved the result. */
  reasons: string[]
}

/** The weights, the starting point; to be fitted on a labelled set of films. */
export const BED_WEIGHTS: BedScores = {
  payoff: 0.3,
  beat: 0.25,
  fit: 0.2,
  bed: 0.15,
  shape: 0.1,
}

/** Tracks this close to the best are one answer, ordered by the seed. */
export const TIE_WINDOW = 0.03
/** What a bed the project already uses gains. */
export const LIKE_NUDGE = 0.05
/** A quiet intro longer than this must not sit under a film's first frame. */
export const QUIET_INTRO = 1.5
/** A swell this strong scores a full payoff. */
const RISE_FULL_DB = 9
/** A cut within this of a beat, as a fraction of the period, is on it. */
const ON_BEAT = 0.1
/** Beats a bar: a loop is a whole number of them. */
const BEATS_PER_BAR = 4

const r3 = (v: number) => Math.round(v * 1000) / 1000
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** The beat nearest `t` in the track: the list when there is one, else the grid. */
export function nearestBeat(
  t: number,
  beat: { first: number; period: number },
  beats?: number[] | null,
): number {
  if (beats && beats.length) {
    let best = beats[0]
    for (const b of beats) if (Math.abs(b - t) < Math.abs(best - t)) best = b
    return best
  }
  const k = Math.max(0, Math.round((t - beat.first) / beat.period))
  return beat.first + k * beat.period
}

/** FNV-1a over a string, for a stable order nobody can read a preference into. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

const mmss = (s: number) => {
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** The words of an ask, lower-cased, letters and digits only, no empties. */
export function askWords(s: string | undefined): string[] {
  if (!s) return []
  return s
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .map((w) => w.replace(/^-+|-+$/g, ''))
    .filter((w) => w.length > 1)
}

/**
 * Where the track starts under the film: with a payoff, the strongest
 * swell that can land on it, snapped to the nearest beat; without one, past
 * the quiet intro, on a beat. Then it must cover the film, or loop. Null
 * when it cannot cover, with the reason.
 */
export function placeBed(
  track: BedTrack,
  film: FilmSummary,
): { placement: BedPlacement; notes: string[] } | { refused: string } {
  const notes: string[] = []
  const intro = track.intro ?? 0
  const beat = track.beat ?? null
  const beats = track.beats ?? null
  let start: number | null = null
  let swellAt: number | null = null
  let riseDb: number | null = null
  if (film.payoff !== undefined && film.payoff >= 0) {
    const swells = [...(track.swells ?? [])]
      .filter((s) => s.at >= film.payoff!)
      .sort((a, b) => b.riseDb - a.riseDb)
    const swell = swells[0]
    if (swell) {
      start = swell.at - film.payoff
      if (beat) {
        const landed = nearestBeat(swell.at, beat, beats)
        if (Math.abs(landed - swell.at) <= beat.period / 2) {
          start = Math.max(0, landed - film.payoff)
        }
      }
      swellAt = film.payoff
      riseDb = swell.riseDb
    } else {
      notes.push('no swell can land on the payoff')
    }
  }
  if (start === null) {
    start = intro
    if (beat) {
      const b = nearestBeat(start, beat, beats)
      start = b >= 0 ? b : start
    }
  }
  start = r3(Math.max(0, start))
  const room = track.duration - start
  if (room >= film.duration) {
    return {
      placement: {
        in: start,
        out: r3(start + film.duration),
        loop: false,
        swellAt,
        riseDb,
      },
      notes,
    }
  }
  if (track.loops) {
    // A whole number of bars from the start, inside the track; a short
    // tail is not a loop.
    const bar = beat ? beat.period * BEATS_PER_BAR : 0
    const span = bar > 0 ? Math.floor(room / bar) * bar : room
    if (span >= Math.min(8, room)) {
      return {
        placement: {
          in: start,
          out: r3(start + span),
          loop: true,
          loopLen: r3(film.duration),
          swellAt,
          riseDb,
        },
        notes,
      }
    }
  }
  return {
    refused: `ends at ${mmss(track.duration)}, ${Math.round(film.duration - room)} s before the film; does not loop`,
  }
}

/** The payoff score: the landed swell's rise against a full one. */
function payoffScore(p: BedPlacement): number {
  return p.riseDb === null ? 0 : clamp01(p.riseDb / RISE_FULL_DB)
}

/** The beat score and its words, or the neutral score with why. */
function beatScore(
  track: BedTrack,
  film: FilmSummary,
  p: BedPlacement,
): { score: number; words: string | null } {
  const beat = track.beat ?? null
  if (
    !beat ||
    track.beatConfidence === null ||
    track.beatConfidence === undefined
  ) {
    return { score: 0.5, words: 'beat not measured, not scored' }
  }
  if (track.beatConfidence === 'low') {
    return { score: 0.5, words: 'tempo uncertain, beat not scored' }
  }
  if (!film.cuts.length) return { score: 0.5, words: null }
  let total = 0
  let on = 0
  for (const cut of film.cuts) {
    const t = p.in + cut
    const d = Math.abs(nearestBeat(t, beat, track.beats) - t) / beat.period
    const frac = Math.min(0.5, d)
    total += frac
    if (frac <= ON_BEAT) on++
  }
  const mean = total / film.cuts.length
  return {
    score: clamp01(1 - 2 * mean),
    words: `${on} of ${film.cuts.length} cuts within a tenth of a beat`,
  }
}

/** The fit score: the asked genre or tag, else the asked words, else neutral. */
function fitScore(
  track: BedTrack,
  film: FilmSummary,
): { score: number; words: string | null } {
  const mood = film.mood?.trim().toLowerCase()
  const tags = (track.tags ?? []).map((t) => t.toLowerCase())
  if (mood) {
    if ((track.mood ?? '').toLowerCase() === mood) {
      return { score: 1, words: `${mood}, as asked` }
    }
    if (tags.includes(mood)) return { score: 1, words: `tagged ${mood}` }
  }
  const words = askWords(film.words)
  if (words.length) {
    const haystack = new Set([
      ...tags,
      ...askWords(track.description ?? ''),
      ...askWords(track.title),
      (track.mood ?? '').toLowerCase(),
    ])
    const hit = words.filter((w) => haystack.has(w))
    return {
      score: hit.length / words.length,
      words: hit.length
        ? `matches ${hit.join(', ')}`
        : `none of ${words.join(', ')} in its words`,
    }
  }
  if (mood) return { score: 0, words: `not ${mood}` }
  return { score: 0.5, words: null }
}

/** The bed score: under a voice, calm wins; chops cost. */
function bedScore(
  track: BedTrack,
  film: FilmSummary,
): { score: number; words: string | null } {
  if (!film.voice) return { score: 0.5, words: null }
  const busy = track.busyness ?? 0.5
  const score = clamp01(1 - busy - (track.vocals === 'chops' ? 0.3 : 0))
  return {
    score,
    words:
      score >= 0.6
        ? 'calm under your voice'
        : score <= 0.3
          ? 'busy under a voice'
          : null,
  }
}

/** The shape score: the film's end meets the track well, else a fade is planned. */
function shapeScore(
  track: BedTrack,
  p: BedPlacement,
): { score: number; words: string | null } {
  if (p.loop) return { score: 0.5, words: 'loops cleanly' }
  const end = p.out
  const period = track.beat?.period ?? 0.5
  if (
    Math.abs(track.duration - end) <= 1 &&
    (track.ending === 'fade' || track.ending === 'ring')
  ) {
    return { score: 1, words: `ends with the film (${track.ending})` }
  }
  const boundary = (track.sections ?? []).find(
    (s) => s.at > p.in && Math.abs(s.at - end) <= period,
  )
  if (boundary) {
    return { score: 1, words: `a section ends at ${mmss(end)}` }
  }
  return { score: 0.4, words: null }
}

/** Every live track scored against the film, best first. */
export function rankBeds(catalog: BedTrack[], film: FilmSummary): RankedBed[] {
  const like = new Set((film.like ?? []).map((s) => s.toLowerCase()))
  const ranked: RankedBed[] = []
  for (const track of catalog) {
    if (track.removedAt) continue
    const reasons: string[] = []
    const placed = placeBed(track, film)
    if ('refused' in placed) {
      ranked.push({
        slug: track.slug,
        track,
        score: null,
        refused: placed.refused,
        placement: null,
        scores: null,
        reasons,
      })
      continue
    }
    const { placement, notes } = placed
    const intro = track.intro ?? 0
    let refused: string | null = null
    if (!film.fadeIn && intro > QUIET_INTRO && placement.in < intro - 0.25) {
      refused = `starts ${Math.round(intro - placement.in)} s into a quiet intro`
    } else if (film.voice && track.vocals === 'lead') {
      refused = 'has a sung lead; your film has a voice'
    }
    if (refused) {
      ranked.push({
        slug: track.slug,
        track,
        score: null,
        refused,
        placement,
        scores: null,
        reasons,
      })
      continue
    }
    const payoff = payoffScore(placement)
    const beat = beatScore(track, film, placement)
    const fit = fitScore(track, film)
    const bed = bedScore(track, film)
    const shape = shapeScore(track, placement)
    const scores: BedScores = {
      payoff,
      beat: beat.score,
      fit: fit.score,
      bed: bed.score,
      shape: shape.score,
    }
    let score =
      BED_WEIGHTS.payoff * scores.payoff +
      BED_WEIGHTS.beat * scores.beat +
      BED_WEIGHTS.fit * scores.fit +
      BED_WEIGHTS.bed * scores.bed +
      BED_WEIGHTS.shape * scores.shape
    if (placement.swellAt !== null) {
      reasons.push(
        `swell lands on ${mmss(placement.swellAt)} (+${(placement.riseDb ?? 0).toFixed(1)} dB)`,
      )
    } else if (film.payoff !== undefined) {
      reasons.push(...notes)
    }
    if (beat.words) reasons.push(beat.words)
    if (fit.words) reasons.push(fit.words)
    if (bed.words) reasons.push(bed.words)
    if (shape.words) reasons.push(shape.words)
    if (like.has(track.slug.toLowerCase())) {
      score += LIKE_NUDGE
      reasons.push('the project already uses it')
    }
    ranked.push({
      slug: track.slug,
      track,
      score: r3(clamp01(score)),
      refused: null,
      placement,
      scores,
      reasons,
    })
  }
  const live = ranked
    .filter((r) => r.score !== null)
    .sort((a, b) => b.score! - a.score! || a.slug.localeCompare(b.slug))
  // The top cluster is one answer: the seed decides its order.
  if (live.length > 1) {
    const top = live[0].score!
    const cluster = live.filter((r) => top - r.score! <= TIE_WINDOW)
    cluster.sort(
      (a, b) =>
        stableHash(`${film.seed}:${a.slug}`) -
        stableHash(`${film.seed}:${b.slug}`),
    )
    live.splice(0, cluster.length, ...cluster)
  }
  const out = ranked
    .filter((r) => r.score === null)
    .sort((a, b) => a.slug.localeCompare(b.slug))
  return [...live, ...out]
}

/** The top `n` ranked beds (never a refused one). */
export function pickBeds(
  catalog: BedTrack[],
  film: FilmSummary,
  n = 3,
): RankedBed[] {
  return rankBeds(catalog, film)
    .filter((r) => r.score !== null)
    .slice(0, n)
}

/** The library's slugs the words of an ask name exactly, so a slug stays a slug. */
export function trackBySlug(
  catalog: BedTrack[],
  ask: string | undefined,
): BedTrack | null {
  const want = ask?.trim().toLowerCase()
  if (!want) return null
  return (
    catalog.find((t) => t.slug.toLowerCase() === want && !t.removedAt) ?? null
  )
}
