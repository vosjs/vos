import { describe, expect, it } from 'vitest'
import { planFreshTake } from '../plan'
import type { RecordingMeta } from '@vosjs/studio-core'

/** The export a fresh plan opens on is the one the footage holds. */
const meta = (width: number, height: number): RecordingMeta => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs: 4000,
  width,
  height,
  fps: 30,
  captureWidth: width,
  captureHeight: height,
  captureSurface: 'tab',
  producer: 'cli',
})

const plan = (w: number, h: number) =>
  planFreshTake(
    { videoKey: 'recording.webm', cursor: [], meta: meta(w, h) },
    'recording.webm',
  )

describe('a fresh plan', () => {
  it('exports a 1280×720 take at 720p, never an upscale', () => {
    expect(plan(1280, 720).export?.resolution).toBe('720p')
  })

  it('keeps 1080p for footage that holds it', () => {
    expect(plan(1920, 1080).export?.resolution).toBe('1080p')
    expect(plan(3840, 2160).export?.resolution).toBe('1080p')
  })
})
