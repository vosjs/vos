/**
 * `vos score <take> --track <slug|file> [--at <step|seconds>] [--gain 0..1]
 * [--fade-out <s>] [--dry-run]`: the film's music, timed to the film.
 *
 * A track has a shape: a quiet bar, a build, a SWELL where it opens up. A
 * score lands that swell on the film's payoff. So the track is decoded and
 * measured (a short-term loudness curve: K-weighted LUFS per BS.1770 where
 * the audio allows it, plain RMS dBFS otherwise, labelled either way), its
 * strongest swell is found (the largest sustained rise to a peak), and the
 * audio clip's `in` is set so the swell plays at `--at`: a step, resolved
 * through the cut exactly as an anchored caption is, or output seconds.
 * Without `--at` the track starts where it first rises above its median
 * level, past any near-silent count-in. The clip covers the film (`out` =
 * `in` + the film's length, clamped to the track, said when it cannot).
 *
 * The clip is ONE audio clip with id `score`, written or replaced in
 * doc.json; `--dry-run` prints the plan and the envelope instead.
 *
 * Decoding: mediabunny in Node, which reads PCM (WAV) by itself; a
 * compressed track (the catalog's MP3s) is decoded in the CLI's headless
 * browser, which has the codecs Node lacks, and measured here.
 */
import { existsSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  docMediaList,
  docOutputDuration,
  findStep,
  ratedSegments,
  resolveAnchor,
} from '@vosjs/studio-core'
import { launchBrowser } from '../browser'
import { UsageError, numFlag, parseArgs, strFlag } from './args'
import { fetchMusicCatalog } from './music'
import { EXIT_OK, createReporter } from './output'
import { platformOrigin } from './platform'
import { loadTake, writeJson } from './take'
import type { AudioClip, ProjectDoc } from '@vosjs/studio-core'

/** The clip a score writes, and replaces on the next run. */
export const SCORE_ID = 'score'

/** Seconds per measured block, the BS.1770 gating block's step. */
export const BLOCK_SECONDS = 0.1
/** The short-term window a level point averages, and the step between points. */
export const WINDOW_SECONDS = 1
export const HOP_SECONDS = 0.5
/** A level below this reads as silence (and the curve's floor). */
const FLOOR_DB = -70

export type LoudnessUnit = 'LUFS' | 'dBFS'

// --- K-weighting (BS.1770: a high shelf, then a high pass) ---

interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** The two K-weighting stages at a sample rate (the published analog design, bilinear). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelf = (() => {
    const f0 = 1681.974450955533
    const G = 3.999843853973347
    const Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const Vh = Math.pow(10, G / 20)
    const Vb = Math.pow(Vh, 0.4996667741545416)
    const a0 = 1 + K / Q + K * K
    return {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    }
  })()
  const highPass = (() => {
    const f0 = 38.13547087602444
    const Q = 0.5003270373238773
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const a0 = 1 + K / Q + K * K
    return {
      b0: 1,
      b1: -2,
      b2: 1,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    }
  })()
  return [shelf, highPass]
}

/**
 * Mean-square power per block, summed over channels, fed in chunks of
 * planar samples. K-weighted (LUFS) when the audio is mono or stereo at a
 * rate the filter is defined for; plain (dBFS) otherwise.
 */
export class LoudnessMeter {
  readonly unit: LoudnessUnit
  private readonly blockLen: number
  private readonly filters: [Biquad, Biquad] | null
  /** Per channel, per stage: [x1, x2, y1, y2]. */
  private readonly state: number[][][]
  private readonly acc: number[]
  private filled = 0
  readonly blocks: number[] = []

