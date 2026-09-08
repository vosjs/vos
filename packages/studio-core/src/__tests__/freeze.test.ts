import { describe, expect, it } from 'vitest'
import { mapTime, totalDuration } from '@vosjs/timeline'
import { DOC_SCHEMA_VERSION, migrateHostedDoc } from '../docVersion'
import { ratedSegments } from '../lower/lowerToComposition'
import {
  docFreezes,
  docRestTime,
  migrateMotion,
  placeFreezes,
  withHolds,
} from '../lower/motion'
import { freezeLane, speedLane, videoLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  FREEZE_DEFAULT_SECONDS,
} from '../types'
import type { ProjectDoc } from '../types'

/**
 * A FREEZE is the retime primitive beside a speed span: a source moment
 * held for output seconds, placed as a rated piece wherever it sits (the
 * middle of the footage included), drawn as a band on the retime lane,
 * and read from a legacy segment `hold` as a freeze at that segment's end.
 */
function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 10000,
        width: 1600,
        height: 900,
        fps: 30,
      },
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

const apply = (d: ProjectDoc, patch: ((d: ProjectDoc) => void) | null) => {
  expect(patch).not.toBeNull()
  const next = structuredClone(d)
  patch!(next)
  return next
}

describe('placeFreezes', () => {
  it('splits the piece at a mid-footage moment and holds the frame there', () => {
    const { pieces, marks } = placeFreezes(
      [{ in: 0, out: 10 }],
      [{ id: 'f0', at: 4, seconds: 2 }],
    )
    expect(pieces.map((p) => [p.in, p.out])).toEqual([
      [0, 4],
      [3.998, 4],
      [4, 10],
    ])
    expect(totalDuration(pieces)).toBeCloseTo(12, 6)
    expect(marks.get('f0')).toEqual({ t: 4, duration: 2 })
    // Inside the freeze the source barely moves; after it, footage resumes.
    expect(mapTime(pieces, 5)).toBeCloseTo(3.999, 3)
    expect(mapTime(pieces, 7)).toBeCloseTo(5, 6)
  })

  it('places a freeze at a segment end after it, at a cut before the next, and never off kept footage', () => {
    const rated = [
      { in: 0, out: 4 },
      { in: 6, out: 10 },
    ]
    const { pieces, marks } = placeFreezes(rated, [
      { id: 'end', at: 4, seconds: 1 },
      { id: 'cut', at: 6, seconds: 1 },
      { id: 'gone', at: 5, seconds: 1 },
      { id: 'late', at: 12, seconds: 1 },
    ])
    expect(pieces.map((p) => [p.in, p.out])).toEqual([
      [0, 4],
      [3.998, 4],
      [5.998, 6],
      [6, 10],
    ])
    expect([...marks.keys()].sort()).toEqual(['cut', 'end'])
    expect(marks.get('end')?.t).toBe(4)
    expect(marks.get('cut')?.t).toBe(5)
  })

  it('holds the very first frame when the moment is zero', () => {
    const { pieces } = placeFreezes(
      [{ in: 0, out: 10 }],
      [{ id: 'f0', at: 0, seconds: 1 }],
    )
    expect(pieces[0]).toEqual({ in: 0, out: 0.002, rate: 0.002 })
    expect(pieces[1]).toEqual({ in: 0, out: 10 })
  })

  it('a legacy segment hold places exactly where its freeze does', () => {
    const segs = [
      { in: 0, out: 4, hold: 2 },
      { in: 6, out: 10, hold: 3 },
    ]
    const legacy = withHolds(segs, segs)
    const freezes = docFreezes({ segments: segs, freeze: undefined })
    expect(freezes).toEqual([
      { id: 'h0', at: 4, seconds: 2 },
      { id: 'h1', at: 10, seconds: 3 },
    ])
    expect(placeFreezes(segs, freezes).pieces).toEqual(legacy)
    expect(ratedSegments(doc({ segments: segs }))).toEqual(legacy)
  })
})

describe('migrateMotion: a segment hold becomes a freeze', () => {
  it('moves the hold onto doc.freeze and strips the field', () => {
    const d = doc({
      segments: [
        { in: 0, out: 4, hold: 2 },
        { in: 6, out: 10 },
      ],
    })
    const next = migrateMotion(d)
    expect(next).not.toBe(d)
    expect(next.segments).toEqual([
      { in: 0, out: 4 },
      { in: 6, out: 10 },
    ])
    expect(next.freeze).toEqual([{ id: 'f0', at: 4, seconds: 2 }])
    // Idempotent, and identity-preserving once migrated.
    expect(migrateMotion(next)).toBe(next)
    // The lowering sees the same rated pieces either way.
    const bare = (l: { in: number; out: number; rate?: number }[]) =>
      l.map((x) => [x.in, x.out, x.rate ?? 1])
    expect(bare(ratedSegments(next))).toEqual(bare(ratedSegments(d)))
  })

  it('keeps the freezes a document already spells and picks free ids', () => {
    const d = doc({
      segments: [{ in: 0, out: 10, hold: 1 }],
      freeze: [{ id: 'f0', at: 3, seconds: 2 }],
    })
    expect(migrateMotion(d).freeze).toEqual([
      { id: 'f0', at: 3, seconds: 2 },
      { id: 'f1', at: 10, seconds: 1 },
    ])
  })

  it('migrateHostedDoc runs it as the v4 step', () => {
    const raw = {
      docSchemaVersion: 3,
      source: { meta: { durationMs: 10000 } },
      segments: [{ in: 0, out: 10, hold: 2 }],
    }
    const out = migrateHostedDoc(raw)
    expect(out.docSchemaVersion).toBe(DOC_SCHEMA_VERSION)
    expect(DOC_SCHEMA_VERSION).toBe(4)
    expect(out.segments).toEqual([{ in: 0, out: 10 }])
    expect(out.freeze).toEqual([{ id: 'f0', at: 10, seconds: 2 }])
  })
})

