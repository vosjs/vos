import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  aspectRatioValue,
  resolveExportSize,
} from '../types'
import { recommendedExportResolution } from '../layout'
import type { ExportResolution, ProjectDoc } from '../types'

const makeDoc = (
  aspectRatio: string,
  resolution: ExportResolution = '1080p',
): ProjectDoc => ({
  source: {
    videoKey: 'x',
    cursor: [],
    meta: {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 1000,
      width: 1600,
      height: 1000,
      fps: 30,
    },
  },
  segments: [],
  zoom: [],
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: { ...DEFAULT_FRAME_STYLE, aspectRatio },
  export: { resolution, fps: 30, format: 'mp4' },
})

describe('aspectRatioValue', () => {
  it('resolves named ratios', () => {
    expect(aspectRatioValue('16:9', { width: 0, height: 0 })).toBeCloseTo(
      16 / 9,
    )
    expect(aspectRatioValue('1:1', { width: 0, height: 0 })).toBe(1)
    expect(aspectRatioValue('9:16', { width: 0, height: 0 })).toBeCloseTo(
      9 / 16,
    )
  })
  it('resolves native from source meta', () => {
    expect(
      aspectRatioValue('native', { width: 1600, height: 1000 }),
    ).toBeCloseTo(1.6)
  })
})

describe('resolveExportSize', () => {
  it('landscape: short edge = quality', () => {
    expect(resolveExportSize(makeDoc('16:9'))).toEqual({
      width: 1920,
      height: 1080,
    })
    expect(resolveExportSize(makeDoc('16:9', '720p'))).toEqual({
      width: 1280,
      height: 720,
    })
  })
  it('portrait: short edge stays on width', () => {
    expect(resolveExportSize(makeDoc('9:16'))).toEqual({
      width: 1080,
      height: 1920,
    })
  })
  it('square', () => {
    expect(resolveExportSize(makeDoc('1:1'))).toEqual({
      width: 1080,
      height: 1080,
    })
  })
  it('native uses the source ratio (1.6 → 1728×1080), even dims', () => {
    expect(resolveExportSize(makeDoc('native'))).toEqual({
      width: 1728,
      height: 1080,
    })
  })
  it('2k/4k: short edge 1440/2160', () => {
    expect(resolveExportSize(makeDoc('16:9', '2k'))).toEqual({
      width: 2560,
      height: 1440,
    })
    expect(resolveExportSize(makeDoc('16:9', '4k'))).toEqual({
      width: 3840,
      height: 2160,
    })
    expect(resolveExportSize(makeDoc('9:16', '4k'))).toEqual({
      width: 2160,
      height: 3840,
    })
    expect(resolveExportSize(makeDoc('native', '2k'))).toEqual({
      width: 2304,
      height: 1440,
    })
  })
  it('unknown resolution (hand-edited doc.json) falls back to 1080p', () => {
    expect(
      resolveExportSize(makeDoc('16:9', '900p' as ExportResolution)),
    ).toEqual({
      width: 1920,
      height: 1080,
    })
  })
  it('explicit resolution param overrides the doc value', () => {
    expect(resolveExportSize(makeDoc('16:9', '720p'), '4k')).toEqual({
      width: 3840,
      height: 2160,
    })
  })
})

describe('recommendedExportResolution', () => {
  // Bare frame (no padding, no bar): the card fills the canvas, so the
  // threshold is simply "output width ≤ captureWidth" and the numbers below
  // are auditable by hand. Padding/bar shrink the card and can only relax it.
  const capDoc = (
    aspectRatio: string,
    captureWidth: number,
    captureHeight: number,
  ): ProjectDoc => {
    const doc = makeDoc(aspectRatio)
    doc.source.meta = { ...doc.source.meta, captureWidth, captureHeight }
    doc.frame = {
      ...doc.frame,
      padding: 0,
      browserBar: { ...doc.frame.browserBar, kind: 'none' },
    }
    return doc
  }
  it('retina tab capture (3024×1720, native 1.758) → 2k (4k card would need 3798 px)', () => {
    const doc = capDoc('native', 3024, 1720)
    doc.source.meta.width = 1512
    doc.source.meta.height = 860
    expect(recommendedExportResolution(doc)).toBe('2k')
  })
  it('dpr-1 1080p capture at 16:9 → 1080p (2k card = 2560 px > 1920)', () => {
    expect(recommendedExportResolution(capDoc('16:9', 1920, 1080))).toBe(
      '1080p',
    )
  })
  it('full 4k capture at 16:9 → 4k', () => {
    expect(recommendedExportResolution(capDoc('16:9', 3840, 2160))).toBe('4k')
  })
  it('floors at 720p even when the capture is smaller than every card', () => {
    expect(recommendedExportResolution(capDoc('native', 800, 500))).toBe('720p')
  })
})
