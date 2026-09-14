import { describe, expect, it } from 'vitest'
import { lerpArray, sample } from '@vosjs/timeline'
import type { KeyframeTrack } from '@vosjs/timeline'
import { computeCardLayout } from '../layout'
import { followFocusEvents } from '../lower/cursorFollow'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DRAG_MIN_TRAVEL_FRAC,
  dragsFromTrack,
  planAutoZoom,
} from '../planner/autoZoom'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { ZOOM_STYLES } from '../zoomStyle'
import type { CursorTrack, ProjectDoc, ZoomSpan } from '../types'

/**
 * A drag (a press that travels before its release) is followed: the planner
 * turns it into one follow span at the style's dragLevel and takes its press
 * out of the click clusters; the lowering's follow bakes a path sample every
 * FOLLOW_PATH_STEP through the press; the zoom track pans through those
 * samples linearly. A press held still stays a click.
 */
const W = 1920
const H = 1080

/** A slider drag: press at 47 % of the width, travel right to 65 % over 1 s
 *  (inside the stage camera's cover band, where a follow can pan). */
function sliderDrag(t0 = 2000, dur = 1000): CursorTrack {
  const track: CursorTrack = [
    { t: 0, x: 200, y: 300, type: 'move' },
    { t: t0 - 100, x: 900, y: 420, type: 'move' },
    {
      t: t0,
      x: 900,
      y: 420,
      type: 'down',
      rect: { x: 892, y: 412, w: 16, h: 16 },
    },
  ]
  const steps = 10
  for (let i = 1; i <= steps; i++) {
    track.push({
      t: t0 + (dur * i) / steps,
      x: 900 + (350 * i) / steps,
      y: 420,
      type: 'move',
    })
  }
  track.push({ t: t0 + dur, x: 1250, y: 420, type: 'up' })
  track.push({ t: t0 + dur + 1500, x: 1250, y: 420, type: 'move' })
  return track
}

/** A click: press and release in place, 120 ms apart. */
function click(t0 = 2000): CursorTrack {
  return [
    { t: 0, x: 200, y: 300, type: 'move' },
    {
      t: t0,
      x: 400,
      y: 300,
      type: 'down',
      rect: { x: 360, y: 280, w: 80, h: 40 },
    },
    { t: t0 + 120, x: 400, y: 300, type: 'up' },
  ]
}

describe('dragsFromTrack', () => {
  it('finds a press that travels before its release', () => {
    const drags = dragsFromTrack(sliderDrag(), W, H)
    expect(drags).toHaveLength(1)
    expect(drags[0].t0).toBeCloseTo(2, 6)
    expect(drags[0].t1).toBeCloseTo(3, 6)
    expect(drags[0].travel).toBeCloseTo(350 / W, 6)
    expect(drags[0].travel).toBeGreaterThan(DRAG_MIN_TRAVEL_FRAC)
    expect(drags[0].nx).toBeCloseTo(900 / W, 6)
  })

  it('a press held still is not a drag, nor is a flick shorter than DRAG_MIN_S', () => {
    expect(dragsFromTrack(click(), W, H)).toHaveLength(0)
    expect(dragsFromTrack(sliderDrag(2000, 100), W, H)).toHaveLength(0)
  })
})

describe('planAutoZoom with a drag', () => {
  it('plans one follow span at the drag level and no click span for the press', () => {
    const spans = planAutoZoom(sliderDrag(), { width: W, height: H })
    const g = spans.filter((s) => s.id.startsWith('g'))
    const z = spans.filter((s) => s.id.startsWith('z'))
    expect(g).toHaveLength(1)
    expect(z).toHaveLength(0)
    expect(g[0].level).toBeCloseTo(ZOOM_STYLES.glide.dragLevel, 6)
    expect(g[0].focusMode).toBe('auto')
    expect(g[0].in).toBeCloseTo(2 - ZOOM_STYLES.glide.lead, 3)
    expect(g[0].out).toBeCloseTo(3 + ZOOM_STYLES.glide.hold, 3)
    expect(g[0].cx).toBeCloseTo(900 / W, 3)
  })

  it('a plain click still plans a click span', () => {
    const spans = planAutoZoom(click(), { width: W, height: H })
    expect(spans.some((s) => s.id.startsWith('z'))).toBe(true)
    expect(spans.some((s) => s.id.startsWith('g'))).toBe(false)
  })
})

describe('the follow through a drag', () => {
  const layout = computeCardLayout(
    DEFAULT_FRAME_STYLE,
    { width: W, height: H },
    W,
    H,
  )
  const span: ZoomSpan = {
    id: 'g0',
    in: 1.65,
    out: 4.2,
    level: 1.5,
    cx: 900 / W,
    cy: 420 / H,
    focusMode: 'auto',
  }

  it('bakes a path sample every step through the press and none after the release', () => {
    const { events } = followFocusEvents(
      span,
      sliderDrag(),
      { w: W, h: H },
      layout,
      {
        camera: 'stage',
      },
    )
    const path = events.filter((e) => e.path)
    expect(path.length).toBe(11) // 2.0 .. 3.0 at 0.1 s
    expect(path[0].t).toBeCloseTo(2, 3)
    expect(path[path.length - 1].t).toBeCloseTo(3, 3)
    // The focus travels with the pointer: monotonic in x, still in y.
    for (let i = 1; i < path.length; i++) {
      expect(path[i].cx).toBeGreaterThanOrEqual(path[i - 1].cx - 1e-9)
      expect(path[i].cy).toBeCloseTo(path[0].cy, 3)
    }
    expect(path[path.length - 1].cx - path[0].cx).toBeGreaterThan(0.12)
    // No dead-zone recenter fires inside the press.
    expect(events.filter((e) => !e.path && e.t >= 2 && e.t <= 3)).toHaveLength(
      0,
    )
  })

  it('the zoom track pans through the path, linearly between samples', () => {
    const doc: ProjectDoc = {
      source: {
        videoKey: 'blob:video',
        cursor: sliderDrag(),
        meta: {
          dpr: 1,
          zoom: 1,
          t0: 0,
          durationMs: 6000,
          width: W,
          height: H,
          fps: 30,
        },
      },
      segments: [{ in: 0, out: 6 }],
      zoom: [span],
      audio: [],
      cursor: DEFAULT_CURSOR_STYLE,
      cam: DEFAULT_CAM_STYLE,
      frame: DEFAULT_FRAME_STYLE,
      export: { resolution: '1080p', fps: 60, format: 'mp4' },
    }
    const track = lowerToComposition(doc).data.zoomTrack as KeyframeTrack<
      number[]
    >
    const linear = track.keyframes.filter((k) => k.ease === 'linear')
    expect(linear.length).toBeGreaterThanOrEqual(9)
    // Sampled through the press the focus advances with the pointer.
    const a = sample(track, 2.2, lerpArray)
    const b = sample(track, 2.6, lerpArray)
    const c = sample(track, 2.95, lerpArray)
    expect(b[1]).toBeGreaterThan(a[1])
    expect(c[1]).toBeGreaterThan(b[1])
    expect(a[0]).toBeCloseTo(1.5, 6)
    expect(c[3]).toBe(1)
  })
})
