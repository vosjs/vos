import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { lerpArray, sample, segmentRate, totalDuration } from '@vosjs/timeline'
import {
  lowerToComposition,
  pinCandidates,
  ratedSegments,
  spanOutputExtent,
} from '../lower/lowerToComposition'
import { docStillTime, placeFreezes } from '../lower/motion'
import {
  cameraRestWindows,
  cameraSpanExtents,
  hasReplay,
  longestOutputExtent,
  momentOutputs,
  replayFlags,
  replayedSeconds,
  spanOutputExtents,
} from '../lower/occurrences'
import { segmentOutputExtents } from '../lower/segmentStarts'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import { sourceMomentToOutput, stepMomentToOutput } from '../lower/anchor'
import { digestSteps } from '../digest/build'
import { freezeLane, speedLane, tiltLane, zoomLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { Keyframe, KeyframeTrack, Segment } from '@vosjs/timeline'
import type { CursorTrack, ProjectDoc } from '../types'

/**
 * A segment may play seconds an earlier one already played: a cold open
 * of the final state, then the whole recording from its start, from ONE
 * file. Every source-anchored span over replayed seconds plays in each
 * occurrence; a cut that plays each media's seconds in forward order has
 * no replay, and lowers exactly as it did before replays existed.
 */

const meta = (durationMs: number) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: 1600,
  height: 900,
  fps: 30,
  steps: [
    { step: 0, id: 'open', do: 'click', tStart: 1, tEnd: 1.4 },
    {
      step: 1,
      id: 'done',
      do: 'click',
      tStart: 11,
      tEnd: 11.1,
      rect: { x: 650, y: 380, w: 100, h: 40 },
    },
  ],
})

function cursorTrack(): CursorTrack {
  const out: CursorTrack = []
  for (let t = 0; t <= 12000; t += 250)
    out.push({ t, x: 400 + (t % 3000) / 10, y: 300, type: 'move' })
  out.push({ t: 11000, x: 700, y: 400, type: 'down', button: 0 })
  out.push({ t: 11100, x: 700, y: 400, type: 'up', button: 0 })
  return out.sort((a, b) => a.t - b.t)
}

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: { videoKey: 'blob:a', cursor: cursorTrack(), meta: meta(12000) },
    segments: [{ in: 0, out: 12 }],
    zoom: [],
    audio: [],
    cursor: {
      ...DEFAULT_CURSOR_STYLE,
      clickFx: { ...DEFAULT_CURSOR_STYLE.clickFx, style: 'ripple' },
    },
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

/** 1.7 s of the end state (source 10.3..12), then the whole take. */
const COLD_OPEN = [
  { in: 10.3, out: 12 },
  { in: 0, out: 12 },
]
/** Where the take's second pass starts on the output. */
const PASS2 = 1.7

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