  constructor(
    readonly sampleRate: number,
    readonly channels: number,
  ) {
    this.blockLen = Math.max(1, Math.round(sampleRate * BLOCK_SECONDS))
    const weighted = channels >= 1 && channels <= 2 && sampleRate >= 8000
    this.unit = weighted ? 'LUFS' : 'dBFS'
    this.filters = weighted ? kWeighting(sampleRate) : null
    this.state = Array.from({ length: channels }, () => [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    this.acc = new Array<number>(channels).fill(0)
  }

  /** One chunk: a Float32Array per channel, all the same length. */
  push(planes: readonly Float32Array[]): void {
    const n = planes[0]?.length ?? 0
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < this.channels; c++) {
        let v = planes[c]?.[i] ?? 0
        if (this.filters) {
          for (let k = 0; k < 2; k++) {
            const f = this.filters[k]
            const s = this.state[c][k]
            const y =
              f.b0 * v + f.b1 * s[0] + f.b2 * s[1] - f.a1 * s[2] - f.a2 * s[3]
            s[1] = s[0]
            s[0] = v
            s[3] = s[2]
            s[2] = y
            v = y
          }
        }
        this.acc[c] += v * v
      }
      if (++this.filled === this.blockLen) this.flush()
    }
  }

  private flush(): void {
    let power = 0
    for (let c = 0; c < this.channels; c++) {
      // dBFS reads the mean over channels; LUFS sums them (weight 1 each).
      power += this.acc[c] / this.filled
      this.acc[c] = 0
    }
    if (this.unit === 'dBFS') power /= Math.max(1, this.channels)
    this.blocks.push(power)
    this.filled = 0
  }

  /** The blocks, the last partial one included. */
  finish(): number[] {
    if (this.filled > this.blockLen / 2) this.flush()
    return this.blocks
  }
}

export interface LevelPoint {
  /** The window's centre, track seconds. */
  t: number
  /** Short-term level, in the curve's unit (floored at -70). */
  level: number
}

/** The short-term level curve from block powers: a 1 s window every 0.5 s. */
export function levelCurve(
  blocks: readonly number[],
  unit: LoudnessUnit,
): LevelPoint[] {
  const per = Math.round(WINDOW_SECONDS / BLOCK_SECONDS)
  const hop = Math.round(HOP_SECONDS / BLOCK_SECONDS)
  const out: LevelPoint[] = []
  for (let i = 0; i + per <= blocks.length; i += hop) {
    let sum = 0
    for (let j = i; j < i + per; j++) sum += blocks[j]
    const mean = sum / per
    const db =
      mean > 0
        ? (unit === 'LUFS' ? -0.691 : 0) + 10 * Math.log10(mean)
        : -Infinity
    out.push({
      t: +((i + per / 2) * BLOCK_SECONDS).toFixed(3),
      level: +Math.max(FLOOR_DB, db).toFixed(2),
    })
  }
  return out
}

export interface Swell {
  /** Where the swell ARRIVES (first reaches within 1 dB of its peak), track seconds. */
  at: number
  /** The quiet it rises from, and the peak it reaches. */
  from: number
  peak: number
  /** The rise, in dB (LU for LUFS). */
  rise: number
  peakLevel: number
}

/** How far back a swell's quiet may lie, seconds. */
const SWELL_LOOKBACK = 15
/** A peak must hold (within 3 dB) this long to count: a swell, not a hit. */
const SWELL_SUSTAIN = 1.5
const SWELL_HOLD_DB = 3
/** Arrival: the first point within this of the peak. */
const SWELL_ARRIVE_DB = 1
/** A rise smaller than this is no swell. */
const SWELL_MIN_RISE = 3

/** The track's strongest swell: the largest sustained rise to a peak. */
export function findSwell(curve: readonly LevelPoint[]): Swell | null {
  const step = HOP_SECONDS
  const back = Math.round(SWELL_LOOKBACK / step)
  const hold = Math.round(SWELL_SUSTAIN / step)
  let best: Swell | null = null
  for (let i = 1; i < curve.length; i++) {
    const p = curve[i]
    // Sustained: the level holds near the peak for a while after it.
    let held = true
    for (let k = i + 1; k <= i + hold; k++) {
      if (k >= curve.length || curve[k].level < p.level - SWELL_HOLD_DB) {
        held = false
        break
      }
    }
    if (!held) continue
    // The quiet it rose from: the lowest point in the lookback.
    let lo = i
    for (let j = Math.max(0, i - back); j < i; j++)
      if (curve[j].level < curve[lo].level) lo = j
    const rise = p.level - curve[lo].level
    if (rise < SWELL_MIN_RISE) continue
    // Only the summit of a climb is a candidate (a better peak follows it).
    if (i + 1 < curve.length && curve[i + 1].level > p.level) continue
    if (best && rise <= best.rise + 1e-9) continue
    let arrive = i
    for (let k = lo; k <= i; k++) {
      if (curve[k].level >= p.level - SWELL_ARRIVE_DB) {
        arrive = k
        break
      }
    }
    best = {
      at: curve[arrive].t,
      from: curve[lo].t,
      peak: p.t,
      rise: +rise.toFixed(2),
      peakLevel: p.level,
    }
  }
  return best
}

