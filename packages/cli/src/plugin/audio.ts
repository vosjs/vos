/**
 * `vos audio measure <take> [--json]`: what every sound in the document
 * measures, written beside it.
 *
 * A clip's `normalize` is a target loudness; the gain it plays at is
 * computed at lowering from what the clip's file MEASURES. That fact lives
 * in the document as `loudness: { lufs, peakDb, at, src }`, written here and
 * never by hand: each clip's file is decoded (mediabunny in Node, the
 * headless browser for what Node cannot read, as `vos score` does) and read
 * by the BS.1770 meter `vos check-video` reads a render with, integrated
 * (K-weighted, gated) over the whole file, plus its sample peak. `src` is
 * the key it was measured for, so a clip pointed at another file stops
 * matching and its target is ignored until it is measured again.
 *
 * A key on this disk is read in the take directory or below, never outside
 * it; an absolute URL (a catalog track) is downloaded for the measure and
 * not kept; a hosted asset key is not on this disk, and is said.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { clipGain } from '@vosjs/studio-core'
import { localFile } from '../programAssets'
import { UsageError, parseArgs } from './args'
import { isTakeRelativeKey, takeRelativeFile } from './media'
import { EXIT_ERROR, EXIT_OK, createReporter } from './output'
import { loudnessFact, measureTrack } from './score'
import { loadTake, writeJson } from './take'
import type { AudioClip, AudioLoudness } from '@vosjs/studio-core'
import type { Measured } from './score'

const USAGE = 'vos audio measure <take> [--json]'

export interface MeasuredClip {
  id: string
  key: string
  loudness: AudioLoudness | null
  normalize: number | null
  /** The gain the clip plays at now, and why. */
  plays: ReturnType<typeof clipGain>
  /** Why it was not measured, in words. */
  skipped?: string
}

/** Where a key's bytes are, for a measure: a file here, or downloaded. */
async function fileFor(
  dir: string,
  key: string,
  fetchImpl: typeof fetch,
): Promise<
  { path: string; cleanup?: () => Promise<void> } | { skipped: string }
> {
  if (isTakeRelativeKey(key)) {
    const found = localFile(takeRelativeFile(key), dir)
    if ('refused' in found) return { skipped: `${key} ${found.refused}` }
    return { path: found.file }
  }
  if (/^https?:\/\//.test(key)) {
    const res = await fetchImpl(key)
    if (!res.ok) return { skipped: `GET ${key} answered ${res.status}` }
    const tmp = await mkdtemp(join(tmpdir(), 'vos-audio-'))
    const path = join(tmp, basename(new URL(key).pathname) || 'audio')
    await writeFile(path, new Uint8Array(await res.arrayBuffer()))
    return { path, cleanup: () => rm(tmp, { recursive: true, force: true }) }
  }
  return {
    skipped: `${key} is not on this disk (a hosted file comes home with vos pull --media)`,
  }
}

/**
 * Measure every audio clip of a document in place. Pure of the disk but
 * for the reads: the caller writes the document.
 */
export async function measureDocAudio(
  dir: string,
  audio: AudioClip[],
  opts: {
    measure?: (path: string) => Promise<Pick<Measured, 'lufs' | 'peakDb'>>
    fetchImpl?: typeof fetch
  } = {},
): Promise<{ clips: MeasuredClip[]; failed: string[] }> {
  const measure = opts.measure ?? measureTrack
  const fetchImpl = opts.fetchImpl ?? fetch
  const byKey = new Map<string, AudioLoudness | { skipped: string }>()
  const failed: string[] = []
  const clips: MeasuredClip[] = []
  for (const clip of audio) {
    let got = byKey.get(clip.key)
    if (!got) {
      try {
        const file = await fileFor(dir, clip.key, fetchImpl)
        if ('skipped' in file) got = file
        else {
          try {
            const m = await measure(file.path)
            got =
              m.lufs === null
                ? { skipped: 'it measures as silence' }
                : loudnessFact({ lufs: m.lufs, peakDb: m.peakDb }, clip.key)
          } finally {
            await file.cleanup?.()
          }
        }
      } catch (e) {
        const why = (e instanceof Error ? e.message : String(e)).split('\n')[0]
        failed.push(`audio ${clip.id}: could not measure ${clip.key} (${why})`)
        got = { skipped: why }
      }
      byKey.set(clip.key, got)
    }
    if (!('skipped' in got)) clip.loudness = { ...got }
    clips.push({
      id: clip.id,
      key: clip.key,
      loudness: 'skipped' in got ? null : clip.loudness!,
      normalize: typeof clip.normalize === 'number' ? clip.normalize : null,
      plays: clipGain(clip),
      ...('skipped' in got ? { skipped: got.skipped } : {}),
    })
  }
  return { clips, failed }
}

function clipLine(c: MeasuredClip): string {
  if (!c.loudness) return `audio ${c.id}: not measured (${c.skipped})`
  const peak =
    c.loudness.peakDb === null
      ? ''
      : `, peak ${c.loudness.peakDb.toFixed(1)} dBFS`
  const level =
    c.plays.basis === 'normalize'
      ? `; normalize ${c.normalize} plays it at gain ${c.plays.gain.toFixed(2)}${c.plays.capped === 'peak' ? ` (asked ${c.plays.asked?.toFixed(2)}, held so its peak stays under -1 dBFS)` : c.plays.capped === 'lift' ? ' (the most a target lifts, +24 dB)' : ''}`
      : `; plays at gain ${c.plays.gain.toFixed(2)} (no normalize target)`
  return `audio ${c.id}: ${c.loudness.lufs.toFixed(1)} LUFS${peak}${level}`
}

export async function cmdAudio(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, new Set(['json', 'help']))
  const [sub, dir] = positionals
  if (sub !== 'measure' || !dir) throw new UsageError(USAGE)
  const r = createReporter(flags.json === true)
  const take = await loadTake(dir)
  if (!take.doc)
    throw new UsageError(`${dir} has no doc.json; run vos plan first`)
  const doc = take.doc
  if (!doc.audio?.length) {
    r.done({ take: dir, clips: [] }, `${dir}: no audio clips to measure`)
    return EXIT_OK
  }
  r.log(
    `measuring ${doc.audio.length} audio clip${doc.audio.length === 1 ? '' : 's'}…`,
  )
  const { clips, failed } = await measureDocAudio(dir, doc.audio)
  const wrote = clips.some((c) => c.loudness)
  if (wrote) await writeJson(take.paths.doc, doc, true)
  for (const f of failed) r.warn(f)
  r.done(
    { take: dir, clips, failed },
    `${clips.map(clipLine).join('\n')}${wrote ? '\n  loudness written in doc.json' : ''}`,
  )
  return failed.length ? EXIT_ERROR : EXIT_OK
}
