/**
 * `vos ingest <video> [--cursor <trace>] [--out take]` (AN6): a take
 * directory from a recording someone else made. A Cursor cloud agent's PR
 * video, a Playwright run's `video.webm`, a Loom export: the file becomes
 * `recording.<container>` stream-copied into a seekable container
 * (fail-open: an unreadable file is copied as it is), `meta.json` comes
 * from the file's own dimensions and duration, and a trace beside it
 * (`--cursor`: a Playwright `trace.zip`, a `steps.jsonl` of stamped
 * records, or a CSV of `t,x,y,type`) becomes `cursor.json`, so the
 * planner has clicks to zoom on. Without a trace the take has no cursor
 * track and the doc plans nothing, which the done event says: every zoom
 * is then placed by eye.
 *
 * The adapters are `@vosjs/studio-core`'s (pure; the studio's drop zone
 * runs the same ones); this file owns the filesystem, mediabunny and zlib.
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import {
  cursorFromPlaywrightTrace,
  cursorFromTrace,
  playwrightTraceEntry,
  traceKindOf,
  zipEntries,
  zipEntryBytes,
} from '@vosjs/studio-core'
import {
  ALL_FORMATS,
  Conversion,
  FilePathSource,
  FilePathTarget,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import { UsageError, numFlag, parseArgs, strFlag } from './args'
import { EXIT_OK, createReporter } from './output'
import { planTake } from './plan'
import { MULTI_FLAGS, takeBackdrop } from './run'
import { ensureTakeDir, prepareReRecord, writeJson } from './take'
import type { RecordingMeta, TraceResult } from '@vosjs/studio-core'

const BOOLEAN_FLAGS = new Set(['json', 'help'])

export interface ProbedVideo {
  width: number
  height: number
  durationMs: number
  fps: number
  hasAudio: boolean
  /** The container's mime type, as mediabunny read it. */
  mimeType: string
  /** The file extension the container is named by. */
  ext: 'webm' | 'mp4' | 'mov'
}

/** The file's own facts: dimensions, length, frame rate, audio, container. */
export async function probeVideoFile(path: string): Promise<ProbedVideo> {
  const input = new Input({
    source: new FilePathSource(path),
    formats: ALL_FORMATS,
  })
  try {
    const format = await input.getFormat()
    const video = await input.getPrimaryVideoTrack()
    if (!video) throw new UsageError(`${path} has no video track`)
    const [duration, stats, audio] = await Promise.all([
      input.computeDuration(),
      video.computePacketStats(240),
      input.getPrimaryAudioTrack(),
    ])
    const mimeType = format.mimeType
    const ext = mimeType.includes('mp4')
      ? 'mp4'
      : mimeType.includes('quicktime')
        ? 'mov'
        : 'webm'
    return {
      width: video.displayWidth,
      height: video.displayHeight,
      durationMs: Math.round(duration * 1000),
      fps: Math.round(stats.averagePacketRate * 100) / 100,
      hasAudio: !!audio,
      mimeType,
      ext,
    }
  } finally {
    await input.dispose?.()
  }
}

/**
 * Stream-copy the recording into an indexed container of the same kind
 * (a Playwright or MediaRecorder file has no seek index), or copy it as
 * it is when mediabunny cannot keep every track. Answers whether it remuxed.
 */
export async function copyRecording(
  src: string,
  dest: string,
  ext: ProbedVideo['ext'],
): Promise<boolean> {
  if (ext === 'mov') {
    await copyFile(src, dest)
    return false
  }
  const input = new Input({
    source: new FilePathSource(src),
    formats: ALL_FORMATS,
  })
  const target = new FilePathTarget(dest)
  const output = new Output({
    format:
      ext === 'mp4'
        ? new Mp4OutputFormat({ fastStart: 'in-memory' })
        : new WebMOutputFormat(),
    target,
  })
  try {
    const conversion = await Conversion.init({ input, output })
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      await conversion.cancel?.()
      await copyFile(src, dest)
      return false
    }
    await conversion.execute()
    return true
  } catch {
    await copyFile(src, dest)
    return false
  } finally {
    await input.dispose?.()
  }
}

/** Read a trace file by its name: a zip is opened for its Playwright trace. */
export async function readTraceFile(
  path: string,
  offsetMs: number,
): Promise<TraceResult> {
  const kind = traceKindOf(basename(path))
  if (!kind) {
    throw new UsageError(
      `${path}: not a trace the recorder reads (trace.zip, .trace, .jsonl, .json or .csv)`,
    )
  }
  if (kind === 'zip') {
    const bytes = new Uint8Array(await readFile(path))
    const entry = playwrightTraceEntry(zipEntries(bytes))
    if (!entry) {
      throw new UsageError(
        `${path}: no trace.trace inside; a Playwright trace.zip is what --cursor reads as a zip`,
      )
    }
    const raw = zipEntryBytes(bytes, entry)
    const text = new TextDecoder().decode(
      entry.method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw,
    )
    return cursorFromPlaywrightTrace(text, { offsetMs })
  }
  const text = await readFile(path, 'utf8')
  return cursorFromTrace(basename(path), text, { offsetMs })
}

