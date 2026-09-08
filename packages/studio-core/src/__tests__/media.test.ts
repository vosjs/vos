import { afterEach, describe, expect, it } from 'vitest'
import {
  lerpArray,
  mapTime,
  rateAt,
  sample,
  totalDuration,
} from '@vosjs/timeline'
import {
  lowerToComposition,
  ratedSegments,
  spanOutputExtent,
} from '../lower/lowerToComposition'
import { mediaAtOutput, mediaFrame, mediaSource, nextMediaId } from '../media'
import { computeCardLayout } from '../layout'
import { freezeLane, speedLane, videoLane, zoomLane } from '../timeline/lanes'
import {
  CARD_EDGE_OVERDRAW,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { Media, ProjectDoc } from '../types'

/**
 * Many media in one take (concat): `doc.media` holds the other media, a
 * segment or a source-anchored span names its media, and everything else
 * (the rated list, the span→track mappers, the lanes, the lowering) reads
 * the media through the pieces. A document with none lowers byte-
 * identically, which the rest of the suite pins.
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
    { t: 1000, x: 300, y: 200, type: 'down', button: 0 },
    { t: 1100, x: 300, y: 200, type: 'up', button: 0 },
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
        { t: 2000, x: 500, y: 300, type: 'down', button: 0 },
        { t: 2100, x: 500, y: 300, type: 'up', button: 0 },
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

/** Four seconds of A, then four of B (source 1..5), then A again. */
const concat = (over: Partial<ProjectDoc> = {}) =>
  doc({
    media: [other],
    segments: [
      { in: 0, out: 4 },
      { in: 1, out: 5, media: 'b' },
      { in: 4, out: 10 },
    ],
    ...over,
  })

const apply = (d: ProjectDoc, patch: ((d: ProjectDoc) => void) | null) => {
  expect(patch).not.toBeNull()
  const next = structuredClone(d)
  patch!(next)
  return next
}

describe('the rated list carries each piece’s media', () => {
  it('rates a segment by its own media’s speed spans and keeps the media on the pieces', () => {
    const d = concat({
      speed: [
        { id: 's0', in: 2, out: 4, rate: 2, media: 'b' },
        { id: 's1', in: 2, out: 4, rate: 4 },
      ],
    })
    const rated = ratedSegments(d)
    expect(
      rated.map((p) => [
        p.in,
        p.out,
        p.rate ?? 1,
        (p as { media?: string }).media ?? '',
      ]),
    ).toEqual([
      [0, 2, 1, ''],
      [2, 4, 4, ''],
      [1, 2, 1, 'b'],
      [2, 4, 2, 'b'],
      [4, 5, 1, 'b'],
      [4, 10, 1, ''],
    ])
    // Output: 2 + 0.5 + 1 + 1 + 1 + 6 = 11.5 s.
    expect(totalDuration(rated)).toBeCloseTo(11.5, 6)
  })

  it('places a freeze on the media it names, never on a stranger’s same seconds', () => {
    const d = concat({ freeze: [{ id: 'f0', at: 3, seconds: 2, media: 'b' }] })
    const rated = ratedSegments(d)
    expect(
      rated.map((p) => [p.in, p.out, (p as { media?: string }).media ?? '']),
    ).toEqual([
      [0, 4, ''],
      [1, 3, 'b'],
      [2.998, 3, 'b'],
      [3, 5, 'b'],
      [4, 10, ''],
    ])
    expect(mediaAtOutput(rated, 6.5)).toBe('b') // inside the freeze
    expect(mediaAtOutput(rated, 1)).toBe('')
    expect(mediaAtOutput(rated, 11)).toBe('')
  })

  it('maps a span’s output extent through its media’s pieces only', () => {
    const rated = ratedSegments(concat())
    // Source 2..3 on B is output 5..6; the same seconds on A are 2..3.
    expect(spanOutputExtent(rated, 2, 3, 'b')).toEqual({ start: 5, end: 6 })
    expect(spanOutputExtent(rated, 2, 3)).toEqual({ start: 2, end: 3 })
    expect(spanOutputExtent(rated, 7, 8, 'b')).toBeNull()
  })

  it('names media and finds them', () => {
    const d = concat()
    expect(mediaSource(d, 'b')?.videoKey).toBe('blob:b')
    expect(mediaSource(d, '')?.videoKey).toBe('blob:a')
    expect(mediaSource(d, 'zzz')).toBeNull()
    expect(nextMediaId(d)).toBe('m1')
  })
})

describe('the lowering with many media', () => {
  it('hands every media to setup, stamps the pieces, and maps each media’s clicks through its own pieces', () => {
    const { data } = lowerToComposition(concat())
    const media = data.media as {
      id: string
      src: string
      cursorSpace: { w: number; h: number }
      cursor: unknown[]
    }[]
    expect(media.map((m) => [m.id, m.src, m.cursorSpace])).toEqual([
      ['b', 'blob:b', { w: 1280, h: 720 }],
    ])
    expect(media[0].cursor.length).toBeGreaterThan(0)
    const segs = data.segments as { in: number; out: number; media?: string }[]
    expect(segs.map((s) => s.media ?? '')).toEqual(['', 'b', ''])
    const clicks = data.clicks as {
      ot: number
      st: number
      sp?: { w: number }
    }[]
    // A's press at source 2 is output 2; B's at source 1 is output 4.
    expect(clicks.map((c) => [c.ot, c.sp?.w ?? null])).toEqual([
      [2, null],
      [4, 1280],
    ])
  })

  it('a document with no other media carries no media key', () => {
    const { data } = lowerToComposition(doc())
    expect('media' in data).toBe(false)
  })
})

describe('ON_FRAME drives the media under the playhead', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  interface VideoStub {
    name: string
    paused: boolean
    currentTime: number
    playCalls: number
    pauseCalls: number
    drawn: number
    [key: string]: unknown
  }
  const makeVideo = (name: string): VideoStub => {
    const v: VideoStub = {
      name,
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
      playCalls: 0,
      pauseCalls: 0,
      drawn: 0,
      play() {
        v.playCalls++
        v.paused = false
        return Promise.resolve()
      },
      pause() {
        v.pauseCalls++
        v.paused = true
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    return v
  }

  function runFrame(d: ProjectDoc, a: VideoStub, b: VideoStub, time: number) {
    const { config, data } = lowerToComposition(d)
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = { __vos__: { isPaused: false } }
    g.__vosTimeline = { mapTime, sample, lerpArray, rateAt, totalDuration }
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'drawImage')
            return (el: unknown, ...args: number[]) => {
              if (el === a) a.drawn++
              if (el === b) {
                b.drawn++
                b.lastDraw = args
              }
            }
          return () => {}
        },
        set: () => true,
      },
    )
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
          video: a,
          media: { b },
          cam: null,
        },
      },
      1 / 30,
    )
  }

  it('draws B on B’s own card, where the host mirror lays it', () => {
    const d = concat({
      media: [
        {
          ...other,
          frame: { inset: { left: 0.4, top: 0.1, right: 0.05, bottom: 0.1 } },
        },
      ],
    })
    const a = makeVideo('a')
    const b = makeVideo('b')
    b.videoWidth = 1280
    b.videoHeight = 720
    runFrame(d, a, b, 5)
    const args = b.lastDraw as number[]
    const l = computeCardLayout(
      mediaFrame(d, 'b'),
      { width: 1280, height: 720 },
      1920,
      1080,
    )
    const ov = CARD_EDGE_OVERDRAW
    expect(args[0]).toBeCloseTo(l.dx - ov, 2)
    expect(args[1]).toBeCloseTo(l.dy - ov, 2)
    expect(args[2]).toBeCloseTo(l.dw + 2 * ov, 2)
    expect(args[3]).toBeCloseTo(l.dh + 2 * ov, 2)
    // and not where the take's card sits
    const take = computeCardLayout(
      d.frame,
      { width: 1280, height: 720 },
      1920,
      1080,
    )
    expect(Math.abs(args[0] - (take.dx - ov))).toBeGreaterThan(50)
  })

  it('plays and draws the primary inside its clip, and B inside B’s, resting the other', () => {
    const a = makeVideo('a')
    const b = makeVideo('b')
    runFrame(concat(), a, b, 1)
    expect(a.playCalls).toBe(1)
    expect(a.drawn).toBe(1)
    expect(b.playCalls).toBe(0)
    expect(b.drawn).toBe(0)

    const a2 = makeVideo('a')
    const b2 = makeVideo('b')
    a2.paused = false // the primary was playing when the cut arrived
    runFrame(concat(), a2, b2, 5)
    expect(b2.playCalls).toBe(1)
    expect(b2.drawn).toBe(1)
    expect(a2.pauseCalls).toBe(1)
    expect(a2.drawn).toBe(0)
    // B's own source moment: output 5 is source 2 on B.
    expect(b2.currentTime).toBeCloseTo(2, 3)
  })
})

