import { describe, expect, it } from 'vitest'
import { mapTime, totalDuration } from '@vosjs/timeline'
import {
  END_CARD_FROM,
  cardPoseTrack,
  entranceTiltKeyframes,
  entranceZoomKeyframes,
  expandEndCard,
  migrateMotion,
  outputEnd,
  prependEntrance,
  withHolds,
} from '../lower/motion'
import { lowerToComposition, ratedSegments } from '../lower/lowerToComposition'
import { docOutputDuration } from '../audioBeds'
import { lastLayerEnd } from '../anim'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc, TextOverlayClip } from '../types'

/**
 * How the card moves and how a cut ends, as data: a hold is a rated piece
 * that plays the segment's last frame for its seconds (the freeze
 * primitive); the card's `anim.enter` writes the head of the tilt or zoom
 * track and a card-pose track; its `anim.exit` writes that track's tail;
 * the output lasts until the last visual clip ends. The two legacy
 * spellings (`frame.entrance`, `doc.endCard`) migrate on read into exactly
 * that, and a doc with none of them lowers byte-identically.
 */

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20000,
        width: 1600,
        height: 900,
        fps: 30,
      },
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

const title = (
  id: string,
  start: number,
  duration: number,
): TextOverlayClip => ({
  id,
  kind: 'text',
  text: 'Ship it',
  preset: 'title',
  start,
  duration,
  transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
})

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

describe("the card's enter", () => {
  it('tilt-in writes the tilt head; pull-out writes the zoom head; none writes nothing', () => {
    expect(entranceTiltKeyframes({ kind: 'tilt-in' })).toHaveLength(2)
    expect(entranceTiltKeyframes({ kind: 'tilt-in' })[1].t).toBeCloseTo(1.2, 6)
    expect(entranceTiltKeyframes({ kind: 'rise' })).toEqual([])
    expect(entranceZoomKeyframes({ kind: 'pull-out', seconds: 2 })[1].t).toBe(2)
    // A tilt-in rests the camera through the entrance.
    expect(
      entranceZoomKeyframes({ kind: 'tilt-in' }).map((k) => k.value),
    ).toEqual([
      [1, 0.5, 0.5],
      [1, 0.5, 0.5],
    ])
    expect(entranceTiltKeyframes({ kind: 'none' })).toEqual([])
    expect(entranceTiltKeyframes(undefined)).toEqual([])
  })

  it('prepending gives the entrance the head of the track', () => {
    const track = {
      keyframes: [
        { t: 0, value: [0, 0] },
        { t: 0.4, value: [3, 3] },
        { t: 4, value: [0, 0] },
      ],
    }
    const out = prependEntrance(
      track,
      entranceTiltKeyframes({ kind: 'tilt-in' }),
    )!
    expect(out.keyframes[0].t).toBe(0)
    expect(out.keyframes[0].value).toEqual([-9, 14])
    expect(out.keyframes.map((k) => k.t)).toEqual([0, 1.2, 4])
    expect(prependEntrance(track, [])).toBe(track)
    expect(prependEntrance(undefined, [])).toBeUndefined()
  })
})

describe('the card-pose track', () => {
  it('is absent with neither an enter nor an exit', () => {
    expect(cardPoseTrack(undefined, undefined, 10)).toBeUndefined()
    expect(
      cardPoseTrack({ kind: 'none' }, { kind: 'none' }, 10, 12),
    ).toBeUndefined()
  })

  it('settles the card in from a smaller, lower, softer pose', () => {
    const enter = cardPoseTrack({ kind: 'tilt-in' }, undefined, 10)!
    expect(enter.keyframes[0].value).toEqual([0.94, 0.05, 0.7])
    expect(enter.keyframes[1].value).toEqual([1, 0, 1])
    expect(
      cardPoseTrack({ kind: 'rise' }, undefined, 10)!.keyframes[0].value,
    ).toEqual([0.96, 0.08, 0.7])
  })

  it('recedes FROM the footage end when something plays after it', () => {
    const both = cardPoseTrack(
      { kind: 'rise', seconds: 1 },
      { kind: 'recede', seconds: 0.7 },
      10,
      12.5,
    )!
    expect(both.keyframes.map((k) => k.t)).toEqual([0, 1, 10, 10.7])
    expect(both.keyframes[3].value[2]).toBeCloseTo(0.22, 6)
  })

  it('leaves BY the footage end when nothing does, and a fade goes to nothing', () => {
    const tail = cardPoseTrack(undefined, { kind: 'fade' }, 10)!
    expect(tail.keyframes.map((k) => k.t)).toEqual([10 - 0.35, 10])
    expect(tail.keyframes[1].value).toEqual([1, 0, 0])
  })
})