function parseViewport(
  v: string | undefined,
): { width: number; height: number } | null {
  if (!v) return null
  const m = /^(\d+)x(\d+)$/i.exec(v.trim())
  if (!m) throw new UsageError('--viewport expects WxH, like 1280x720')
  return { width: Number(m[1]), height: Number(m[2]) }
}

export async function cmdIngest(argv: string[]): Promise<number> {
  const { positionals, flags } = parseArgs(argv, BOOLEAN_FLAGS, MULTI_FLAGS)
  const source = positionals[0]
  if (!source)
    throw new UsageError(
      'vos ingest <video.webm|mp4> [--cursor <trace.zip|steps.jsonl|cursor.csv>] [--out take] [--offset <ms>] [--viewport WxH] [--background <slug|url|none>] [--json]',
    )
  const videoPath = resolve(source)
  if (!existsSync(videoPath)) throw new UsageError(`${source}: no such file`)
  const r = createReporter(flags.json === true)
  const outDir = resolve(strFlag(flags, 'out') ?? 'take')
  const offsetMs = numFlag(flags, 'offset', 0)
  const viewportFlag = parseViewport(strFlag(flags, 'viewport'))
  const cursorPath = strFlag(flags, 'cursor')
  const backdrop = await takeBackdrop(flags, r)

  r.log(`probing ${basename(videoPath)}…`)
  const probed = await probeVideoFile(videoPath)
  if (!(probed.durationMs > 0)) {
    throw new UsageError(
      `${source}: the file reports no duration; a stream-shaped recording needs its container fixed first (ffmpeg -i in.webm -c copy out.webm)`,
    )
  }

  // The trace first, so a bad one costs nothing: no directory is touched.
  let trace: TraceResult | null = null
  if (cursorPath) {
    trace = await readTraceFile(resolve(cursorPath), offsetMs)
    for (const n of trace.notes) r.log(`note: ${n}`)
  }

  if (existsSync(join(outDir, 'meta.json'))) {
    const { prevDoc, kept } = await prepareReRecord(outDir)
    r.log(
      `note: re-ingesting into ${outDir}; kept ${kept.length ? kept.join(', ') : 'nothing'}` +
        (prevDoc
          ? `; apply the previous cut with: vos plan ${outDir} --reuse`
          : ''),
    )
  }
  await mkdir(outDir, { recursive: true })
  const paths = await ensureTakeDir(outDir)
  // The recording is named by its container, never by a convention: a take
  // whose file says webm while its bytes are mp4 renders nothing.
  const recording = join(outDir, `recording.${probed.ext}`)
  r.log('copying the recording…')
  const remuxed = await copyRecording(videoPath, recording, probed.ext)

  const viewport = viewportFlag ??
    trace?.viewport ?? {
      width: probed.width,
      height: probed.height,
    }
  const events = trace?.events ?? []
  const fileStat = await stat(videoPath)
  const meta: RecordingMeta = {
    dpr: 1,
    zoom: 1,
    t0: trace?.t0 ?? Math.round(fileStat.mtimeMs),
    durationMs: probed.durationMs,
    width: viewport.width,
    height: viewport.height,
    captureWidth: probed.width,
    captureHeight: probed.height,
    fps: probed.fps > 0 ? probed.fps : 30,
    hasAudio: probed.hasAudio,
    producer: 'ingest',
    ...(events.length ? { captureSurface: 'tab' as const } : {}),
  }
  await writeJson(paths.meta, meta, true)
  if (events.length) await writeJson(paths.cursor, events)

  const plan = await planTake(outDir, { backdrop })
  const clicks = events.filter((e) => e.type === 'down').length
  const seconds = (probed.durationMs / 1000).toFixed(1)
  const facts = `${seconds}s, ${probed.width}×${probed.height} @ ${meta.fps} fps${probed.hasAudio ? ', audio' : ', no audio'}${remuxed ? '' : ', copied as is'}`
  const cursorLine = trace
    ? `${events.length} cursor events (${clicks} clicks) from ${basename(cursorPath!)}${trace.dropped ? `, ${trace.dropped} not placed` : ''}; ${plan.zoomAuto} zoom${plan.zoomAuto === 1 ? '' : 's'} planned`
    : 'no cursor track, so nothing was planned'
  const next = trace
    ? `Next: vos digest ${outDir} — look before you cut; edit doc.json; vos push ${outDir}`
    : `Add --cursor <trace> recorded beside the video (a Playwright trace.zip, stamped JSON records, or a t,x,y,type CSV) to plan zooms from its clicks; else place them by eye: vos frames ${outDir} --times 0,25%,50%,75%,100%, then edit doc.json`
  r.done(
    {
      out: outDir,
      recording: basename(recording),
      durationMs: probed.durationMs,
      width: probed.width,
      height: probed.height,
      viewport,
      fps: meta.fps,
      hasAudio: probed.hasAudio,
      remuxed,
      cursor: trace
        ? {
            file: basename(cursorPath!),
            kind: trace.kind,
            events: events.length,
            clicks,
            placed: trace.placed,
            dropped: trace.dropped,
            notes: trace.notes,
          }
        : null,
      zooms: plan.zoomAuto,
      backdrop: plan.backdrop ?? null,
    },
    `Ingested ${basename(videoPath)} → ${outDir}/${basename(recording)} (${facts})\n  ${cursorLine}\n  ${next}`,
  )
  return EXIT_OK
}
