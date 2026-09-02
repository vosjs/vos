/**
 * Render — lower the take's ProjectDoc to the studio composition, compile it,
 * and run the deterministic export frame-loop (seek → settle → capture →
 * mediabunny mux) through the shared renderAnimation harness. Same pipeline
 * as the studio's export; --parallel N shards the timeline into concurrent
 * chunk pages (see renderAnimation.ts).
 */
import { writeFile } from 'node:fs/promises'
import { compileVosConfig } from '@vosjs/core'
import {
  audioProducerCode,
  dataHasAudio,
  studioEntryData,
} from '@vosjs/render-core'
import {
  lowerToComposition,
  resolveExportSize,
  studioAudioPlan,
} from '@vosjs/studio-core'
import { RECORDING_NAME, loadTake } from './take'
import { renderAnimation } from './renderAnimation'
import {
  applyAndValidate,
  hasOverrides,
  resolveBackdropSlug,
} from './docOverride'
import type { EnvelopePoint, LoweredAudioClip } from '@vosjs/studio-core'
import type { DocOverrides } from './docOverride'
import type { Browser } from 'playwright'

const VIDEO_TOKEN = '__VOILA_CLI_VIDEO__'

export interface RenderTakeOptions {
  width?: number
  height?: number
  fps?: number
  format?: 'webm' | 'mp4'
  /** Concurrent chunk renders (timeline sharding); 1 = single-flight. */
  parallel?: number
  /** OUTPUT-time subrange [start, end) seconds — spot-check a doc edit cheaply. */
  range?: [number, number]
  /** Draft mode: half resolution + low bitrate, for iteration only. */
  draft?: boolean
  /** Encoder bitrate override (a destination's byte ceiling as a budget). */
  bitrate?: number
  /** In-memory doc overrides (--set / --frame / --background); lint-gated. */
  overrides?: DocOverrides
  onPhase?: (phase: string) => void
  onProgress?: (fraction: number) => void
}

export interface RenderTakeResult {
  out: string
  bytes: number
  width: number
  height: number
  fps: number
  duration: number
  zoomSpans: number
  clicks: number
  /** Number of chunks rendered (1 unless --parallel raised it). */
  chunks: number
  /** An audio track was mixed + muxed (doc.audio clips / mic). */
  audio: boolean
}

export async function renderTake(
  browser: Browser,
  dir: string,
  outFile: string,
  opts: RenderTakeOptions,
): Promise<RenderTakeResult> {
  const take = await loadTake(dir)
  if (!take.doc) throw new Error(`${dir} has no doc.json — run plan first`)
  const doc = take.doc

  // Product-surface overrides (--set/--frame/--background): patch the doc in
  // memory + lint before anything renders (doc.json on disk is untouched).
  if (opts.overrides && hasOverrides(opts.overrides)) {
    await resolveBackdropSlug(opts.overrides)
    applyAndValidate(doc, opts.overrides)
  }

  // Same short-edge × aspect sizing as the studio's Export button (a preset
  // alone would letterbox portrait/native docs into a fixed 16:9 canvas).
  const res = resolveExportSize(doc)
  // Draft: half resolution (even), low bitrate — iteration speed over quality.
  const half = (n: number) => Math.max(2, Math.round(n / 2 / 2) * 2)
  const width = opts.width ?? (opts.draft ? half(res.width) : res.width)
  const height = opts.height ?? (opts.draft ? half(res.height) : res.height)
  const fps = opts.fps ?? doc.export.fps
  const format = opts.format ?? 'webm'

  opts.onPhase?.('compile')
  doc.source.videoKey = VIDEO_TOKEN
  const lowered = lowerToComposition(doc)
  const animationCode = compileVosConfig(lowered.config as never, {
    tweenEngine: 'vos',
  })
  const duration = lowered.duration
  const clicks = Array.isArray(lowered.data.clicks)
    ? (lowered.data.clicks as unknown[]).length
    : 0

  // Range render: clamp to the timeline, shift the frame clock, keep output
  // timestamps zero-based (the clip plays standalone).
  let frameOffset = 0
  let renderDuration = duration
  if (opts.range) {
    const start = Math.max(0, Math.min(opts.range[0], duration))
    const end = Math.max(start, Math.min(opts.range[1], duration))
    if (end - start <= 0)
      throw new Error(
        `--range ${opts.range[0]}..${opts.range[1]} is empty for a ${duration.toFixed(1)}s timeline`,
      )
    frameOffset = Math.round(start * fps)
    renderDuration = end - start
  }

  // Audio (doc.audio clips / mic) muxes in the SAME render — single-flight
  // only: chunks stay silent by design. A --range clip keeps its audio: the
  // producer mixes the whole timeline and the page slices the range window
  // (a cut-down is a deliverable, not just a spot check).
  let parallel = opts.parallel
  // The clips ride the studio stack entry, rendered as ONE engine
  // audio plan (studio-core builds it, the page's producer mixes it).
  const studioEntry = studioEntryData(lowered.stack)
  const studioClips = Array.isArray(studioEntry?.audio)
    ? (studioEntry.audio as LoweredAudioClip[])
    : []
  const audioPlan = studioClips.length
    ? studioAudioPlan(
        studioClips,
        Array.isArray(studioEntry?.duckEnv)
          ? (studioEntry.duckEnv as EnvelopePoint[])
          : [],
        duration,
      )
    : null
  const audioWanted = dataHasAudio(lowered.data, undefined, audioPlan)
  if (audioWanted && (parallel ?? 1) > 1) {
    parallel = 1
    opts.onPhase?.(
      'note: audio present — forcing single-flight (--parallel ignored)',
    )
  }

  opts.onPhase?.('render')
  const result = await renderAnimation(browser, {
    animationCode,
    workDir: dir,
    videoFile: RECORDING_NAME,
    videoToken: VIDEO_TOKEN,
    width,
    height,
    fps,
    duration: renderDuration,
    format,
    parallel,
    frameOffset,
    bitrate: opts.bitrate ?? (opts.draft ? 3_000_000 : undefined),
    audio: audioWanted
      ? {
          producerCode: audioProducerCode({ plan: audioPlan }),
          data: lowered.data,
          duration,
        }
      : undefined,
    onProgress: opts.onProgress,
  })
  await writeFile(outFile, result.bytes)

  return {
    out: outFile,
    bytes: result.bytes.length,
    width,
    height,
    fps,
    duration: renderDuration,
    zoomSpans: doc.zoom.length,
    clicks,
    chunks: result.chunks,
    audio: audioWanted,
  }
}