describe('the output ends at the last clip', () => {
  it('a doc that ends on its footage answers the footage end', () => {
    expect(outputEnd(doc(), 10)).toBe(10)
    expect(lastLayerEnd({ overlays: [], objects: [] })).toBe(0)
    expect(docOutputDuration(doc())).toBeCloseTo(10, 6)
  })

  it('a clip past the footage extends the output; the card holds its last frame there', () => {
    const d = doc({ overlays: [title('t', 9, 4)] })
    expect(docOutputDuration(d)).toBeCloseTo(13, 6)
    const { data } = lowerToComposition(d)
    expect(data.duration).toBeCloseTo(13, 6)
    const segs = data.segments as { in: number; out: number }[]
    expect(mapTime(segs, 12.5)).toBeCloseTo(12, 6)
  })

  it('a prop with a span counts; one that is always on extends nothing; audio never does', () => {
    expect(
      lastLayerEnd({
        overlays: [],
        objects: [
          {
            id: 'p',
            asset: { kind: 'primitive', shape: 'cube' },
            transform3d: {
              x: 0.5,
              y: 0.5,
              z: 0,
              rx: 0,
              ry: 0,
              rz: 0,
              scale: 0.2,
            },
          },
          {
            id: 'q',
            asset: { kind: 'primitive', shape: 'cube' },
            span: { start: 11, duration: 3 },
            transform3d: {
              x: 0.5,
              y: 0.5,
              z: 0,
              rx: 0,
              ry: 0,
              rz: 0,
              scale: 0.2,
            },
          },
        ],
      }),
    ).toBe(14)
    const d = doc({
      audio: [
        {
          id: 'a',
          key: 'x.mp3',
          name: 'x',
          start: 0,
          in: 0,
          out: 30,
          duration: 30,
          gain: 1,
          fadeIn: 0,
          fadeOut: 0,
        },
      ],
    })
    expect(docOutputDuration(d)).toBeCloseTo(10, 6)
  })
})

describe('the migration (one vocabulary)', () => {
  it('returns the same object when there is nothing to migrate', () => {
    const d = doc({
      frame: {
        ...DEFAULT_FRAME_STYLE,
        browserBar: DEFAULT_BROWSER_BAR,
        anim: { enter: 'rise' },
      },
      overlays: [title('t', 0, 2)],
    })
    expect(migrateMotion(d)).toBe(d)
  })

  it('an entrance becomes the card enter; clip spellings become anim; a prop animation becomes idle', () => {
    const d = doc({
      frame: {
        ...DEFAULT_FRAME_STYLE,
        browserBar: DEFAULT_BROWSER_BAR,
        entrance: { kind: 'tilt-in', seconds: 2 },
      },
      overlays: [
        { ...title('a', 0, 2), enter: 'fade', exit: 'none' },
        {
          ...title('b', 0, 2),
          fx: { fx: 'typewriter', unit: 'char', stagger: 0.04 },
        },
        title('c', 0, 2),
      ],
      objects: [
        {
          id: 'p',
          asset: { kind: 'primitive', shape: 'cube' },
          transform3d: {
            x: 0.5,
            y: 0.5,
            z: 0,
            rx: 0,
            ry: 0,
            rz: 0,
            scale: 0.2,
          },
          animation: 'spin',
        },
      ],
    })
    const m = migrateMotion(d)
    expect(m).not.toBe(d)
    expect(m.frame.entrance).toBeUndefined()
    expect(m.frame.anim).toEqual({ enter: { kind: 'tilt-in', seconds: 2 } })
    const [a, b, c] = m.overlays!
    expect(a.anim).toEqual({ enter: 'fade', exit: 'none' })
    expect(a.enter).toBeUndefined()
    expect(b.anim).toEqual({
      enter: { kind: 'typewriter', unit: 'char', stagger: 0.04 },
    })
    expect((b as TextOverlayClip).fx).toBeUndefined()
    expect(c).toBe(d.overlays![2])
    expect(m.objects![0].anim).toEqual({ idle: 'spin' })
    expect(m.objects![0].animation).toBeUndefined()
  })

  it('an end card becomes clips after the footage and a card exit, with no hold', () => {
    const d = doc({
      endCard: {
        seconds: 3,
        headline: 'Ship it',
        sub: 'v1.7',
        wordmark: 'brand',
      },
    })
    const m = migrateMotion(d)
    expect(m.endCard).toBeUndefined()
    expect(m.segments[0].hold).toBeUndefined()
    expect(m.frame.anim).toEqual({ exit: { kind: 'recede', seconds: 0.7 } })
    const clips = m.overlays!
    expect(clips.map((c) => c.id)).toEqual([
      'endcard-title',
      'endcard-sub',
      'endcard-mark',
    ])
    expect(clips.every((c) => c.from === END_CARD_FROM)).toBe(true)
    expect(clips[0]).toMatchObject({
      kind: 'text',
      preset: 'title',
      text: 'Ship it',
      anim: { enter: 'rise', exit: 'none' },
    })
    expect(clips[0].start).toBeCloseTo(10.35, 6)
    expect(clips[0].start + clips[0].duration).toBeCloseTo(13, 6)
    expect(docOutputDuration(m)).toBeCloseTo(13, 6)
  })

  it('a legacy doc and its migration lower to the same data', () => {
    const legacy = doc({
      frame: {
        ...DEFAULT_FRAME_STYLE,
        browserBar: DEFAULT_BROWSER_BAR,
        entrance: { kind: 'tilt-in' },
      },
      endCard: { seconds: 2, headline: 'Ship it' },
      overlays: [{ ...title('a', 1, 2), fx: { fx: 'pop', unit: 'word' } }],
    })
    const migrated = migrateMotion(legacy)
    const a = lowerToComposition(legacy)
    const b = lowerToComposition(migrated)
    expect(a.data).toEqual(b.data)
    expect(a.stack).toEqual(b.stack)
    expect(a.config.onFrame).toBe(b.config.onFrame)
  })

  it('the old expansion still answers the hold shape for a caller that wants it', () => {
    const d = doc({ endCard: { seconds: 3, headline: 'Ship it' } })
    const r = expandEndCard(d, totalDuration(ratedSegments(d)))
    expect(r.endStart).toBeCloseTo(10, 6)
    expect((r.doc.segments[0] as { hold?: number }).hold).toBe(3)
    const plain = doc()
    expect(expandEndCard(plain, 10).doc).toBe(plain)
  })
})