describe('occurrences', () => {
  it('a forward cut never replays: cuts, splits, speed edges, freezes, other media', () => {
    const d = doc({
      segments: [
        { in: 0, out: 3 },
        { in: 3, out: 5 },
        { in: 7, out: 9 },
        { in: 0, out: 2, media: 'b' },
        { in: 9, out: 12 },
      ],
      media: [{ id: 'b', videoKey: 'blob:b', cursor: [], meta: meta(4000) }],
      speed: [{ id: 's', in: 4, out: 8, rate: 2 }],
      freeze: [
        { id: 'f0', at: 1.5, seconds: 1 },
        { id: 'f1', at: 9, seconds: 0.5 },
      ],
    })
    const rated = ratedSegments(d)
    expect(replayFlags(rated).every((r) => !r)).toBe(true)
    expect(hasReplay(rated)).toBe(false)
  })

  it('a piece that starts before its media has reached is a replay; one that continues it is not', () => {
    const pieces: (Segment & { media?: string })[] = [
      { in: 0, out: 10 },
      { in: 2, out: 4 },
      { in: 4, out: 10 },
      { in: 0, out: 3, media: 'b' },
      { in: 1, out: 2, media: 'b' },
    ]
    expect(replayFlags(pieces)).toEqual([false, true, false, false, true])
  })

  it('returns every occurrence of a span and of a moment, in output order', () => {
    const rated = ratedSegments(doc({ segments: COLD_OPEN }))
    expect(spanOutputExtents(rated, 10.5, 11.5)).toEqual([
      { start: expect.closeTo(0.2, 9), end: expect.closeTo(1.2, 9) },
      {
        start: expect.closeTo(PASS2 + 10.5, 9),
        end: expect.closeTo(PASS2 + 11.5, 9),
      },
    ])
    // A span over seconds the cold open leaves out plays once.
    expect(spanOutputExtents(rated, 2, 4)).toHaveLength(1)
    // The first occurrence is the single-extent answer.
    expect(spanOutputExtent(rated, 10.5, 11.5)!.start).toBeCloseTo(0.2, 9)
    const at = momentOutputs(rated, 11)
    expect(at).toHaveLength(2)
    expect(at[0]).toBeCloseTo(0.7, 9)
    expect(at[1]).toBeCloseTo(PASS2 + 11, 9)
  })

  it('a cold open before a trimmed recording is two passes, not one per trim', () => {
    const pieces: Segment[] = [
      { in: 10.3, out: 12 },
      { in: 0, out: 3 },
      { in: 4, out: 8 },
      { in: 9, out: 12 },
    ]
    expect(replayFlags(pieces)).toEqual([false, true, false, false])
    // Only the last trim plays the cold open's seconds again.
    expect(replayedSeconds(pieces)).toEqual([
      { piece: 3, media: '', in: 10.3, out: 12 },
    ])
    // A span across the 3 | 4 trim cut is one occurrence, as without the
    // cold open, only 1.7 s later.
    const ext = spanOutputExtents(pieces, 2, 5)
    expect(ext).toHaveLength(1)
    expect(ext[0].start).toBeCloseTo(1.7 + 2, 9)
    expect(ext[0].end).toBeCloseTo(1.7 + 4, 9)
    expect(spanOutputExtents(pieces.slice(1), 2, 5)).toEqual([
      { start: expect.closeTo(2, 9), end: expect.closeTo(4, 9) },
    ])
    // A moment of the cold open plays twice; one the cold open leaves out once.
    expect(momentOutputs(pieces, 11)).toHaveLength(2)
    expect(momentOutputs(pieces, 6)).toEqual([expect.closeTo(1.7 + 5, 9)])
  })

  it('a reordered cut starts a pass and replays nothing', () => {
    const pieces: Segment[] = [
      { in: 10, out: 20 },
      { in: 0, out: 10 },
    ]
    expect(replayFlags(pieces)).toEqual([false, true])
    expect(replayedSeconds(pieces)).toEqual([])
  })

  it('a zoom across a trim cut after a cold open lowers as it does without the cold open', () => {
    const zoom = [
      {
        id: 'z0',
        in: 2,
        out: 5,
        level: 1.8,
        cx: 0.4,
        cy: 0.4,
        source: 'manual' as const,
      },
    ]
    const trims = [
      { in: 0, out: 3 },
      { in: 4, out: 8 },
      { in: 9, out: 12 },
    ]
    const plain = lowerToComposition(doc({ segments: trims, zoom })).data
      .zoomTrack as KeyframeTrack<number[]>
    const opened = lowerToComposition(
      doc({ segments: [{ in: 10.3, out: 12 }, ...trims], zoom }),
    ).data.zoomTrack as KeyframeTrack<number[]>
    // The cold open's seconds hold no zoom, so the opened film's camera is
    // the plain film's, 1.7 s later, held across the cut, never twice.
    for (const t of [2.1, 2.9, 3.05, 3.5]) {
      const a = sample(plain, t, lerpArray)
      const b = sample(opened, t + 1.7, lerpArray)
      expect(b[0]).toBeCloseTo(a[0], 6)
    }
  })

  it('a span split by a segment boundary inside a replay is one occurrence', () => {
    const rated: Segment[] = [
      { in: 0, out: 10 },
      { in: 2, out: 4 },
      { in: 4, out: 10 },
    ]
    const ext = spanOutputExtents(rated, 3, 5)
    expect(ext).toHaveLength(2)
    expect(ext[1].start).toBeCloseTo(11, 9)
    expect(ext[1].end).toBeCloseTo(13, 9)
  })
})

