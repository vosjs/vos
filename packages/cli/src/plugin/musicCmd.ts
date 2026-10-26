/**
 * `vos music ls` and `vos music pick`: the library read as a list an
 * agent can filter, and the ranking of every track against THIS film.
 *
 *   vos music ls [--mood <slug>] [--vocals none|chops|lead] [--loops]
 *                [--bpm 90-120] [--min-length <s>] [--q <words>] [--json]
 *   vos music pick <take|config.json> [--at <step id|seconds>] [--mood <slug|tag>]
 *                [--words "…"] [--voice|--no-voice] [--like <vos id|slug>]...
 *                [--top 3] [--json]
 *
 * `pick` builds the film's summary from the take's doc.json (or a
 * program's config.json): its length, its cuts (layers, joins, page
 * changes, zoom marks), its payoff, whether a voice plays, and hands it
 * with the catalog to `rankBeds` (`@vosjs/shared/music`, pure). The top
 * picks come back with reasons and the exact `vos score` line that places
 * each; `--json` carries every track, the refused ones with their reason.
 * When nothing fits it says so and points to composing a score.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { rankBeds, trackBySlug } from '@vosjs/shared/music'
import { filmSummaryOf, musicSlugsOfDoc } from '@vosjs/studio-core'
import { UsageError, numFlag, parseArgs, strFlag } from './args'
import { fetchMusicCatalog } from './music'
import { EXIT_OK, createReporter } from './output'
import { parseVosId, platformOrigin, readSyncState } from './platform'
import { resolveAt } from './score'
import { loadTake } from './take'
import type { BedTrack, FilmSummary, RankedBed } from '@vosjs/shared/music'
import type { ProgramAnchorDoc, StudioDoc } from '@vosjs/studio-core'

const BOOLEAN_FLAGS = new Set([
  'json',
  'help',
  'loops',
  'voice',
  'no-voice',
  'fade-in',
])
const MULTI_FLAGS = new Set(['like'])

const USAGE =
  'vos music ls [--mood <slug>] [--vocals none|chops|lead] [--loops] [--bpm <lo>-<hi>] [--min-length <s>] [--q <words>] [--json]\n' +
  'vos music pick <take|config.json> [--at <step id|seconds>] [--mood <slug|tag>] [--words "…"] [--voice|--no-voice] [--like <vos id|slug>]... [--top <n>] [--json]'

const mmss = (s: number) => {
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const VOCAL_WORDS: Record<string, string> = {
  none: 'no vocals',
  chops: 'vocal chops',
  lead: 'sung lead',
}

/** One line of the list: what an agent reads to choose without listening. */
export function trackLine(t: BedTrack): string {
  const bpm =
    t.bpm === null || t.bpm === undefined
      ? '—'
      : `${t.bpm} bpm${t.beatConfidence === 'low' ? '?' : t.beatConfidence === 'confirmed' ? '' : ''}`
  return [
    t.slug.padEnd(26),
    (t.mood ?? '').padEnd(10),
    mmss(t.duration).padStart(5),
    bpm.padStart(10),
    VOCAL_WORDS[t.vocals ?? 'none'].padEnd(11),
    t.loops ? 'loops' : '     ',
    t.description ? JSON.stringify(t.description) : '',
  ].join('  ')
}

/** `--bpm 90-120`: both ends, or one number as a floor. */
export function bpmRange(raw: string | undefined): [number, number] | null {
  if (!raw) return null
  const m = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(raw.trim())
  if (m) return [Number(m[1]), Number(m[2])]
  const one = Number(raw)
  if (Number.isFinite(one)) return [one, Infinity]
  throw new UsageError(`--bpm expects <lo>-<hi>, got "${raw}"`)
}