describe('lowering', () => {
  it('a plain doc carries no pose track and no tilt track', () => {
    const { data } = lowerToComposition(doc())
    expect(data.cardPoseTrack).toBeUndefined()
    expect(data.tiltTrack).toBeUndefined()
  })

  it('a card enter and an end card lower into the tracks and the length', () => {
    const { data, config } = lowerToComposition(
      doc({
        frame: {
          ...DEFAULT_FRAME_STYLE,
          browserBar: DEFAULT_BROWSER_BAR,
          entrance: { kind: 'tilt-in' },
        },
        endCard: { seconds: 2, headline: 'Ship it' },
      }),
    )
    const tilt = data.tiltTrack as {
      keyframes: { t: number; value: number[] }[]
    }
    expect(tilt.keyframes[0].value).toEqual([-9, 14])
    const pose = data.cardPoseTrack as { keyframes: { t: number }[] }
    expect(pose.keyframes.map((k) => k.t)).toEqual([0, 1.2, 10, 10.7])
    expect(data.duration).toBeCloseTo(12, 6)
    expect(String(config.onFrame)).toContain('cardPoseTrack')
  })

  it('a per-unit enter bakes fx and a block enter bakes the transition, as the old spellings did', () => {
    const { stack } = lowerToComposition(
      doc({
        overlays: [
          { ...title('a', 0, 2), anim: { enter: 'fade', exit: 'none' } },
          {
            ...title('b', 0, 2),
            anim: { enter: { kind: 'typewriter', unit: 'char' } },
          },
          {
            ...title('c', 0, 2),
            anim: { enter: { kind: 'rise', seconds: 0.8 } },
          },
        ],
      }),
    )
    const entry = Object.values(stack)[0] as {
      overlays: Record<string, unknown>[]
    }
    const [a, b, c] = entry.overlays
    expect(a.enter).toBe('fade')
    expect(a.exit).toBe('none')
    expect(a.fx).toBeUndefined()
    expect(b.enter).toBe('rise')
    expect((b.fx as { k: string; u: string }).k).toBe('typewriter')
    expect((b.fx as { k: string; u: string }).u).toBe('char')
    expect((c.fx as { k: string; u: string; dur: number }).u).toBe('block')
    expect((c.fx as { dur: number }).dur).toBeCloseTo(0.8, 6)
  })
})