describe('a cold open from the same recording', () => {
  it('plays a zoom in each occurrence of its seconds', () => {
    const d = doc({
      segments: COLD_OPEN,
      zoom: [
        { id: 'z0', in: 3, out: 5, level: 1.6, cx: 0.3, cy: 0.3 },
        {
          id: 'z1',
          in: 10.5,
          out: 11.8,
          level: 2,
          cx: 0.6,
          cy: 0.5,
          source: 'manual',
        },
      ],
    })
    const track = lowerToComposition(d).data.zoomTrack as KeyframeTrack<
      number[]
    >
    const heldAt = (lo: number, hi: number) =>
      track.keyframes.some(
        (k: Keyframe<number[]>) => k.t >= lo && k.t <= hi && k.value[0] === 2,
      )
    expect(heldAt(0, PASS2)).toBe(true)
    expect(heldAt(PASS2 + 10.5, PASS2 + 11.8)).toBe(true)
    // Between them the second pass plays its own zoom and rests.
    expect(sample(track, PASS2 + 4, lerpArray)[0]).toBeCloseTo(1.6, 3)
    expect(sample(track, PASS2 + 8, lerpArray)[0]).toBe(1)
    // The lane draws the span where it first plays.
    const z1 = zoomLane.items(d).find((i) => i.id === 'z1')!
    expect(z1.t).toBeCloseTo(0.2, 3)
    expect(z1.duration).toBeCloseTo(1.3, 3)
  })

  it('leans the card in each occurrence of a tilt span', () => {
    const d = doc({
      segments: COLD_OPEN,
      tilt: [{ id: 't1', in: 10.5, out: 11.8, rx: 6, ry: -10 }],
    })
    const track = lowerToComposition(d).data.tiltTrack as KeyframeTrack<
      number[]
    >
    const leaning = track.keyframes.filter((k) => k.value[1] === -10)
    expect(leaning.some((k) => k.t < PASS2)).toBe(true)
    expect(leaning.some((k) => k.t > PASS2 + 10)).toBe(true)
    expect(tiltLane.items(d)[0].t).toBeCloseTo(0.2, 3)
  })

  it('rings a click each time its press plays, released within its own pass', () => {
    const { data } = lowerToComposition(doc({ segments: COLD_OPEN }))
    const clicks = data.clicks as { ot: number; up: number; st: number }[]
    expect(clicks).toHaveLength(2)
    expect(clicks.map((c) => c.st)).toEqual([11, 11])
    expect(clicks[0].ot).toBeCloseTo(0.7, 3)
    expect(clicks[0].up).toBeCloseTo(0.8, 3)
    expect(clicks[1].ot).toBeCloseTo(PASS2 + 11, 3)
    expect(clicks[1].up).toBeCloseTo(PASS2 + 11.1, 3)
  })

  it('rates replayed seconds in every pass, coherent with the clips', () => {
    const d = doc({
      segments: COLD_OPEN,
      speed: [
        { id: 'fast', in: 10.5, out: 11.5, rate: 2 },
        { id: 'slow', in: 2, out: 3, rate: 0.5 },
      ],
    })
    const rated = ratedSegments(d)
    const fast = rated.filter((p) => segmentRate(p) === 2)
    expect(fast).toHaveLength(2)
    expect(fast.every((p) => near(p.in, 10.5) && near(p.out, 11.5))).toBe(true)
    // 13.7 s of footage, 1 s of it twice at 2×, 1 s once at 0.5×.
    expect(totalDuration(rated)).toBeCloseTo(13.7 - 0.5 - 0.5 + 1, 6)
    const ext = segmentOutputExtents(d)
    expect(ext.at(-1)!.end).toBeCloseTo(totalDuration(rated), 6)
    expect(ext[1].start).toBeCloseTo(PASS2 - 0.5, 6)
    // The band sits on its first pass.
    const band = speedLane.items(d).find((i) => i.id === 'fast')!
    expect(band.t).toBeCloseTo(0.2, 3)
    expect(band.duration).toBeCloseTo(0.5, 3)
  })

  it('holds a freeze in every pass; the lane shows the first, the still rests on the last', () => {
    const d = doc({
      segments: COLD_OPEN,
      freeze: [{ id: 'end', at: 12, seconds: 1 }],
    })
    const rated = ratedSegments(d)
    expect(totalDuration(rated)).toBeCloseTo(13.7 + 2, 6)
    const { placements, marks } = placeFreezes(
      ratedSegmentsWithoutFreezes(d),
      d.freeze!,
    )
    expect(placements.map((p) => p.t)).toEqual([
      expect.closeTo(1.7, 6),
      expect.closeTo(1.7 + 1 + 12, 6),
    ])
    expect(marks.get('end')!.t).toBeCloseTo(1.7, 6)
    expect(freezeLane.items(d)[0].t).toBeCloseTo(1.7, 3)
    expect(docStillTime(d)).toBeCloseTo(14.7, 3)
    // The clips' own extents agree with the rated list.
    expect(segmentOutputExtents(d).at(-1)!.end).toBeCloseTo(15.7, 6)
  })

  it('starts a step-anchored layer in the first pass when both play the step whole', () => {
    const d = doc({
      segments: COLD_OPEN,
      overlays: [
        {
          id: 'say',
          kind: 'text',
          text: 'Done',
          preset: 'caption',
          start: 5,
          duration: 1,
          transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
          anchor: { step: 'done' },
        },
      ],
    })
    const entry = lowerToComposition(d).stack[STUDIO_ENTRY_ID] as {
      overlays: { id: string; start: number }[]
    }
    expect(entry.overlays.find((o) => o.id === 'say')!.start).toBeCloseTo(
      0.7,
      3,
    )
    // A layer over the second pass is offered the step's second pass.
    const c = pinCandidates(d, { start: PASS2 + 10.8, duration: 1 })
    expect(c[0].output.start).toBeCloseTo(PASS2 + 11, 3)
  })
})