/** The tracks `ls` keeps, by its flags. */
export function filterTracks(
  tracks: BedTrack[],
  f: {
    mood?: string
    vocals?: string
    loops?: boolean
    bpm?: [number, number] | null
    minLength?: number
    q?: string
  },
): BedTrack[] {
  const q = f.q?.toLowerCase().trim()
  const words = q ? q.split(/\s+/).filter(Boolean) : []
  return tracks.filter((t) => {
    if (t.removedAt) return false
    if (f.mood && (t.mood ?? '').toLowerCase() !== f.mood.toLowerCase()) {
      if (
        !(t.tags ?? []).some((x) => x.toLowerCase() === f.mood!.toLowerCase())
      )
        return false
    }
    if (f.vocals && (t.vocals ?? 'none') !== f.vocals) return false
    if (f.loops && !t.loops) return false
    if (f.bpm) {
      if (t.bpm === null || t.bpm === undefined) return false
      if (t.bpm < f.bpm[0] || t.bpm > f.bpm[1]) return false
    }
    if (f.minLength !== undefined && t.duration < f.minLength && !t.loops)
      return false
    if (words.length) {
      const hay = [
        t.slug,
        t.title,
        t.artist ?? '',
        t.mood ?? '',
        ...(t.tags ?? []),
        t.description ?? '',
      ]
        .join(' ')
        .toLowerCase()
      if (!words.every((w) => hay.includes(w))) return false
    }
    return true
  })
}

/** The document a path names: a take's doc.json, or a program's config.json. */
export async function loadFilm(
  ref: string,
): Promise<{ doc: StudioDoc; seed: string; dir: string | null }> {
  const path = resolve(ref)
  if (!existsSync(path)) throw new UsageError(`${ref}: no such take or file`)
  if (statSync(path).isDirectory()) {
    const take = await loadTake(path)
    if (!take.doc)
      throw new UsageError(`${ref} has no doc.json; run vos plan first`)
    const sync = readSyncState(path)
    return { doc: take.doc, seed: sync?.vosId ?? basename(path), dir: path }
  }
  let config: Record<string, unknown>
  try {
    config = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    throw new UsageError(`${ref}: not a take directory or a JSON config`)
  }
  if (!config || typeof config !== 'object' || !('version' in config))
    throw new UsageError(`${ref}: a program's config.json carries a version`)
  const doc = {
    program: { config },
    audio: [],
    overlays: [],
    objects: [],
  } as unknown as ProgramAnchorDoc
  return { doc, seed: basename(path, '.json'), dir: null }
}

/** The beds a `--like` names: a vos id's head document, or a slug as it is. */
async function likedSlugs(
  refs: string[],
  origin: string,
): Promise<{ slugs: string[]; notes: string[] }> {
  const slugs = new Set<string>()
  const notes: string[] = []
  for (const ref of refs) {
    const id = parseVosId(ref)
    if (!id) {
      slugs.add(ref.toLowerCase())
      continue
    }
    try {
      const vos = (await (await fetch(`${origin}/api/vos/${id}`)).json()) as {
        currentVersionId?: string
      }
      if (!vos.currentVersionId) throw new Error('no version')
      const doc = (await (
        await fetch(
          `${origin}/api/vos/${id}/versions/${vos.currentVersionId}/doc`,
        )
      ).json()) as StudioDoc
      for (const s of musicSlugsOfDoc(doc)) slugs.add(s)
    } catch {
      notes.push(
        `--like ${ref}: could not read that vos's document (is it public?)`,
      )
    }
  }
  return { slugs: [...slugs], notes }
}

/** The `vos score` line that places a ranked bed under a film. */
export function scoreLine(
  take: string | null,
  r: RankedBed,
  film: FilmSummary,
): string {
  const at = r.placement?.swellAt ?? film.payoff
  return `vos score ${take ?? '<take>'} --track ${r.slug}${at !== undefined && at !== null ? ` --at ${at}` : ''}`
}