describe('the lanes stamp the media under the playhead', () => {
  it('a zoom made at an output moment on B belongs to B and clears B’s spans only', () => {
    const d = concat({
      zoom: [
        {
          id: 'u0',
          in: 2,
          out: 3,
          level: 1.5,
          cx: 0.5,
          cy: 0.5,
          source: 'manual',
        },
      ],
    })
    // Output 5 is B's source 2, where A's u0 sits in seconds but not in media.
    const next = apply(d, zoomLane.gesture(d, { type: 'create', t: 5 }))
    const made = next.zoom.find((z) => z.id !== 'u0')!
    expect(made.media).toBe('b')
    expect(made.in).toBeCloseTo(2, 6)
    // And the same moment on A refuses (u0 is there).
    expect(zoomLane.gesture(d, { type: 'create', t: 2.5 })).toBeNull()
    // The zoom lane draws B's span where B plays.
    expect(zoomLane.items(next).find((i) => i.id === made.id)?.t).toBeCloseTo(
      5,
      6,
    )
  })

  it('speed and freeze creates carry the media; the video row draws three clips', () => {
    const d = concat()
    const sped = apply(d, speedLane.gesture(d, { type: 'create', t: 5 }))
    expect(sped.speed?.[0].media).toBe('b')
    const frozen = apply(d, freezeLane.gesture(d, { type: 'create', t: 5 }))
    expect(frozen.freeze?.[0]).toMatchObject({ at: 2, media: 'b' })
    expect(videoLane.items(d).map((i) => [i.t, i.duration])).toEqual([
      [0, 4],
      [4, 4],
      [8, 6],
    ])
    // A create at the primary's moment carries no media key.
    const primary = apply(d, speedLane.gesture(d, { type: 'create', t: 1 }))
    expect(primary.speed?.[0].media).toBeUndefined()
  })
})