describe('a step resolves to the pass it plays longest', () => {
  // The cold open stops at 11.2 s, a fifth of a second into the step
  // `done` (11..11.6); the main play holds all of it.
  const SHORT_OPEN = [
    { in: 10.3, out: 11.2 },
    { in: 0, out: 12 },
  ]
  const MAIN = 0.9
  const done = (d: ProjectDoc) => {
    d.source.meta.steps = [
      { step: 0, id: 'done', do: 'click', tStart: 11, tEnd: 11.6 },
    ]
    return d
  }

  it('starts an anchored layer in the main play, not the cold open', () => {
    const d = done(
      doc({
        segments: SHORT_OPEN,
        overlays: [
          {
            id: 'say',
            kind: 'text',
            text: 'Done',
            preset: 'caption',
            duration: 1,
            transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
            anchor: { step: 'done' },
          },
          {
            id: 'after',
            kind: 'text',
            text: 'Saved',
            preset: 'caption',
            duration: 1,
            transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
            anchor: { step: 'done', at: 'end', offset: 0.1 },
          },
        ],
      }),
    )
    const rated = ratedSegments(d)
    const step = d.source.meta.steps![0]
    expect(stepMomentToOutput(rated, step, 'start')).toBeCloseTo(MAIN + 11, 6)
    expect(stepMomentToOutput(rated, step, 'end')).toBeCloseTo(MAIN + 11.6, 6)
    // The first-occurrence map still answers the cold open.
    expect(sourceMomentToOutput(rated, 11)).toBeCloseTo(0.7, 6)
    const entry = lowerToComposition(d).stack[STUDIO_ENTRY_ID] as {
      overlays: { id: string; start: number }[]
    }
    expect(entry.overlays.map((o) => [o.id, o.start])).toEqual([
      ['say', expect.closeTo(MAIN + 11, 3)],
      ['after', expect.closeTo(MAIN + 11.7, 3)],
    ])
  })

  it('reads a digest step in its longest pass', () => {
    const d = done(doc({ segments: SHORT_OPEN }))
    const [s] = digestSteps(d)
    expect(s.output!.in).toBeCloseTo(MAIN + 11, 3)
    expect(s.output!.out).toBeCloseTo(MAIN + 11.6, 3)
    expect(longestOutputExtent(ratedSegments(d), 11, 11.6)!.start).toBeCloseTo(
      MAIN + 11,
      6,
    )
  })
})