/** The pick as a person reads it. */
export function pickWords(
  picks: RankedBed[],
  all: RankedBed[],
  film: FilmSummary,
  take: string | null,
): string {
  const refused = all.filter((r) => r.score === null)
  const head = `${film.duration.toFixed(1)}s film, ${film.cuts.length} cut${film.cuts.length === 1 ? '' : 's'}${film.payoff !== undefined ? `, payoff at ${mmss(film.payoff)}` : ''}${film.voice ? ', a voice' : ''}${film.mood ? `, asked ${film.mood}` : ''}${film.words ? `, asked "${film.words}"` : ''}`
  if (!picks.length) {
    return `${head}\n  No bed in the library fits: ${refused.length} refused (${[...new Set(refused.map((r) => r.refused))].slice(0, 3).join('; ')}). Compose a score instead (the vos-score skill), or ask with --words.`
  }
  const lines = picks.map((r, i) => {
    const t = r.track
    const facts = [
      t.mood,
      t.bpm !== null && t.bpm !== undefined
        ? `${t.bpm} bpm${t.beatConfidence === 'low' ? '?' : ''}`
        : null,
      VOCAL_WORDS[t.vocals ?? 'none'],
      t.loops ? 'loops' : null,
    ]
      .filter(Boolean)
      .join(', ')
    return `  ${i + 1}. ${r.slug}  ${t.title}  ${(r.score ?? 0).toFixed(2)}  (${facts})\n     ${r.reasons.join('; ') || 'fits'}\n     ${scoreLine(take, r, film)}`
  })
  const tail = refused.length
    ? `\n  ${refused.length} refused: ${refused
        .slice(0, 4)
        .map((r) => `${r.slug} (${r.refused})`)
        .join('; ')}${refused.length > 4 ? '; …' : ''}`
    : ''
  return `${head}\n${lines.join('\n')}${tail}`
}

export async function cmdMusic(argv: string[]): Promise<number> {
  const { positionals, flags, multi } = parseArgs(
    argv,
    BOOLEAN_FLAGS,
    MULTI_FLAGS,
  )
  const verb = positionals[0]
  if (flags.help === true || !verb || !['ls', 'pick'].includes(verb))
    throw new UsageError(USAGE)
  const r = createReporter(flags.json === true)
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const catalog = await fetchMusicCatalog(origin)

  if (verb === 'ls') {
    const vocals = strFlag(flags, 'vocals')
    if (vocals && !['none', 'chops', 'lead'].includes(vocals))
      throw new UsageError('--vocals expects none, chops or lead')
    const kept = filterTracks(catalog.tracks, {
      mood: strFlag(flags, 'mood'),
      vocals,
      loops: flags.loops === true,
      bpm: bpmRange(strFlag(flags, 'bpm')),
      minLength:
        strFlag(flags, 'min-length') !== undefined
          ? numFlag(flags, 'min-length', 0)
          : undefined,
      q: strFlag(flags, 'q'),
    })
    r.done(
      { origin, tracks: kept, total: catalog.tracks.length },
      kept.length
        ? kept.map(trackLine).join('\n')
        : `No track matches; the library holds ${catalog.tracks.length} (GET ${origin}/api/music).`,
    )
    return EXIT_OK
  }

  const ref = positionals[1]
  if (!ref) throw new UsageError(USAGE)
  const { doc, seed, dir } = await loadFilm(ref)
  const atRaw = strFlag(flags, 'at')
  const at = atRaw !== undefined ? resolveAt(doc as never, atRaw) : null
  if (flags.voice === true && flags['no-voice'] === true)
    throw new UsageError('--voice and --no-voice together say nothing')
  const liked = await likedSlugs(multi.like ?? [], origin)
  const film = filmSummaryOf(doc, {
    seed,
    ...(at ? { payoff: at.at } : {}),
    ...(flags.voice === true
      ? { voice: true }
      : flags['no-voice'] === true
        ? { voice: false }
        : {}),
    mood: strFlag(flags, 'mood'),
    words: strFlag(flags, 'words'),
    like: liked.slugs,
    fadeIn: flags['fade-in'] === true,
  })
  const top = Math.max(1, Math.round(numFlag(flags, 'top', 3)))
  const all = rankBeds(catalog.tracks, film)
  const picks = all.filter((x) => x.score !== null).slice(0, top)
  for (const n of liked.notes) r.warn(n)
  const asked = strFlag(flags, 'mood')
  if (asked && trackBySlug(catalog.tracks, asked))
    r.warn(
      `--mood ${asked} is a track's slug; to place that track, run vos score --track ${asked}`,
    )
  r.done(
    {
      origin,
      film,
      picks: picks.map((x) => ({
        ...x,
        command: scoreLine(dir ? ref : null, x, film),
      })),
      all,
    },
    pickWords(picks, all, film, dir ? ref : null),
  )
  return EXIT_OK
}
