import { afterEach, describe, expect, it } from 'vitest'
import {
  lerpArray,
  mapTime,
  rateAt,
  sample,
  totalDuration,
} from '@vosjs/timeline'
import { lowerToComposition, ratedSegments } from '../lower/lowerToComposition'
import {
  TRANSITION_TRAVEL,
  docTransitions,
  restSpansThroughTransitions,
} from '../lower/transitions'
import { segmentOutputExtents } from '../lower/segmentStarts'
import { videoLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  ZOOM_SPAN_MIN,
} from '../types'
import type { Media, ProjectDoc, ZoomSpan } from '../types'

/**
 * Transitions at a boundary: a footage clip's `anim` (its exit at the
 * boundary after it, its enter at the one before) lowers to a record in
 * output seconds; the incoming clip is the live one, the outgoing a
 * snapshot of its last frame on a second plane, the camera rests through
 * the window, and one cursor dot crosses in frame space.
 */
const meta = (durationMs: number, w = 1600, h = 900) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: w,
  height: h,
  fps: 30,
})

const other: Media = {
  id: 'b',
  videoKey: 'blob:b',
  cursor: [
    { t: 500, x: 100, y: 100, type: 'move' },
    { t: 4000, x: 800, y: 400, type: 'move' },
  ],
  meta: meta(6000, 1280, 720),
}

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:a',
      cursor: [
        { t: 0, x: 10, y: 10, type: 'move' },
        { t: 3500, x: 500, y: 300, type: 'move' },
      ],
      meta: meta(10000),
    },
    segments: [{ in: 0, out: 10 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

/** Four seconds of A sliding out, then four of B sliding in: a push. */
const push = (over: Partial<ProjectDoc> = {}) =>
  doc({
    media: [other],
    segments: [
      { in: 0, out: 4, anim: { exit: 'slide' } },
      { in: 1, out: 5, media: 'b', anim: { enter: 'slide' } },
    ],
    ...over,
  })

describe('the document’s transitions', () => {
  it('a boundary that names an exit and an enter is one record in output seconds', () => {
    const d = push()
    expect(segmentOutputExtents(d)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
    ])
    expect(docTransitions(d)).toEqual([
      {
        t: 4,
        d: 0.6,
        in: { kind: 'slide', side: 'right', d: 0.6 },
        out: { kind: 'slide', side: 'left', d: 0.6, media: '', at: 3.998 },
      },
    ])
  })

  it('one side alone is that side alone; a hard cut is no record', () => {
    const only = docTransitions(
      push({
        segments: [
          { in: 0, out: 4 },
          {
            in: 1,
            out: 5,
            media: 'b',
            anim: { enter: { kind: 'fade', seconds: 0.3 } },
          },
        ],
      }),
    )
    expect(only).toEqual([
      { t: 4, d: 0.3, in: { kind: 'fade', side: 'right', d: 0.3 } },
    ])
    expect(
      docTransitions(
        push({
          segments: [
            { in: 0, out: 4 },
            { in: 1, out: 5, media: 'b' },
          ],
        }),
      ),
    ).toEqual([])
    expect(docTransitions(doc())).toEqual([])
  })

  it('never longer than half the shorter clip, and gone when that leaves nothing', () => {
    const long = docTransitions(
      push({
        segments: [
          { in: 0, out: 4, anim: { exit: { kind: 'scale', seconds: 3 } } },
          {
            in: 1,
            out: 2,
            media: 'b',
            anim: { enter: { kind: 'scale', seconds: 3 } },
          },
        ],
      }),
    )
    expect(long[0].d).toBe(0.5)
    expect(long[0].out?.d).toBe(0.5)
    const tiny = docTransitions(
      push({
        segments: [
          { in: 0, out: 4, anim: { exit: 'slide' } },
          { in: 1, out: 1.2, media: 'b', anim: { enter: 'slide' } },
        ],
      }),
    )
    expect(tiny).toEqual([])
  })

  it('a page change inside ONE recording is the same record: the outgoing is the frame before the cut', () => {
    const d = doc({
      segments: [
        { in: 0, out: 3, anim: { exit: { kind: 'slide', side: 'up' } } },
        { in: 3.5, out: 8, anim: { enter: { kind: 'slide', side: 'down' } } },
      ],
    })
    expect(docTransitions(d)).toEqual([
      {
        t: 3,
        d: 0.6,
        in: { kind: 'slide', side: 'down', d: 0.6 },
        out: { kind: 'slide', side: 'up', d: 0.6, media: '', at: 2.998 },
      },
    ])
  })

  it('the card’s own slide at the open is a record with no outgoing', () => {
    const d = doc({
      frame: { ...DEFAULT_FRAME_STYLE, anim: { enter: 'slide' } },
    })
    expect(docTransitions(d)).toEqual([
      { t: 0, d: 0.6, in: { kind: 'slide', side: 'right', d: 0.6 } },
    ])
    // Its pose track holds the rest: the plane moves, the pose does not.
    const { data } = lowerToComposition(d)
    const track = data.cardPoseTrack as { keyframes: { value: number[] }[] }
    expect(track.keyframes.every((k) => k.value.join() === '1,0,1')).toBe(true)
  })

  it('the first clip’s enter and the last clip’s exit are ignored', () => {
    const d = doc({
      segments: [
        { in: 0, out: 3, anim: { enter: 'slide' } },
        { in: 3, out: 8, anim: { exit: 'slide' } },
      ],
    })
    expect(docTransitions(d)).toEqual([])
  })

  it('a freeze on the boundary rides the later clip, as the Video row draws it', () => {
    const d = push({ freeze: [{ id: 'f0', at: 1, seconds: 2, media: 'b' }] })
    expect(videoLane.items(d).map((i) => [i.t, i.duration])).toEqual([
      [0, 4],
      [4, 6],
    ])
    expect(docTransitions(d)[0].t).toBe(4)
  })
})

describe('the camera rests through a window', () => {
  const spans: ZoomSpan[] = [
    { id: 'z0', in: 2, out: 4, level: 2, cx: 0.5, cy: 0.5 },
    { id: 'z1', in: 1, out: 3, level: 2, cx: 0.5, cy: 0.5, media: 'b' },
    { id: 'z2', in: 1, out: 1.4, level: 2, cx: 0.5, cy: 0.5, media: 'b' },
  ]

  it('a span that starts inside the window loses its head; one before keeps its own', () => {
    const d = push({ zoom: spans })
    const rested = restSpansThroughTransitions(
      spans,
      ratedSegments(d),
      docTransitions(d),
      ZOOM_SPAN_MIN,
    )
    expect(rested.map((z) => [z.id, z.in, z.out])).toEqual([
      ['z0', 2, 4],
      ['z1', 1.6, 3],
    ])
  })

  it('the lowering’s zoom track starts B’s span where the window ends', () => {
    const { data } = lowerToComposition(push({ zoom: spans }))
    const keys = (
      data.zoomTrack as { keyframes: { t: number; value: number[] }[] }
    ).keyframes
    const zoomed = keys.filter((k) => k.value[0] > 1.001)
    expect(zoomed.length).toBeGreaterThan(0)
    expect(
      Math.min(...zoomed.filter((k) => k.t > 3).map((k) => k.t)),
    ).toBeGreaterThanOrEqual(4.6)
  })

  it('a document with no transition carries no table and rests nothing', () => {
    const plain = push({
      segments: [
        { in: 0, out: 4 },
        { in: 1, out: 5, media: 'b' },
      ],
      zoom: spans,
    })
    const { data } = lowerToComposition(plain)
    expect(data.transitions).toBeUndefined()
    expect(
      restSpansThroughTransitions(
        spans,
        ratedSegments(plain),
        [],
        ZOOM_SPAN_MIN,
      ),
    ).toEqual(spans)
  })
})

describe('ON_FRAME across a boundary', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.document
    delete g.__vosTimeline
  })

  interface VideoStub {
    name: string
    currentTime: number
    drawn: number
    src: string
    [key: string]: unknown
  }
  const makeVideo = (name: string, src: string): VideoStub => {
    const v: VideoStub = {
      name,
      src,
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      muted: true,
      volume: 1,
      currentTime: 0,
      duration: 10,
      playbackRate: 1,
      preservesPitch: false,
      drawn: 0,
      play() {
        v.paused = false
        return Promise.resolve()
      },
      pause() {
        v.paused = true
      },
      load: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    return v
  }

  interface Mesh {
    rotation: { x: number; y: number }
    scale: { x: number; y: number }
    position: { x: number; y: number; set: () => void }
    material: { opacity: number }
    visible: boolean
  }
  const mesh = (): Mesh => ({
    rotation: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    position: { x: 0, y: 0, set: () => undefined },
    material: { opacity: 1 },
    visible: true,
  })

  function runFrame(d: ProjectDoc, time: number) {
    const { config, data } = lowerToComposition(d)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    const a = makeVideo('a', 'blob:a')
    const b = makeVideo('b', 'blob:b')
    const ghosts: VideoStub[] = []
    g.window = { __vos__: { isPaused: true, pendingDecodes: new Set() } }
    g.document = {
      createElement: (tag: string) => {
        const el = makeVideo(`ghost-${tag}`, '')
        ghosts.push(el)
        return el
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray, rateAt, totalDuration }
    const calls: string[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'drawImage')
            return (el: VideoStub) => {
              calls.push('drawImage')
              el.drawn++
            }
          return () => {
            calls.push(key)
          }
        },
        set: () => true,
      },
    )
    const card = mesh()
    onFrame(
      {
        time,
        data,
        renderer: undefined,
        resolution: {
          width: 1920,
          height: 1080,
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
        },
      },
      {
        refs: {
          c2d,
          canvas: { width: 1920, height: 1080 },
          texture: { needsUpdate: false, dispose: () => undefined },
          card: {
            c2d,
            canvas: { width: 1920, height: 1080 },
            texture: { needsUpdate: false, dispose: () => undefined },
            mesh: card,
          },
          video: a,
          media: { b },
          cam: null,
        },
      },
      1 / 30,
    )
    return { a, b, ghosts, calls, card }
  }

  it('inside the window the incoming plays live and the outgoing’s last frame paints from a ghost', () => {
    const run = runFrame(push(), 4.3)
    // The live pass draws B; the ghost pass draws a ghost element on A's
    // bytes, held on A's last frame; A's own element paints nothing.
    expect(run.b.drawn).toBe(1)
    expect(run.a.drawn).toBe(0)
    expect(run.ghosts.length).toBe(1)
    expect(run.ghosts[0].src).toBe('blob:a')
    expect(run.ghosts[0].currentTime).toBeCloseTo(3.998, 3)
    expect(run.ghosts[0].drawn).toBe(1)
    // The live card is still arriving from the right: an offset in plane
    // widths, eased, positive x.
    expect(run.card.position.x).toBeGreaterThan(0)
    expect(run.card.position.x).toBeLessThan(TRANSITION_TRAVEL * 2)
    // One dot in frame space (the overlay's arc), never two on the cards.
    expect(run.calls.filter((k) => k === 'arc').length).toBe(1)
  })

  it('outside the window there is one card, at rest, and no ghost', () => {
    const run = runFrame(push(), 5.5)
    expect(run.b.drawn).toBe(1)
    expect(run.ghosts.length).toBe(0)
    expect(run.card.position.x).toBe(0)
    expect(run.calls.filter((k) => k === 'drawImage').length).toBe(1)
  })

  it('a second ahead of a boundary the ghost warms, unseen', () => {
    const run = runFrame(push(), 3.5)
    expect(run.ghosts.length).toBe(1)
    expect(run.ghosts[0].currentTime).toBeCloseTo(3.998, 3)
    expect(run.ghosts[0].drawn).toBe(0)
    expect(run.a.drawn).toBe(1)
  })

  it('a fade exit alone: the incoming holds still while the ghost paints', () => {
    const run = runFrame(
      push({
        segments: [
          { in: 0, out: 4, anim: { exit: 'fade' } },
          { in: 1, out: 5, media: 'b' },
        ],
      }),
      4.2,
    )
    expect(run.ghosts[0].drawn).toBe(1)
    expect(run.card.position.x).toBe(0)
    expect(run.card.material.opacity).toBe(1)
  })
})
