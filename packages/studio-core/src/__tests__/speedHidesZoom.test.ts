import { describe, expect, it } from 'vitest'
import { speedLane, tiltLane, zoomLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

/**
 * Adding a Speed span emptied the whole Zoom lane, and removing it brought
 * every clip back — so the spans were never deleted, they simply stopped
 * being rendered. Tilt, which runs the byte-identical
 * `ratedSegments` + `spanOutputExtent` pair in its own `items()`, was
 * unaffected, which is what makes this worth pinning: the two lanes agree on
 * the code and disagreed on the outcome.
 */
function makeDoc(): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 23_000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 23 }],
    zoom: [
      { id: 'z1', in: 0, out: 3, level: 1.8, cx: 0.5, cy: 0.5 },
      { id: 'z2', in: 4, out: 5, level: 1.8, cx: 0.5, cy: 0.5 },
      { id: 'z3', in: 6, out: 7, level: 1.8, cx: 0.5, cy: 0.5 },
      { id: 'z4', in: 11, out: 12, level: 1.8, cx: 0.5, cy: 0.5 },
    ],
    tilt: [
      { id: 't1', in: 0, out: 3, rx: 6, ry: -9 },
      { id: 't2', in: 5, out: 6, rx: 6, ry: -9 },
    ],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  } as ProjectDoc
}

/** Apply a lane gesture the way the timeline does, via its recipe. */
function apply(
  doc: ProjectDoc,
  lane: typeof speedLane,
  g: Parameters<typeof speedLane.gesture>[1],
): ProjectDoc {
  const recipe = lane.gesture(doc, g)
  if (!recipe) throw new Error('lane refused the gesture')
  const next = structuredClone(doc)
  recipe(next)
  return next
}

describe('a speed span must not hide the zoom lane', () => {
  it('renders every zoom clip before any speed span exists', () => {
    expect(zoomLane.items(makeDoc()).map((i) => i.id)).toEqual([
      'z1',
      'z2',
      'z3',
      'z4',
    ])
  })

  it('still renders every zoom clip after a speed span is added', () => {
    const withSpeed = apply(makeDoc(), speedLane, { type: 'create', t: 1 })
    expect(withSpeed.speed?.length ?? 0).toBeGreaterThan(0)
    expect(zoomLane.items(withSpeed).map((i) => i.id)).toEqual([
      'z1',
      'z2',
      'z3',
      'z4',
    ])
  })

  it('treats tilt the same way, since it shares the code path', () => {
    const withSpeed = apply(makeDoc(), speedLane, { type: 'create', t: 1 })
    expect(tiltLane.items(withSpeed).map((i) => i.id)).toEqual(['t1', 't2'])
  })
})
