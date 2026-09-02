import { describe, expect, it } from 'vitest'
import { camLane, videoLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'
import type { Segment } from '@vosjs/timeline'

function makeDoc(segments: Segment[], camWindow?: Segment): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 30_000,
        width: 1600,
        height: 900,
        fps: 30,
      },
      camKey: 'blob:cam',
    },
    segments,
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: { ...DEFAULT_CAM_STYLE, window: camWindow },
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

// Three cuts: A=[0,5) B=[10,14) C=[20,26) → output starts 0, 5, 9; total 15.
const SEGS: Segment[] = [
  { in: 0, out: 5 },
  { in: 10, out: 14 },
  { in: 20, out: 26 },
]

describe('videoLane move (reorder cuts)', () => {
  const doc = makeDoc(SEGS)

  it('drags the first segment to the end', () => {
    const d = structuredClone(doc)
    videoLane.gesture(doc, { type: 'move', id: 'seg-0', t: 14 })!(d)
    expect(d.segments).toEqual([SEGS[1], SEGS[2], SEGS[0]])
  })

  it('drags the last segment to the front', () => {
    const d = structuredClone(doc)
    videoLane.gesture(doc, { type: 'move', id: 'seg-2', t: 0 })!(d)
    expect(d.segments).toEqual([SEGS[2], SEGS[0], SEGS[1]])
  })

  it('same-slot drop is a no-op (null recipe)', () => {
    expect(
      videoLane.gesture(doc, { type: 'move', id: 'seg-1', t: 5.2 }),
    ).toBeNull()
  })

  it('single-segment docs are not movable', () => {
    const single = makeDoc([{ in: 0, out: 30 }])
    expect(
      videoLane.gesture(single, { type: 'move', id: 'seg-0', t: 99 }),
    ).toBeNull()
  })
})

describe('camLane move (slide the visibility window)', () => {
  it('keeps the source span and retargets the start', () => {
    const doc = makeDoc(SEGS, { in: 10, out: 12 }) // 2s window inside segment B
    const d = structuredClone(doc)
    // drag to output t=1 → source t=1 (inside segment A)
    // the 2s window sits inside segment B (index 1) → its one clip is cam-1
    camLane.gesture(doc, { type: 'move', id: 'cam-1', t: 1 })!(d)
    expect(d.cam.window).toEqual({ in: 1, out: 3 })
  })

  it('clamps into the KEPT footage (window ends where the last cut ends)', () => {
    const doc = makeDoc(SEGS, { in: 10, out: 12 })
    const d = structuredClone(doc)
    camLane.gesture(doc, { type: 'move', id: 'cam-1', t: 1e6 })!(d)
    expect(d.cam.window).toEqual({ in: 24, out: 26 }) // last kept source is 26, span 2
  })
})
