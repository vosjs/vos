/**
 * `vos check-video <file>`: the rendered FILE checked as a viewer meets it,
 * with no ffmpeg. The container's facts come from mediabunny in node; the
 * pictures and the sound are decoded in the browser the CLI already drives
 * (mediabunny over WebCodecs, the copy this package installs), which hands
 * back small measurements: each sampled frame's change from the one before
 * (the mean absolute difference of its colours, drawn 64 px on the long side),
 * the K-weighted energy of the sound in 100 ms pieces, the first and last
 * frames as PNGs. What they mean is decided in videoChecks.ts.
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { ALL_FORMATS, FilePathSource, Input } from 'mediabunny'
import { UsageError, parseArgs, strFlag } from './args'
import { EXIT_OK, EXIT_USAGE, createReporter } from './output'
import { startTakeServer, waitForPageDone } from './server'
import { launchBrowser } from '../browser'
import {
  SCENE_CHANGE_AT,
  CELL_CHANGED_AT,
  ISOLATED_CHANGE_AT,
  SCENE_WINDOW,
  SUB_BLOCK_SECONDS,
  createLoudnessMeter,
  loudnessFromEnergies,
  loudnessWarnings,
  posterWarning,
  sceneChanges,
  sceneWarnings,
  windowCounts,
} from './videoChecks'
import type { LoudnessReport, SceneChange } from './videoChecks'
import type { Browser } from 'playwright'

const BOOLEAN_FLAGS = new Set(['json', 'help', 'strict'])

/** The long side frames are drawn at to be compared, in pixels. */
const THUMB_LONG_SIDE = 64

export interface VideoFacts {
  file: string
  bytes: number
  /** Seconds. */
  duration: number
  width: number
  height: number
  /** Frames per second, from the packets' own timing. */
  fps: number
  container: string
  video: { codec: string | null; codecString: string | null }
  audio: {
    codec: string | null
    codecString: string | null
    sampleRate: number
    channels: number
  } | null
}

/** The file's own facts, read from its container in node. */
export async function probeVideoFacts(file: string): Promise<VideoFacts> {
  const input = new Input({
    source: new FilePathSource(file),
    formats: ALL_FORMATS,
  })
  try {
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new UsageError(`${file} has no video track`)
    const [format, duration, stats, audio, bytes] = await Promise.all([
      input.getFormat(),
      input.computeDuration(),
      video.computePacketStats(240),
      input.getPrimaryAudioTrack(),
      stat(file).then((s) => s.size),
    ])
    return {
      file,
      bytes,
      duration: Math.round(duration * 1000) / 1000,
      width: video.displayWidth,
      height: video.displayHeight,
      fps: Math.round(stats.averagePacketRate * 100) / 100,
      container: format.mimeType,
      video: {
        codec: video.codec,
        codecString: await video.getCodecParameterString(),
      },
      audio: audio
        ? {
            codec: audio.codec,
            codecString: await audio.getCodecParameterString(),
            sampleRate: audio.sampleRate,
            channels: audio.numberOfChannels,
          }
        : null,
    }
  } finally {
    input.dispose()
  }
}

/** The browser bundle of the mediabunny this package installs. */
async function mediabunnyBundle(): Promise<string> {
  const entry = createRequire(import.meta.url).resolve('mediabunny')
  const bundle = join(dirname(entry), 'mediabunny.min.mjs')
  if (existsSync(bundle)) return readFile(bundle, 'utf8')
  // A layout where `require` resolves into dist/modules: the bundles sit beside it.
  return readFile(
    join(entry.split('/dist/')[0], 'dist/bundles/mediabunny.min.mjs'),
    'utf8',
  )
}

interface DecodeDone {
  times: number[]
  changes: number[]
  coverage: number[]
  firstDeviation: number
  lastDeviation: number
  firstTime: number
  lastTime: number
  firstPng: string
  lastPng: string
  audio: {
    sampleRate: number
    channels: number
    energies: number[][]
    peak: number
    samples: number
  } | null
}