describe('a media wears its own card', () => {
  const page = 'https://www.vos.so/gallery?theme=light'
  it('resolves the card fields over the take’s frame, the bar from the facts', () => {
    const d = doc({
      frame: {
        ...DEFAULT_FRAME_STYLE,
        radius: 12,
        browserBar: {
          ...DEFAULT_BROWSER_BAR,
          kind: 'mac-light',
          url: 'vos.so/docs',
        },
      },
      media: [
        {
          ...other,
          meta: { ...other.meta, pageUrl: page },
          frame: { inset: { left: 0.4 }, radius: 4 },
        },
        { ...other, id: 'c' },
        {
          ...other,
          id: 'e',
          frame: { browserBar: { kind: 'minimal', url: 'typed' } },
        },
      ],
    })
    expect(mediaFrame(d, '')).toBe(d.frame)
    const b = mediaFrame(d, 'b')
    expect(b.inset).toEqual({ left: 0.4 })
    expect(b.radius).toBe(4)
    expect(b.padding).toBe(d.frame.padding)
    expect(b.browserBar.kind).toBe('mac-light')
    expect(b.browserBar.url).toBe('vos.so/gallery')
    // an upload has no page: no bar, and the take's words stay
    const c = mediaFrame(d, 'c')
    expect(c.browserBar.kind).toBe('none')
    expect(c.radius).toBe(12)
    // its own bar wins over the facts
    const e = mediaFrame(d, 'e')
    expect(e.browserBar.kind).toBe('minimal')
    expect(e.browserBar.url).toBe('typed')
    expect(mediaFrame(d, 'zzz')).toBe(d.frame)
  })

  it('the lowering hands the resolved card to setup, card fields only', () => {
    const d = concat({
      media: [{ ...other, frame: { inset: { left: 0.4, right: 0.1 } } }],
    })
    const { data } = lowerToComposition(d)
    const media = data.media as { frame: Record<string, unknown> }[]
    expect(media[0].frame.inset).toEqual({ left: 0.4, right: 0.1 })
    expect(media[0].frame.browserBar).toMatchObject({ kind: 'none' })
    expect('padding' in media[0].frame).toBe(false)
    expect('background' in media[0].frame).toBe(false)
  })
})
