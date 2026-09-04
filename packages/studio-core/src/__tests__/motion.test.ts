import { describe, expect, it } from 'vitest'
import { mapTime, totalDuration } from '@vosjs/timeline'
import {
  cardPoseTrack,
  entranceTiltKeyframes,
  entranceZoomKeyframes,
  expandEndCard,
  prependEntrance,
  withHolds,
} from '../lower/motion'
import { lowerToComposition, ratedSegments } from '../lower/lowerToComposition'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'

/**
 * The clip's presentation moves: a hold is a rated piece that plays the
 * segment's last frame for its seconds; the entrance writes the head of
 * the tilt or zoom track and a card-pose track; the end card is a hold
 * plus text overlays over a receding card. A doc with none of them lowers
 * byte-identically (no pose track, no extra keyframes).
 */

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: { dpr: 1, zoom: 1, t0: 0, durationMs: 20000, width: 1600, height: 900, fps: 30 },
    },
    segments: [{ in: 2, out: 12 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...DEFAULT_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

describe('withHolds', () => {
  it('a held segment freezes on its last frame for its seconds', () => {
    const segs = [{ in: 2, out: 12, hold: 2.5 }]
    const rated = withHolds(segs, [{ in: 2, out: 12 }])
    expect(rated).toHaveLength(2)
    expect(totalDuration(rated)).toBeCloseTo(12.5, 6)
    // Inside the hold, source time stays at the segment's end.
    expect(mapTime(rated, 11)).toBeCloseTo(12, 2)
    expect(mapTime(rated, 12.4)).toBeCloseTo(12, 2)
    expect(mapTime(rated, 5)).toBeCloseTo(7, 6)
  })

  it('a hold lands after the last rated piece of its segment, through a speed split', () => {
    const rated = withHolds(
      [{ in: 2, out: 12, hold: 1 }],
      [
        { in: 2, out: 6 },
        { in: 6, out: 12, rate: 2 },
      ],
    )
    expect(rated).toHaveLength(3)
    expect(rated[2].in).toBeCloseTo(12 - 0.002, 6)
    expect(totalDuration(rated)).toBeCloseTo(4 + 3 + 1, 6)
  })

  it('no hold, no change', () => {
    const rated = [{ in: 2, out: 12 }]
    expect(withHolds([{ in: 2, out: 12 }], rated)).toEqual(rated)
  })
})

describe('the entrance', () => {
  it('tilt-in writes the tilt head; pull-out writes the zoom head; none writes nothing', () => {
    expect(entranceTiltKeyframes({ kind: 'tilt-in' })).toHaveLength(2)
    expect(entranceTiltKeyframes({ kind: 'tilt-in' })[1].t).toBeCloseTo(1.2, 6)
    expect(entranceTiltKeyframes({ kind: 'rise' })).toEqual([])
    expect(entranceZoomKeyframes({ kind: 'pull-out', seconds: 2 })[1].t).toBe(2)
    expect(entranceZoomKeyframes({ kind: 'tilt-in' })).toEqual([])
    expect(entranceTiltKeyframes({ kind: 'none' })).toEqual([])
    expect(entranceTiltKeyframes(undefined)).toEqual([])
  })

  it('prepending gives the entrance the head of the track', () => {
    const track = { keyframes: [{ t: 0, value: [0, 0] }, { t: 0.4, value: [3, 3] }, { t: 4, value: [0, 0] }] }
    const out = prependEntrance(track, entranceTiltKeyframes({ kind: 'tilt-in' }))!
    expect(out.keyframes[0].t).toBe(0)
    expect(out.keyframes[0].value).toEqual([-9, 14])
    expect(out.keyframes.map((k) => k.t)).toEqual([0, 1.2, 4])
    expect(prependEntrance(track, [])).toBe(track)
    expect(prependEntrance(undefined, [])).toBeUndefined()
  })

  it('the pose track settles in and, with an end card, recedes', () => {
    expect(cardPoseTrack(undefined, null, 0)).toBeUndefined()
    const enter = cardPoseTrack({ kind: 'tilt-in' }, null, 0)!
    expect(enter.keyframes[0].value).toEqual([0.94, 0.05, 0])
    expect(enter.keyframes[1].value).toEqual([1, 0, 1])
    const both = cardPoseTrack({ kind: 'rise', seconds: 1 }, 10, 2.5)!
    expect(both.keyframes.map((k) => k.t)).toEqual([0, 1, 10, 10.7])
    expect(both.keyframes[3].value[2]).toBeCloseTo(0.22, 6)
  })
})

describe('the end card', () => {
  it('holds the last segment and rises the words as house overlays', () => {
    const d = doc({ endCard: { seconds: 3, headline: 'Ship it', sub: 'v1.7', wordmark: 'brand' } })
    const before = totalDuration(ratedSegments(d))
    const r = expandEndCard(d, before)
    expect(r.endStart).toBeCloseTo(10, 6)
    expect(r.seconds).toBe(3)
    expect((r.doc.segments[0] as { hold?: number }).hold).toBe(3)
    expect(totalDuration(ratedSegments(r.doc))).toBeCloseTo(13, 6)
    const clips = r.doc.overlays!
    expect(clips.map((c) => c.id)).toEqual(['endcard-title', 'endcard-sub', 'endcard-mark'])
    expect(clips[0]).toMatchObject({ kind: 'text', preset: 'title', text: 'Ship it', enter: 'rise' })
    expect(clips[0].start).toBeCloseTo(10.35, 6)
    expect(clips[0].start + clips[0].duration).toBeCloseTo(13, 6)
  })

  it('a doc with no end card comes back as itself', () => {
    const d = doc()
    expect(expandEndCard(d, 10).doc).toBe(d)
  })
})

describe('lowering', () => {
  it('a plain doc carries no pose track and no tilt track', () => {
    const { data } = lowerToComposition(doc())
    expect(data.cardPoseTrack).toBeUndefined()
    expect(data.tiltTrack).toBeUndefined()
  })

  it('an entrance and an end card lower into the tracks and the length', () => {
    const { data, config } = lowerToComposition(
      doc({
        frame: { ...DEFAULT_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR, entrance: { kind: 'tilt-in' } },
        endCard: { seconds: 2, headline: 'Ship it' },
      }),
    )
    const tilt = data.tiltTrack as { keyframes: { t: number; value: number[] }[] }
    expect(tilt.keyframes[0].value).toEqual([-9, 14])
    const pose = data.cardPoseTrack as { keyframes: { t: number }[] }
    expect(pose.keyframes.map((k) => k.t)).toEqual([0, 1.2, 10, 10.7])
    expect(data.duration).toBeCloseTo(12, 6)
    expect(String(config.onFrame)).toContain('cardPoseTrack')
  })
})