describe('a segment whose camera rests', () => {
  const RESTING_OPEN = [
    { in: 10.3, out: 12, camera: 'rest' as const },
    { in: 0, out: 12 },
  ]
  const zoom = [
    {
      id: 'z1',
      in: 10.5,
      out: 11.8,
      level: 2,
      cx: 0.6,
      cy: 0.5,
      source: 'manual' as const,
    },
  ]

  it('keeps the cold open at rest while the main play zooms, tilts and moves the cam', () => {
    const d = doc({
      segments: RESTING_OPEN,
      zoom,
      tilt: [{ id: 't1', in: 10.5, out: 11.8, rx: 6, ry: -10 }],
      camMotion: [{ id: 'c1', in: 10.5, out: 11.8, size: 0.4 }],
    })
    d.source.camKey = 'blob:cam'
    const { data } = lowerToComposition(d)
    const zt = data.zoomTrack as KeyframeTrack<number[]>
    const tt = data.tiltTrack as KeyframeTrack<number[]>
    const ct = data.camTrack as KeyframeTrack<number[]>
    for (const t of [0, 0.4, 0.8, 1.2, 1.6]) {
      expect(sample(zt, t, lerpArray)[0]).toBe(1)
      expect(sample(tt, t, lerpArray)).toEqual([0, 0])
    }
    expect(ct.keyframes.every((k) => k.t > PASS2)).toBe(true)
    expect(sample(zt, PASS2 + 11.5, lerpArray)[0]).toBeCloseTo(2, 3)
    expect(sample(tt, PASS2 + 11.5, lerpArray)[1]).toBeCloseTo(-10, 3)
    expect(sample(ct, PASS2 + 11.5, lerpArray)[2]).toBeCloseTo(0.4, 3)
    // The lane draws the zoom where the camera plays it.
    expect(zoomLane.items(d)[0].t).toBeCloseTo(PASS2 + 10.5, 3)
  })

  it('keeps the footage facts: the cursor, the clicks, the speed and the freezes', () => {
    const speed = [{ id: 'fast', in: 10.5, out: 11.5, rate: 2 }]
    const freeze = [{ id: 'end', at: 12, seconds: 1 }]
    const d = doc({ segments: RESTING_OPEN, speed, freeze })
    const { data } = lowerToComposition(d)
    expect((data.clicks as { ot: number }[]).length).toBe(2)
    const rated = ratedSegments(d)
    expect(rated.filter((p) => segmentRate(p) === 2)).toHaveLength(2)
    expect(totalDuration(rated)).toBeCloseTo(13.7 - 1 + 2, 6)
    // The freeze piece in the resting pass rests with it.
    const resting = rated.filter(
      (p) => (p as { camera?: string }).camera === 'rest',
    )
    expect(resting.at(-1)!.rate).toBeLessThan(0.01)
    const plain = lowerToComposition(
      doc({ segments: COLD_OPEN, speed, freeze }),
    ).data
    expect(data.cursor).toEqual(plain.cursor)
    expect(data.clicks).toEqual(plain.clicks)
    expect(data.segments).toEqual(plain.segments)
  })

  it('ramps at the pass edges and never pans across a resting pass', () => {
    const segments = [
      { in: 0, out: 6 },
      { in: 6, out: 6.8 },
      { in: 6.8, out: 12 },
    ]
    const resting = [
      segments[0],
      { ...segments[1], camera: 'rest' as const },
      segments[2],
    ]
    const spans = [
      { id: 'a', in: 4, out: 6, level: 2, cx: 0.3, cy: 0.3 },
      { id: 'b', in: 6.8, out: 9, level: 2, cx: 0.7, cy: 0.7 },
    ]
    const track = (segs: ProjectDoc['segments'], z = spans) =>
      lowerToComposition(doc({ segments: segs, zoom: z })).data
        .zoomTrack as KeyframeTrack<number[]>
    const atRest = (t: KeyframeTrack<number[]>) =>
      t.keyframes.some((k) => k.t > 6 && k.t < 7.4 && k.value[0] === 1)
    // 0.8 s apart, the camera pans straight from one to the other...
    expect(atRest(track(segments))).toBe(false)
    // ...unless the clip between them rests the camera.
    expect(atRest(track(resting))).toBe(true)
    // A span running into the resting clip ends at its edge and ramps out
    // from there, as at any span's end: no snap at the cut.
    const across = track(resting, [
      { id: 'c', in: 4, out: 6.5, level: 2, cx: 0.5, cy: 0.5 },
    ])
    const held = across.keyframes.filter((k) => k.value[0] === 2)
    expect(Math.max(...held.map((k) => k.t))).toBeCloseTo(6, 3)
    const after = sample(across, 6.05, lerpArray)[0]
    expect(after).toBeGreaterThan(1)
    expect(after).toBeLessThan(2)
  })

  it('lowers a cut with no resting clip as before', () => {
    const plain = doc({ segments: COLD_OPEN, zoom })
    expect(cameraRestWindows(ratedSegments(plain))).toEqual([])
    expect(cameraSpanExtents(ratedSegments(plain), 10.5, 11.8)).toEqual(
      spanOutputExtents(ratedSegments(plain), 10.5, 11.8),
    )
  })
})