const median = (xs: readonly number[]): number => {
  if (!xs.length) return FLOOR_DB
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The first moment the track rises above its median level (its window's start). */
export function firstAboveMedian(curve: readonly LevelPoint[]): number {
  const m = median(curve.map((p) => p.level))
  const hit = curve.find((p) => p.level > m)
  return hit ? Math.max(0, +(hit.t - WINDOW_SECONDS / 2).toFixed(3)) : 0
}

export interface ScorePlanInput {
  trackDuration: number
  film: number
  curve: readonly LevelPoint[]
  swell: Swell | null
  /** Output seconds the swell should land at; null = start at the first rise. */
  at: number | null
}

export interface ScorePlan {
  in: number
  out: number
  /** Output seconds the swell plays at in the planned clip, when there is one. */
  swellAt: number | null
  notes: string[]
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

/** Where the clip starts in the track, and what could not be had. */
export function planScore(input: ScorePlanInput): ScorePlan {
  const { trackDuration, film, swell } = input
  const notes: string[] = []
  let start: number
  if (input.at !== null) {
    if (!swell) {
      notes.push(
        'the track has no swell (no sustained rise of 3 dB or more); it starts at its first rise instead',
      )
      start = firstAboveMedian(input.curve)
    } else {
      start = swell.at - input.at
      if (start < 0) {
        notes.push(
          `the swell (${swell.at.toFixed(1)}s into the track) comes before ${input.at.toFixed(1)}s of film can play ahead of it; the track starts at its top and the swell lands at ${swell.at.toFixed(1)}s`,
        )
        start = 0
      }
    }
  } else {
    start = firstAboveMedian(input.curve)
  }
  if (trackDuration < film) {
    notes.push(
      `the track (${trackDuration.toFixed(1)}s) is shorter than the film (${film.toFixed(1)}s); it cannot cover it, so it starts at its top and ends early`,
    )
    start = 0
  } else if (start + film > trackDuration) {
    const fit = Math.max(0, trackDuration - film)
    notes.push(
      `from ${start.toFixed(1)}s the track ends before the film does; it starts at ${fit.toFixed(1)}s instead, so the film is covered${swell && input.at !== null ? ` and the swell lands at ${(swell.at - fit).toFixed(1)}s` : ''}`,
    )
    start = fit
  }
  const out = Math.min(trackDuration, start + film)
  const swellAt =
    swell && swell.at >= start && swell.at <= out ? r3(swell.at - start) : null
  return { in: r3(start), out: r3(out), swellAt, notes }
}

/** A curve as one line of blocks, a glyph per point (at most `width` of them). */
export function sparkline(curve: readonly LevelPoint[], width = 64): string {
  if (!curve.length) return ''
  const glyphs = '▁▂▃▄▅▆▇█'
  const step = Math.max(1, Math.ceil(curve.length / width))
  const pts: number[] = []
  for (let i = 0; i < curve.length; i += step) {
    let m = -Infinity
    for (let j = i; j < Math.min(curve.length, i + step); j++)
      m = Math.max(m, curve[j].level)
    pts.push(m)
  }
  // The top 24 dB is the shape; a fade to silence would flatten the rest.
  const hi = Math.max(...pts)
  const lo = Math.max(Math.min(...pts), hi - 24)
  return pts
    .map(
      (v) =>
        glyphs[
          hi > lo
            ? Math.max(
                0,
                Math.min(
                  glyphs.length - 1,
                  Math.floor(((v - lo) / (hi - lo)) * glyphs.length),
                ),
              )
            : 0
        ],
    )
    .join('')
}

// --- decoding ---

export interface Measured {
  sampleRate: number
  channels: number
  duration: number
  unit: LoudnessUnit
  blocks: number[]
  /** Which decoder read it. */
  via: 'node' | 'browser'
}

/** Decode in Node with mediabunny (PCM needs no codec); null when it cannot. */
async function measureInNode(path: string): Promise<Measured | null> {
  const MB = await import('mediabunny')
  const input = new MB.Input({
    formats: MB.ALL_FORMATS,
    source: new MB.FilePathSource(path),
  })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new UsageError(`${path} has no audio track`)
    if (!(await track.canDecode())) return null
    const meter = new LoudnessMeter(track.sampleRate, track.numberOfChannels)
    const sink = new MB.AudioSampleSink(track)
    let frames = 0
    for await (const sample of sink.samples()) {
      const planes: Float32Array[] = []
      for (let c = 0; c < track.numberOfChannels; c++) {
        const a = new Float32Array(sample.numberOfFrames)
        sample.copyTo(a, { planeIndex: c, format: 'f32-planar' })
        planes.push(a)
      }
      frames += sample.numberOfFrames
      sample.close()
      meter.push(planes)
    }
    return {
      sampleRate: track.sampleRate,
      channels: track.numberOfChannels,
      duration: frames / track.sampleRate,
      unit: meter.unit,
      blocks: meter.finish(),
      via: 'node',
    }
  } finally {
    input.dispose()
  }
}

/** Seconds of samples per round trip out of the page. */
const PAGE_CHUNK_SECONDS = 10

/** Decode in the headless browser (its codecs), measure here. */
async function measureInBrowser(path: string): Promise<Measured> {
  const bytes = await readFile(path)
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    // Strings, not functions: nothing a bundler adds to a function body
    // reaches the page.
    const info = (await page.evaluate(`(async () => {
      const b64 = ${JSON.stringify(bytes.toString('base64'))}
      const bin = atob(b64)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      const ctx = new OfflineAudioContext(1, 1, 48000)
      const buf = await ctx.decodeAudioData(u8.buffer)
      window.__vosScore = buf
      return { sampleRate: buf.sampleRate, channels: buf.numberOfChannels, length: buf.length }
    })()`)) as { sampleRate: number; channels: number; length: number }
    const meter = new LoudnessMeter(info.sampleRate, info.channels)
    const chunk = Math.round(info.sampleRate * PAGE_CHUNK_SECONDS)
    for (let from = 0; from < info.length; from += chunk) {
      const parts = (await page.evaluate(`(() => {
        const buf = window.__vosScore
        const out = []
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const a = buf.getChannelData(c).subarray(${from}, ${from + chunk})
          const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
          let s = ''
          for (let i = 0; i < u8.length; i += 0x8000)
            s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
          out.push(btoa(s))
        }
        return out
      })()`)) as string[]
      meter.push(
        parts.map((p) => {
          const b = Buffer.from(p, 'base64')
          return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
        }),
      )
    }
    return {
      sampleRate: info.sampleRate,
      channels: info.channels,
      duration: info.length / info.sampleRate,
      unit: meter.unit,
      blocks: meter.finish(),
      via: 'browser',
    }
  } finally {
    await browser.close()
  }
}

/** Decode and measure a track file. */
export async function measureTrack(path: string): Promise<Measured> {
  return (await measureInNode(path)) ?? (await measureInBrowser(path))
}

// --- the verb ---

/**
 * `--at`: output seconds, or a step (its id, or `step:<index>`;
 * `<media>:<step>` for another media's), resolved through the cut like an
 * anchor.
 */
export function resolveAt(
  doc: ProjectDoc,
  raw: string,
): { at: number; via: string } {
  const trimmed = raw.trim()
  // A bare number is seconds; `step:<n>` names a step by its index.
  if (/^\d+(\.\d+)?s?$/.test(trimmed)) {
    const at = parseFloat(trimmed)
    return { at, via: `${at}s` }
  }
  const v = trimmed.startsWith('step:') ? trimmed.slice(5) : trimmed
  const pieces = ratedSegments(doc)
  const colon = v.indexOf(':')
  const named =
    colon > 0 ? { media: v.slice(0, colon), step: v.slice(colon + 1) } : null
  const candidates = named
    ? [named]
    : docMediaList(doc)
        .filter(({ source }) => findStep(source.meta.steps ?? [], v))
        .map(({ id }) => ({ media: id, step: v }))
  if (!candidates.length)
    throw new UsageError(
      `--at ${raw}: no step by that id or index in this take (and not a number of seconds)`,
    )
  if (candidates.length > 1)
    throw new UsageError(
      `--at ${raw}: steps of several media carry it; say which, as <media>:<step> (${candidates.map((c) => `${c.media || 'primary'}`).join(', ')})`,
    )
  const c = candidates[0]
  const r = resolveAnchor(
    doc,
    { step: c.step, ...(c.media ? { media: c.media } : {}) },
    pieces,
  )
  if (r.start === null)
    throw new UsageError(
      `--at ${raw}: that step ${r.miss === 'cut' ? 'is cut out of the film' : r.miss === 'skipped' ? 'was skipped by the recorder' : 'is not in the take'}`,
    )
  return { at: r.start, via: `step ${v} (${r.start.toFixed(2)}s)` }
}

/** The track a `--track` names: a file here, or a catalog slug. */
async function resolveTrack(
  dir: string,
  ref: string,
  flags: Record<string, string | true>,
  dryRun: boolean,
): Promise<{
  path: string
  key: string
  name: string
  cleanup?: () => Promise<void>
}> {
  const local = resolve(ref)
  if (existsSync(local)) {
    const rel = relative(resolve(dir), local)
    // A file beside the take is named where it is; one from elsewhere is
    // copied into the take's music/ (the document names files beside it).
    const inside =
      !!rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)
    const key = inside ? rel.split(sep).join('/') : `music/${basename(local)}`
    if (!inside && !dryRun) {
      await mkdir(join(dir, 'music'), { recursive: true })
      await copyFile(local, join(dir, key))
    }
    return { path: local, key, name: basename(local) }
  }
  const origin = platformOrigin({
    origin: strFlag(flags, 'origin'),
    api: strFlag(flags, 'api'),
  })
  const catalog = await fetchMusicCatalog(origin)
  const track = catalog.tracks.find((t) => t.slug === ref)
  if (!track)
    throw new UsageError(
      `--track ${ref}: no such file, and no catalog track by that slug (some: ${catalog.tracks
        .slice(0, 6)
        .map((t) => t.slug)
        .join(', ')}; the list is GET ${origin}/api/music)`,
    )
  const res = await fetch(track.url)
  if (!res.ok) throw new Error(`GET ${track.url} answered ${res.status}`)
  const tmp = await mkdtemp(join(tmpdir(), 'vos-score-'))
  const path = join(tmp, basename(new URL(track.url).pathname) || 'track')
  await writeFile(path, new Uint8Array(await res.arrayBuffer()))
  return {
    path,
    key: track.url,
    name: track.title,
    cleanup: () => rm(tmp, { recursive: true, force: true }),
  }
}