/** Runs inside the decode page (serialized by Playwright). */
async function decodeInPage(opts: {
  mbCode: string
  meterSrc: string
  videoUrl: string
  sampleFps: number
  thumbW: number
  thumbH: number
  subBlock: number
  cellChanged: number
}) {
  const w = window as unknown as Record<string, any>
  try {
    // An import spelled as text: a bundler or a test transform that
    // rewrites `import()` in this function would break it in the page.
    const load = new Function('u', 'return import(u)') as (
      u: string,
    ) => Promise<any>
    const MB = await load(
      URL.createObjectURL(new Blob([opts.mbCode], { type: 'text/javascript' })),
    )
    const input = new MB.Input({
      source: new MB.UrlSource(opts.videoUrl),
      formats: MB.ALL_FORMATS,
    })
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('no video track')
    if (!(await track.canDecode()))
      throw new Error(`this browser cannot decode ${String(track.codec)}`)

    // A frame as its colour values, R, G and B in turn: a cut between two
    // pictures of the same brightness and a different hue is still a cut.
    const pixels = (canvas: HTMLCanvasElement | OffscreenCanvas): number[] => {
      const g = canvas.getContext('2d', {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D
      const px = g.getImageData(0, 0, canvas.width, canvas.height).data
      const out: number[] = new Array((px.length / 4) * 3)
      for (let p = 0, q = 0; p < px.length; p += 4, q += 3) {
        out[q] = px[p]
        out[q + 1] = px[p + 1]
        out[q + 2] = px[p + 2]
      }
      return out
    }
    // How far a frame is from one flat colour: the spread of each channel,
    // averaged over the three.
    const deviation = (a: number[]) => {
      let total = 0
      for (let c = 0; c < 3; c++) {
        let s = 0
        let n = 0
        for (let i = c; i < a.length; i += 3) {
          s += a[i]
          n++
        }
        const m = s / Math.max(1, n)
        let q = 0
        for (let i = c; i < a.length; i += 3) q += (a[i] - m) * (a[i] - m)
        total += Math.sqrt(q / Math.max(1, n))
      }
      return total / 3
    }
    const difference = (a: number[], b: number[]) => {
      let s = 0
      for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
      return s / Math.max(1, a.length) / 255
    }
    // How much of the frame changed: the share of 4 px cells whose own
    // mean difference reaches `opts.cellChanged`.
    const coverageOf = (a: number[], b: number[]) => {
      const W = opts.thumbW
      const H = opts.thumbH
      let cells = 0
      let changed = 0
      for (let cy = 0; cy < H; cy += 4)
        for (let cx = 0; cx < W; cx += 4) {
          let s = 0
          let n = 0
          for (let y = cy; y < Math.min(H, cy + 4); y++)
            for (let x = cx; x < Math.min(W, cx + 4); x++) {
              const k = (y * W + x) * 3
              s +=
                Math.abs(a[k] - b[k]) +
                Math.abs(a[k + 1] - b[k + 1]) +
                Math.abs(a[k + 2] - b[k + 2])
              n += 3
            }
          cells++
          if (s / Math.max(1, n) / 255 >= opts.cellChanged) changed++
        }
      return changed / Math.max(1, cells)
    }

    // Every frame is decoded in order (never a seek per sample, which
    // re-decodes from the keyframe each time) and drawn small with the
    // high-quality resampler, which averages the picture instead of picking
    // a few of its pixels; one frame is kept per sample step.
    const small = document.createElement('canvas')
    small.width = opts.thumbW
    small.height = opts.thumbH
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    sctx.imageSmoothingEnabled = true
    sctx.imageSmoothingQuality = 'high'
    const samples = new MB.VideoSampleSink(track)
    const step = 1 / opts.sampleFps
    const times: number[] = []
    const changes: number[] = []
    const coverage: number[] = []
    let next = -Infinity
    let prev: number[] | null = null
    let first: number[] | null = null
    let firstTime = 0
    let lastTime = 0
    let lastKept = -1
    let lastGray: number[] | null = null
    let tail: number[] | null = null
    const duration = await input.computeDuration()
    for await (const sample of samples.samples()) {
      const t = sample.timestamp as number
      sctx.clearRect(0, 0, opts.thumbW, opts.thumbH)
      sample.draw(sctx, 0, 0, opts.thumbW, opts.thumbH)
      sample.close()
      lastTime = t
      // Half a step of slack: a container rounds timestamps (WebM to the
      // millisecond), and a frame a hair early is still the one wanted.
      if (t + step / 2 < next) {
        tail = pixels(small)
        continue
      }
      tail = null
      const g = pixels(small)
      if (!first) {
        first = g
        firstTime = t
      }
      times.push(t)
      changes.push(prev ? difference(prev, g) : 0)
      coverage.push(prev ? coverageOf(prev, g) : 0)
      prev = g
      lastKept = t
      lastGray = g
      next = next === -Infinity ? t + step : next + step
      if (next <= t) next = t + step
      w.__progress = duration > 0 ? Math.min(0.9, (t / duration) * 0.9) : 0
    }
    if (!first || !lastGray) throw new Error('no video frame decoded')
    // The very last frame, when the sampling stepped past it.
    if (tail && lastTime > lastKept) {
      times.push(lastTime)
      changes.push(prev ? difference(prev, tail) : 0)
      coverage.push(prev ? coverageOf(prev, tail) : 0)
      lastGray = tail
    }

    const toBase64 = (bytes: Uint8Array) => {
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(s)
    }
    const full = new MB.CanvasSink(track)
    const png = async (t: number) => {
      const wc = await full.getCanvas(t)
      if (!wc) return ''
      const c = wc.canvas as HTMLCanvasElement | OffscreenCanvas
      const blob: Blob =
        'convertToBlob' in c
          ? await c.convertToBlob({ type: 'image/png' })
          : await new Promise<Blob>((res, rej) =>
              c.toBlob(
                (b) => (b ? res(b) : rej(new Error('toBlob failed'))),
                'image/png',
              ),
            )
      return toBase64(new Uint8Array(await blob.arrayBuffer()))
    }
    const firstPng = await png(firstTime)
    const lastPng = await png(lastTime)

    let audio = null
    const at = await input.getPrimaryAudioTrack()
    if (at && (await at.canDecode())) {
      const make = new Function(`return (${opts.meterSrc})`)() as (
        rate: number,
        channels: number,
        sub: number,
      ) => {
        push: (c: Float32Array[]) => void
        finish: () => { energies: number[][]; peak: number; samples: number }
      }
      const meter = make(at.sampleRate, at.numberOfChannels, opts.subBlock)
      const sink = new MB.AudioBufferSink(at)
      for await (const wb of sink.buffers()) {
        const b = wb.buffer as AudioBuffer
        const chans: Float32Array[] = []
        for (let c = 0; c < at.numberOfChannels; c++)
          chans.push(
            c < b.numberOfChannels ? b.getChannelData(c) : new Float32Array(0),
          )
        meter.push(chans)
      }
      audio = {
        sampleRate: at.sampleRate,
        channels: at.numberOfChannels,
        ...meter.finish(),
      }
    }
    input.dispose()
    w.__done = {
      times,
      changes,
      coverage,
      firstDeviation: deviation(first),
      lastDeviation: deviation(lastGray),
      firstTime,
      lastTime,
      firstPng,
      lastPng,
      audio,
    }
  } catch (e) {
    w.__error = String((e instanceof Error && e.stack) || e)
  }
}

export interface CheckVideoResult extends VideoFacts {
  scenes: {
    /** Frames per second the change was measured at. */
    sampleFps: number
    threshold: number
    /** The smaller change that still counts when it stands alone. */
    isolatedThreshold: number
    window: number
    changes: SceneChange[]
    perWindow: { start: number; count: number }[]
  }
  loudness: LoudnessReport | null
  posters: {
    first: { file: string; time: number; deviation: number; uniform: boolean }
    last: { file: string; time: number; deviation: number; uniform: boolean }
  }
  warnings: string[]
  outDir: string
}

/** Check a rendered video file; writes the posters and check.json into `outDir`. */
export async function checkVideo(
  browser: Browser,
  file: string,
  outDir: string,
): Promise<CheckVideoResult> {
  const facts = await probeVideoFacts(file)
  // The file's own rate, within reason: never under 10 a second unless the
  // file has fewer, never over 30, and 10 for a long file.
  const ceiling = facts.duration > 120 ? 10 : 30
  const sampleFps = Math.max(
    Math.min(10, facts.fps || 10),
    Math.min(facts.fps || 30, ceiling),
  )
  const long = Math.max(facts.width, facts.height, 1)
  const side = (n: number) =>
    Math.max(1, Math.round((n / long) * THUMB_LONG_SIDE))

  const server = await startTakeServer(dirname(resolve(file)), {
    '/check.html':
      '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body></body></html>',
  })
  const page = await browser.newPage()
  let done: DecodeDone
  try {
    await page.addInitScript(() => {
      ;(globalThis as unknown as Record<string, unknown>).__name = (
        f: unknown,
      ) => f
    })
    await page.goto(`${server.base}/check.html`)
    void page
      .evaluate(decodeInPage, {
        mbCode: await mediabunnyBundle(),
        meterSrc: String(createLoudnessMeter),
        videoUrl: `/${encodeURIComponent(basename(file))}`,
        sampleFps,
        thumbW: side(facts.width),
        thumbH: side(facts.height),
        subBlock: SUB_BLOCK_SECONDS,
        cellChanged: CELL_CHANGED_AT,
      })
      .catch(() => {})
    done = (await waitForPageDone(
      page,
      'check-video',
      () => {},
      120_000 + facts.duration * 4_000,
    )) as unknown as DecodeDone
  } finally {
    await page.close()
    server.close()
  }

  await mkdir(outDir, { recursive: true })
  const firstFile = join(outDir, 'first.png')
  const lastFile = join(outDir, 'last.png')
  await writeFile(firstFile, Buffer.from(done.firstPng, 'base64'))
  await writeFile(lastFile, Buffer.from(done.lastPng, 'base64'))

  const changes = sceneChanges(done.times, done.changes, done.coverage)
  const loudness = done.audio
    ? loudnessFromEnergies(done.audio.energies, done.audio.peak)
    : null
  const round2 = (n: number) => Math.round(n * 100) / 100
  const posters = {
    first: {
      file: firstFile,
      time: round2(done.firstTime),
      deviation: round2(done.firstDeviation),
      uniform: posterWarning('first', done.firstDeviation) !== null,
    },
    last: {
      file: lastFile,
      time: round2(done.lastTime),
      deviation: round2(done.lastDeviation),
      uniform: posterWarning('last', done.lastDeviation) !== null,
    },
  }
  const warnings = [
    ...sceneWarnings(changes),
    ...(loudness ? loudnessWarnings(loudness) : []),
    ...[
      posterWarning('first', done.firstDeviation),
      posterWarning('last', done.lastDeviation),
    ].filter((w): w is string => w !== null),
  ]
  const result: CheckVideoResult = {
    ...facts,
    scenes: {
      sampleFps: round2(sampleFps),
      threshold: SCENE_CHANGE_AT,
      isolatedThreshold: ISOLATED_CHANGE_AT,
      window: SCENE_WINDOW,
      changes: changes.map((c) => ({ ...c, time: round2(c.time) })),
      perWindow: windowCounts(changes, facts.duration),
    },
    loudness,
    posters,
    warnings,
    outDir,
  }
  await writeFile(
    join(outDir, 'check.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  )
  return result
}

const mb = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`

/** The human summary of a check, one fact per line. */
export function checkVideoLines(r: CheckVideoResult): string {
  const codecs = [
    r.video.codecString ?? r.video.codec ?? 'unknown',
    ...(r.audio ? [r.audio.codecString ?? r.audio.codec ?? 'unknown'] : []),
  ].join(' + ')
  const cuts = r.scenes.changes
  const l = r.loudness
  const st = l?.shortTerm.map((s) =>
    s.loudness === null ? '-' : String(s.loudness),
  )
  return [
    `Checked ${r.file}: ${r.duration.toFixed(2)}s, ${r.width}x${r.height} @ ${r.fps} fps, ${mb(r.bytes)}, ${codecs}`,
    `  scene changes: ${cuts.length}${cuts.length ? ` (${cuts.map((c) => `${c.time.toFixed(2)}s`).join(', ')})` : ''}; per ${r.scenes.window} s: ${r.scenes.perWindow.map((w) => w.count).join(', ')}`,
    r.audio
      ? `  loudness: ${l?.integrated ?? 'silent'}${l?.integrated !== null ? ' LUFS' : ''} integrated; short-term every 3 s: ${st?.join(', ')}; sample peak ${l?.samplePeakDb ?? '-inf'} dBFS`
      : '  loudness: no audio track',
    `  posters: ${r.posters.first.file} (deviation ${r.posters.first.deviation}), ${r.posters.last.file} (deviation ${r.posters.last.deviation})`,
    `  ${r.warnings.length ? `${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}` : 'no warnings'}; ${join(r.outDir, 'check.json')}`,
  ].join('\n')
}

export async function cmdCheckVideo(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS)
  const file = positionals[0]
  if (!file)
    throw new UsageError(
      'vos check-video <file.mp4|webm> [--out dir] [--strict] [--json]',
    )
  if (!existsSync(file)) throw new UsageError(`${file} does not exist`)
  const r = createReporter(flags.json === true)
  const strict = flags.strict === true
  const outDir = resolve(
    strFlag(flags, 'out') ??
      join(dirname(file), `${basename(file, extname(file))}-check`),
  )
  const browser = await launchBrowser()
  try {
    r.event({ event: 'phase', phase: 'check-video' })
    const result = await checkVideo(browser, file, outDir)
    for (const w of result.warnings) r.warn(w)
    r.done({ ...result }, checkVideoLines(result))
    return result.warnings.length && strict ? EXIT_USAGE : EXIT_OK
  } finally {
    await browser.close()
  }
}