function ratedSegmentsWithoutFreezes(d: ProjectDoc): Segment[] {
  return ratedSegments({ ...d, freeze: [] })
}

// --- parity: a forward cut lowers as it did before replays existed ---

/** The single-pass mappings every reader used before replays (oracle). */
function legacyExtent(
  pieces: readonly (Segment & { media?: string })[],
  sIn: number,
  sOut: number,
  media?: string,
): { start: number; end: number } | null {
  let acc = 0
  let start: number | null = null
  let end: number | null = null
  for (const p of pieces) {
    const rate = segmentRate(p)
    const len = Math.max(0, p.out - p.in) / rate
    if ((p.media ?? '') !== (media ?? '')) {
      acc += len
      continue
    }
    const ovIn = Math.max(sIn, p.in)
    const ovOut = Math.min(sOut, p.out)
    if (ovOut > ovIn) {
      if (start === null) start = acc + (ovIn - p.in) / rate
      end = acc + (ovOut - p.in) / rate
    }
    acc += len
  }
  return start !== null && end !== null && end > start ? { start, end } : null
}

function legacyMoment(
  pieces: readonly (Segment & { media?: string })[],
  t: number,
  media?: string,
): number | null {
  let acc = 0
  for (const p of pieces) {
    const rate = segmentRate(p)
    if ((p.media ?? '') === (media ?? '') && t >= p.in && t <= p.out)
      return acc + (t - p.in) / rate
    acc += Math.max(0, p.out - p.in) / rate
  }
  return null
}

