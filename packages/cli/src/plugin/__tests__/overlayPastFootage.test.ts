import { describe, expect, it } from 'vitest'
import { lintDoc } from '../validateDoc'
import type { ProjectDoc } from '@vosjs/studio-core'

/** Minimal doc: 20 s of 1280×720 footage. */
function makeDoc(over: Record<string, unknown> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:recording',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1280,
        height: 720,
        fps: 30,
        hasAudio: false,
        captureWidth: 1280,
        captureHeight: 720,
      },
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio: [],
    cursor: { smoothing: 0.5, size: 1 },
    cam: {},
    frame: {
      background: '#111',
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'auto',
      browserBar: { kind: 'none' },
    },
    export: { resolution: '720p', fps: 30, format: 'mp4' },
    ...over,
  } as unknown as ProjectDoc
}

const text = (start: number, duration: number) => ({
  id: 'note',
  kind: 'text',
  text: 'Hello',
  start,
  duration,
  transform: { x: 0.5, y: 0.5 },
})
const aboutFootage = (warnings: string[]) =>
  warnings.filter((w) => w.includes('the footage'))

describe('a layer that outlives the footage', () => {
  // A head trim moves the footage and never an OUTPUT-anchored layer: a note
  // composed against 20 s of footage sits past the end of the 6.4 s kept.
  it('warns, and never refuses, when a layer starts after the footage', () => {
    const r = lintDoc(
      makeDoc({ segments: [{ in: 6.4, out: 12.8 }], overlays: [text(9, 3)] }),
    )
    expect(r.problems).toEqual([])
    const [w] = aboutFootage(r.warnings)
    expect(w).toContain('overlays[0] starts at 9.00s')
    expect(w).toContain('(6.40s)')
    expect(w).toContain('lengthens the output by 5.60s')
  })

  it('names the overhang of a layer that runs past the end', () => {
    const r = lintDoc(makeDoc({ overlays: [text(18, 3.4)] }))
    expect(r.problems).toEqual([])
    expect(aboutFootage(r.warnings)[0]).toContain(
      'ends 1.40s after the footage (20.00s)',
    )
  })

  it('is silent for a layer inside the footage, to the last frame', () => {
    const r = lintDoc(makeDoc({ overlays: [text(17, 3)] }))
    expect(aboutFootage(r.warnings)).toEqual([])
  })

  // An end card is a freeze under its words: the freeze IS footage.
  it('counts a freeze as footage', () => {
    const r = lintDoc(
      makeDoc({
        freeze: [{ id: 'f1', at: 20, seconds: 3 }],
        overlays: [text(20.2, 2.6)],
      }),
    )
    expect(aboutFootage(r.warnings)).toEqual([])
  })
})