describe('docRestTime: where the last freeze begins', () => {
  it('reads a mid-footage freeze, a spelled one and a legacy hold alike', () => {
    expect(docRestTime(doc())).toBeNull()
    expect(
      docRestTime(doc({ freeze: [{ id: 'f0', at: 4, seconds: 2 }] })),
    ).toBe(4)
    expect(
      docRestTime(
        doc({
          freeze: [
            { id: 'f0', at: 2, seconds: 1 },
            { id: 'f1', at: 8, seconds: 1 },
          ],
        }),
      ),
    ).toBe(9)
    expect(docRestTime(doc({ segments: [{ in: 0, out: 10, hold: 3 }] }))).toBe(
      10,
    )
  })

  it('tolerates a raw hosted payload with no frame', () => {
    const raw = {
      source: { meta: { durationMs: 10000 } },
      segments: [{ in: 0, out: 10 }],
      freeze: [{ id: 'f0', at: 6, seconds: 2 }],
    } as unknown as ProjectDoc
    expect(docRestTime(raw)).toBe(6)
  })
})

describe('the video lane with a freeze on it', () => {
  it('lengthens the clip by its freeze and pushes the clips after it', () => {
    const d = doc({
      segments: [
        { in: 0, out: 4 },
        { in: 6, out: 10 },
      ],
      freeze: [{ id: 'f0', at: 2, seconds: 3 }],
    })
    expect(videoLane.items(d)).toEqual([
      { id: 'seg-0', kind: 'clip', t: 0, duration: 7 },
      { id: 'seg-1', kind: 'clip', t: 7, duration: 4 },
    ])
    expect(videoLane.magnets?.(d)).toEqual([0, 7, 11])
  })

  it('a split inside the band does nothing; past it the cut lands on the right frame', () => {
    const d = doc({ freeze: [{ id: 'f0', at: 4, seconds: 2 }] })
    expect(videoLane.gesture(d, { type: 'create', t: 5 })).toBeNull()
    const next = apply(d, videoLane.gesture(d, { type: 'create', t: 8 }))
    // Output 8 s = 4 s of footage + 2 s frozen + 2 s of footage: source 6.
    expect(next.segments).toEqual([
      { in: 0, out: 6 },
      { in: 6, out: 10 },
    ])
    // The freeze rides its frame: still inside the first clip.
    expect(videoLane.items(next).map((i) => i.duration)).toEqual([8, 4])
  })
})

describe('the freeze lane', () => {
  it('draws each freeze at its output place, seconds wide, and none off kept footage', () => {
    const d = doc({
      segments: [{ in: 2, out: 8 }],
      freeze: [
        { id: 'f0', at: 5, seconds: 1.5 },
        { id: 'gone', at: 9, seconds: 1 },
      ],
    })
    expect(freezeLane.items(d)).toEqual([
      { id: 'f0', kind: 'clip', t: 3, duration: 1.5, label: '1.5s' },
    ])
  })

  it('creates at the playhead, not inside a band, not off footage', () => {
    const d = doc({ segments: [{ in: 2, out: 8 }] })
    const next = apply(d, freezeLane.gesture(d, { type: 'create', t: 3 }))
    expect(next.freeze).toEqual([
      { id: 'f0', at: 5, seconds: FREEZE_DEFAULT_SECONDS },
    ])
    expect(freezeLane.gesture(next, { type: 'create', t: 4 })).toBeNull()
    expect(freezeLane.gesture(d, { type: 'create', t: 20 })).toBeNull()
  })

  it('resizes the end edge into seconds and moves pointer-true', () => {
    const d = doc({ freeze: [{ id: 'f0', at: 4, seconds: 2 }] })
    const longer = apply(
      d,
      freezeLane.gesture(d, { type: 'resize', id: 'f0', edge: 'end', t: 7.5 }),
    )
    expect(longer.freeze).toEqual([{ id: 'f0', at: 4, seconds: 3.5 }])
    // Moving to output 7 s through the map WITHOUT this freeze: source 7.
    const moved = apply(
      d,
      freezeLane.gesture(d, { type: 'move', id: 'f0', t: 7 }),
    )
    expect(moved.freeze).toEqual([{ id: 'f0', at: 7, seconds: 2 }])
  })

  it('edits a legacy hold by spelling it as a freeze first', () => {
    const d = doc({ segments: [{ in: 0, out: 10, hold: 2 }] })
    expect(freezeLane.items(d)).toEqual([
      { id: 'h0', kind: 'clip', t: 10, duration: 2, label: '2s' },
    ])
    const next = apply(
      d,
      freezeLane.gesture(d, { type: 'resize', id: 'h0', edge: 'end', t: 13 }),
    )
    expect(next.segments).toEqual([{ in: 0, out: 10 }])
    expect(next.freeze).toEqual([{ id: 'f0', at: 10, seconds: 3 }])
    const gone = apply(d, freezeLane.gesture(d, { type: 'remove', id: 'h0' }))
    expect(gone.freeze).toEqual([])
    expect(gone.segments).toEqual([{ in: 0, out: 10 }])
  })

  it('leaves the speed lane its own bands', () => {
    const d = doc({
      speed: [{ id: 's0', in: 0, out: 4, rate: 2 }],
      freeze: [{ id: 'f0', at: 2, seconds: 1 }],
    })
    expect(speedLane.items(d)[0].t).toBe(0)
    expect(freezeLane.items(d)[0]).toMatchObject({ t: 1, duration: 1 })
  })
})