/** A seeded corpus of forward cuts with every source-anchored feature. */
function forwardCorpus(n: number): ProjectDoc[] {
  let seed = 7
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  const sorted = (k: number, len: number) =>
    Array.from({ length: k }, () => r3(rnd() * len)).sort((a, b) => a - b)
  const spans = (k: number, len: number) => {
    const p = sorted(k * 2, len)
    return Array.from({ length: k }, (_, i) => [p[2 * i], p[2 * i + 1]]).filter(
      ([a, b]) => b - a > 0.6,
    )
  }
  const out: ProjectDoc[] = []
  for (let k = 0; k < n; k++) {
    const segs: ProjectDoc['segments'] = spans(3, 12).flatMap(([a, b]) =>
      rnd() < 0.3
        ? [
            { in: a, out: r3((a + b) / 2) },
            { in: r3((a + b) / 2), out: b },
          ]
        : [{ in: a, out: b }],
    )
    const multi = k % 3 === 0
    if (multi) segs.splice(1, 0, { in: 0.5, out: 3, media: 'b' })
    out.push(
      doc({
        segments: segs.length ? segs : [{ in: 0, out: 12 }],
        ...(multi
          ? {
              media: [
                {
                  id: 'b',
                  videoKey: 'blob:b',
                  cursor: cursorTrack().filter((e) => e.t < 4000),
                  meta: meta(4000),
                },
              ],
            }
          : {}),
        zoom: spans(3, 12).map(([a, b], i) => ({
          id: `z${i}`,
          in: a,
          out: b,
          level: r3(1.3 + rnd()),
          cx: r3(rnd()),
          cy: r3(rnd()),
          ...(rnd() < 0.4 ? { focusMode: 'auto' as const } : {}),
        })),
        speed: spans(2, 12).map(([a, b], i) => ({
          id: `s${i}`,
          in: a,
          out: b,
          rate: [0.5, 2, 4][i % 3],
        })),
        freeze: [
          { id: 'f0', at: r3(rnd() * 12), seconds: 1 },
          { id: 'f1', at: segs[0]?.out ?? 1, seconds: 0.5 },
        ],
        tilt: spans(2, 12).map(([a, b], i) => ({
          id: `t${i}`,
          in: a,
          out: b,
          rx: 5,
          ry: -8,
        })),
        source: {
          videoKey: 'blob:a',
          cursor: cursorTrack(),
          meta: meta(12000),
          camKey: 'blob:cam',
        },
        camMotion: spans(1, 12).map(([a, b], i) => ({
          id: `c${i}`,
          in: a,
          out: b,
          size: 0.3,
        })),
        ...(rnd() < 0.3
          ? { zoomStyle: 'cinema' as const }
          : { zoomStyle: 'glide' as const }),
      }),
    )
  }
  return out
}

describe('byte parity for a forward cut', () => {
  const corpus = forwardCorpus(60)

  it('every mapping answers the single-pass one', () => {
    for (const d of corpus) {
      const rated = ratedSegments(d)
      expect(hasReplay(rated)).toBe(false)
      for (const z of [...d.zoom, ...(d.tilt ?? [])]) {
        const legacy = legacyExtent(rated, z.in, z.out)
        expect(spanOutputExtents(rated, z.in, z.out)).toEqual(
          legacy ? [legacy] : [],
        )
      }
      for (const t of [0.5, 1, 3.3, 6, 9.9, 11]) {
        const legacy = legacyMoment(rated, t)
        expect(momentOutputs(rated, t)).toEqual(legacy === null ? [] : [legacy])
        const b = legacyMoment(rated, t, 'b')
        expect(momentOutputs(rated, t, 'b')).toEqual(b === null ? [] : [b])
      }
    }
  })

  it('the corpus lowers to the bytes it lowered to before replays', () => {
    const hash = createHash('sha256')
    for (const d of corpus) {
      const low = lowerToComposition(d)
      hash.update(JSON.stringify(low.data))
      hash.update(JSON.stringify(low.stack))
    }
    expect(hash.digest('hex')).toBe(
      'afb7986c77417be278e8c606bfdef50ab9cf4002f46da1580a5e6db092220c0d',
    )
  })
})
