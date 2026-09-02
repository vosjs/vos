/**
 * The digest document (digest.json), assembled from a take's doc, the
 * planners' proposals, the moments, and whatever a decode pass measured —
 * one pure builder for the CLI and the fleet, so a hosted digest
 * is byte-comparable with a local one. `images` maps moment ids to the
 * files a page wrote and their sizes; a builder with none (no frames) emits
 * a frameless digest.
 */
import { totalDuration } from '@vosjs/timeline'
import { ratedSegments } from '../lower/lowerToComposition'
import { pickStyle } from './style'
import type { ProjectDoc } from '../types'
import type { DigestPlan, Moment, TranscriptSegment } from './moments'
import type { PxRect } from './geometry'

export const DIGEST_VERSION = 1

export interface DigestImageRef {
  full: string | null
  crop: string | null
  /** The crop's source box in FRAME px (what `crop` shows). */
  box: PxRect | null
  fullSize?: { width: number; height: number } | null
  cropSize?: { width: number; height: number } | null
}

export interface DigestTakeFacts {
  sourceDuration: number
  outputDuration: number
  width: number
  height: number
  captureWidth: number | null
  captureHeight: number | null
  frameWidth: number | null
  frameHeight: number | null
  surface: string
  producer: string
  pageUrl: string | null
  pageTitle: string | null
  hasMic: boolean
  hasSystemAudio: boolean
  hasCursor: boolean
  windowFocusedFrac: number | null
}

export interface Digest {
  digestVersion: number
  take: DigestTakeFacts
  units: {
    source: 'seconds of footage'
    output: 'seconds of the rendered video (trims and speed applied)'
    focus: 'fractions of the video frame [0..1], the zoom cx/cy convention'
    activity: 'fraction of pixels that changed, per SOURCE second'
  }
  moments: (Moment & {
    full: string | null
    crop: string | null
    box: PxRect | null
  })[]
  activity: number[] | null
  plan: DigestPlan
  doc: {
    manual: { zoom: number; speed: number; tilt: number; overlays: number }
    zoomStyle: string | null
    tiltStyle: string | null
  }
  style: { from: string; fields: Record<string, unknown> } | null
  transcript: TranscriptSegment[] | null
  images: {
    full: number
    crop: number
    sheet: string | null
    tokensEstimateClaude: number
  }
}

export interface BuildDigestInput {
  doc: ProjectDoc
  plan: DigestPlan
  moments: Moment[]
  outputDuration: number
  bins: number[] | null
  frame: { width: number; height: number } | null
  images: Map<string, DigestImageRef>
  sheet: string | null
  style?: { from: string; doc: ProjectDoc } | null
  transcript?: readonly TranscriptSegment[] | null
}

export function buildDigest(input: BuildDigestInput): Digest {
  const { doc, meta } = { doc: input.doc, meta: input.doc.source.meta }
  let tokens = 0
  const withFiles = input.moments.map((m) => {
    const ref = input.images.get(m.id)
    for (const s of [ref?.fullSize, ref?.cropSize]) {
      if (s) tokens += (s.width * s.height) / 750
    }
    return {
      ...m,
      full: ref?.full ?? null,
      crop: ref?.crop ?? null,
      box: ref?.crop ? (ref.box ?? null) : null,
    }
  })
  return {
    digestVersion: DIGEST_VERSION,
    take: {
      sourceDuration: round(meta.durationMs / 1000),
      outputDuration: round(input.outputDuration),
      width: meta.width,
      height: meta.height,
      captureWidth: meta.captureWidth ?? null,
      captureHeight: meta.captureHeight ?? null,
      frameWidth: input.frame?.width ?? null,
      frameHeight: input.frame?.height ?? null,
      surface: meta.captureSurface ?? 'tab',
      producer: meta.producer ?? 'extension',
      pageUrl: meta.pageUrl ?? null,
      pageTitle: meta.pageTitle ?? null,
      hasMic: Boolean(doc.source.micKey) || meta.hasMic === true,
      hasSystemAudio: meta.hasAudio === true,
      hasCursor: doc.source.cursor.length > 0,
      windowFocusedFrac: meta.windowFocusedFrac ?? null,
    },
    units: {
      source: 'seconds of footage',
      output: 'seconds of the rendered video (trims and speed applied)',
      focus: 'fractions of the video frame [0..1], the zoom cx/cy convention',
      activity: 'fraction of pixels that changed, per SOURCE second',
    },
    moments: withFiles,
    activity: input.bins,
    plan: input.plan,
    doc: {
      manual: {
        zoom: doc.zoom.filter((z) => z.source === 'manual').length,
        speed: (doc.speed ?? []).filter((s) => s.source !== 'auto').length,
        tilt: (doc.tilt ?? []).filter((t) => t.source === 'manual').length,
        overlays: doc.overlays?.length ?? 0,
      },
      zoomStyle: doc.zoomStyle ?? null,
      tiltStyle: doc.tiltStyle ?? null,
    },
    style: input.style
      ? { from: input.style.from, fields: pickStyle(input.style.doc) }
      : null,
    transcript: input.transcript ? [...input.transcript] : null,
    images: {
      full: withFiles.filter((m) => m.full).length,
      crop: withFiles.filter((m) => m.crop).length,
      sheet: input.sheet,
      tokensEstimateClaude: Math.round(tokens),
    },
  }
}

/** OUTPUT seconds of a doc: its kept footage through the rate map. */
export function outputDurationOf(doc: ProjectDoc): number {
  return totalDuration(ratedSegments(doc))
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