const BOOLEAN_FLAGS = new Set(['json', 'help', 'dry-run'])

const USAGE =
  'vos score <take> --track <slug|file> [--at <step id|output seconds>] [--gain 0..1] [--fade-out <s>] [--dry-run] [--json]'

export async function cmdScore(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const dir = positionals[0]
  const trackRef = strFlag(flags, 'track')
  if (!dir || !trackRef) throw new UsageError(USAGE)
  const r = createReporter(flags.json === true)
  const dryRun = flags['dry-run'] === true
  const gain = numFlag(flags, 'gain', 0.5)
  if (!(gain >= 0 && gain <= 1))
    throw new UsageError('--gain expects a number from 0 to 1')
  const fadeOut = numFlag(flags, 'fade-out', 1.5)
  if (!(fadeOut >= 0)) throw new UsageError('--fade-out expects seconds ≥ 0')
  const take = await loadTake(dir)
  if (!take.doc)
    throw new UsageError(`${dir} has no doc.json; run vos plan first`)
  const doc = take.doc
  const atRaw = strFlag(flags, 'at')
  const at = atRaw !== undefined ? resolveAt(doc, atRaw) : null

  const track = await resolveTrack(dir, trackRef, flags, dryRun)
  let measured: Measured
  try {
    r.log(`measuring ${track.name}…`)
    measured = await measureTrack(track.path)
  } finally {
    await track.cleanup?.()
  }
  const curve = levelCurve(measured.blocks, measured.unit)
  const swell = findSwell(curve)
  const film = docOutputDuration(doc)
  const plan = planScore({
    trackDuration: measured.duration,
    film,
    curve,
    swell,
    at: at ? at.at : null,
  })
  const clip: AudioClip = {
    id: SCORE_ID,
    key: track.key,
    name: track.name,
    start: 0,
    in: plan.in,
    out: plan.out,
    duration: r3(measured.duration),
    gain,
    fadeIn: 0,
    fadeOut: Math.min(fadeOut, Math.max(0, plan.out - plan.in)),
    ...(doc.source.micKey ? { duck: true } : {}),
  }
  const levels = curve.map((p) => p.level)
  const envelope = {
    unit: measured.unit,
    weighted: measured.unit === 'LUFS',
    decoder: measured.via,
    sampleRate: measured.sampleRate,
    channels: measured.channels,
    min: levels.length ? Math.min(...levels) : null,
    median: levels.length ? median(levels) : null,
    max: levels.length ? Math.max(...levels) : null,
    points: curve,
  }
  const others = doc.audio.filter((a) => a.id !== SCORE_ID && a.start < 0.05)
  if (others.length)
    plan.notes.push(
      `${others.map((a) => a.id).join(', ')} also play${others.length === 1 ? 's' : ''} from the top; two tracks under one film rarely mean to`,
    )
  if (!dryRun) {
    doc.audio = [...doc.audio.filter((a) => a.id !== SCORE_ID), clip]
    await writeJson(take.paths.doc, doc, true)
  }
  const label = measured.unit === 'LUFS' ? 'LUFS, K-weighted' : 'dBFS RMS'
  const swellLine = swell
    ? `swell: +${swell.rise.toFixed(1)} dB from ${swell.from.toFixed(1)}s, arriving ${swell.at.toFixed(1)}s into the track (peak ${swell.peakLevel.toFixed(1)} ${measured.unit} at ${swell.peak.toFixed(1)}s)`
    : 'swell: none (no sustained rise of 3 dB or more)'
  const placeLine =
    at && plan.swellAt !== null
      ? `the track starts at ${plan.in.toFixed(2)}s, so the swell lands at ${plan.swellAt.toFixed(2)}s of film (asked: ${at.via})`
      : `the track starts at ${plan.in.toFixed(2)}s${at ? ` (asked: ${at.via})` : ', its first rise above its median level'}`
  r.done(
    {
      take: resolve(dir),
      dryRun,
      track: { key: track.key, name: track.name, duration: clip.duration },
      film: r3(film),
      swell,
      at: at?.at ?? null,
      clip,
      notes: plan.notes,
      envelope,
    },
    `${dryRun ? 'Would score' : 'Scored'} ${dir} with ${track.name} (${measured.duration.toFixed(1)}s, ${label})\n  ${sparkline(curve)}\n  ${swellLine}\n  ${placeLine}; it plays ${plan.in.toFixed(2)}..${plan.out.toFixed(2)} under the ${film.toFixed(1)}s film at gain ${gain}${plan.notes.length ? `\n  note: ${plan.notes.join('\n  note: ')}` : ''}${dryRun ? '\n  (dry run: doc.json untouched)' : `\n  audio clip "${SCORE_ID}" ${doc.audio.length > 1 ? 'written beside the others' : 'written'} in doc.json`}`,
  )
  return EXIT_OK
}
