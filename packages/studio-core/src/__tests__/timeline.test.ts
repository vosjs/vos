import { describe, expect, it } from 'vitest'
import {
  camLane,
  effectiveSegments,
  videoLane,
  zoomLane,
} from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc } from '../types'
import type { Recipe } from '@vosjs/editor'

// ---------------------------------------------------------------------------

const doc: ProjectDoc = {
  source: {
    videoKey: 'v',
    cursor: [],
    meta: {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 10_000,
      width: 1920,
      height: 1080,
      fps: 30,
    },
  },
  // keep 1..4 and 6..9 → output timeline: [0,3) = seg0, [3,6) = seg1
  segments: [
    { in: 1, out: 4 },
    { in: 6, out: 9 },
  ],
  audio: [],
  zoom: [
    { id: 'z0', in: 2, out: 3, level: 2, cx: 0.5, cy: 0.5, source: 'auto' },
    {
      id: 'z1',
      in: 4.5,
      out: 5.5,
      level: 1.8,
      cx: 0.5,
      cy: 0.5,
      source: 'auto',
    }, // in the cut
  ],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

const applied = (recipe: Recipe<ProjectDoc> | null): ProjectDoc => {
  expect(recipe).not.toBeNull()
  const draft = structuredClone(doc)
  recipe!(draft)
  return draft
}

describe('videoLane', () => {
  it('projects segments as concatenated clips', () => {
    expect(videoLane.items(doc)).toEqual([
      { id: 'seg-0', kind: 'clip', t: 0, duration: 3 },
      { id: 'seg-1', kind: 'clip', t: 3, duration: 3 },
    ])
  })

  it('materializes the full-source segment for untrimmed docs', () => {
    const untrimmed = { ...doc, segments: [] }
    expect(effectiveSegments(untrimmed)).toEqual([{ in: 0, out: 10 }])
    expect(videoLane.items(untrimmed)).toEqual([
      { id: 'seg-0', kind: 'clip', t: 0, duration: 10 },
    ])
  })

  it('resize start trims the segment head (output → source delta)', () => {
    // drag seg-1's start from output 3 to 4 → source in: 6 → 7
    const next = applied(
      videoLane.gesture(doc, {
        type: 'resize',
        id: 'seg-1',
        edge: 'start',
        t: 4,
      }),
    )
    expect(next.segments[1]).toEqual({ in: 7, out: 9 })
    expect(next.segments[0]).toEqual({ in: 1, out: 4 }) // neighbor untouched
  })

  it('resize end trims the tail and clamps to the source duration', () => {
    const next = applied(
      videoLane.gesture(doc, {
        type: 'resize',
        id: 'seg-1',
        edge: 'end',
        t: 99,
      }),
    )
    expect(next.segments[1]).toEqual({ in: 6, out: 10 })
  })

  it('create splits under the playhead without changing total duration', () => {
    const next = applied(videoLane.gesture(doc, { type: 'create', t: 1.5 }))
    expect(next.segments).toEqual([
      { in: 1, out: 2.5 },
      { in: 2.5, out: 4 },
      { in: 6, out: 9 },
    ])
  })

  it('split at a boundary is a null gesture (no dead undo entries)', () => {
    expect(videoLane.gesture(doc, { type: 'create', t: 3 })).toBeNull()
  })

  it('remove deletes a segment but never the last one', () => {
    const next = applied(
      videoLane.gesture(doc, { type: 'remove', id: 'seg-0' }),
    )
    expect(next.segments).toEqual([{ in: 6, out: 9 }])
    expect(videoLane.gesture(next, { type: 'remove', id: 'seg-0' })).toBeNull()
  })

  it('exposes clip boundaries as magnets', () => {
    expect(videoLane.magnets!(doc)).toEqual([0, 3, 6])
  })
})

describe('zoomLane', () => {
  it('maps source-anchored spans to output clips and hides cut ones', () => {
    const items = zoomLane.items(doc)
    expect(items).toHaveLength(1) // z1 lives in the cut region → hidden
    // source [2,3] → output [1,2], level printed on the clip
    expect(items[0]).toMatchObject({
      id: 'z0',
      kind: 'clip',
      t: 1,
      duration: 1,
      label: '2.00×',
    })
  })

  it('shows the kept extent of a partially-cut span', () => {
    const partial = structuredClone(doc)
    partial.zoom = [{ id: 'z0', in: 3, out: 7, level: 2, cx: 0.5, cy: 0.5 }]
    // kept footage [3,4]∪[6,7] → output [2,4] (the clip bridges the cut)
    expect(zoomLane.items(partial)[0]).toMatchObject({ t: 2, duration: 2 })
  })

  it('move retargets the source span (length kept) and promotes to manual', () => {
    // drag to output 4 → source 7 (inside seg-1)
    const next = applied(
      zoomLane.gesture(doc, { type: 'move', id: 'z0', t: 4 }),
    )
    const moved = next.zoom.find((z) => z.id === 'z0')!
    expect(moved.in).toBeCloseTo(7, 6)
    expect(moved.out).toBeCloseTo(8, 6)
    expect(moved.source).toBe('manual')
    expect([...next.zoom].sort((a, b) => a.in - b.in)).toEqual(next.zoom)
  })

  it('move pushes out of a collision toward the nearer side', () => {
    // Full source (no cuts), so the push resolves on kept footage.
    const colDoc = structuredClone(doc)
    colDoc.segments = []
    colDoc.zoom = [
      { id: 'z0', in: 2, out: 3, level: 2, cx: 0.5, cy: 0.5 },
      { id: 'zB', in: 6.5, out: 7.5, level: 2, cx: 0.5, cy: 0.5 },
    ]
    // no cuts ⇒ output == source: [6.4, 7.4] overlaps zB → pushed flush before
    const recipe = zoomLane.gesture(colDoc, { type: 'move', id: 'z0', t: 6.4 })
    expect(recipe).not.toBeNull()
    const draft = structuredClone(colDoc)
    recipe!(draft)
    const moved = draft.zoom.find((z) => z.id === 'z0')!
    expect(moved.in).toBeCloseTo(5.5, 6)
    expect(moved.out).toBeCloseTo(6.5, 6)
  })

  it('a push that would land the span in cut footage refuses', () => {
    // With [4,6] cut, flush-before-zB would put z0 at [5.5,6.5] — half in
    // removed footage, rendering half-width as if deleted. The move refuses;
    // a live drag simply holds its last valid position instead.
    const colDoc = structuredClone(doc)
    colDoc.zoom = [
      { id: 'z0', in: 2, out: 3, level: 2, cx: 0.5, cy: 0.5 },
      { id: 'zB', in: 6.5, out: 7.5, level: 2, cx: 0.5, cy: 0.5 },
    ]
    expect(
      zoomLane.gesture(colDoc, { type: 'move', id: 'z0', t: 3.4 }),
    ).toBeNull()
  })

  it('a move may straddle a cut — the cut is not a wall', () => {
    // Target output 2.9 → source 3.9; [3.9,4.9] hangs over the cut at 4 and
    // is allowed (decided 2026-08-24: a wall here blocked dragging anything
    // into the next clip). The lane draws the kept part.
    const lone = structuredClone(doc)
    lone.zoom = [doc.zoom[0]] // z1 sits in the cut and would push it back
    const recipe = zoomLane.gesture(lone, { type: 'move', id: 'z0', t: 2.9 })
    expect(recipe).not.toBeNull()
    const moved = structuredClone(lone)
    recipe!(moved)
    const z = moved.zoom.find((x) => x.id === 'z0')!
    expect(z.in).toBeCloseTo(3.9, 6)
    expect(z.out).toBeCloseTo(4.9, 6)
    expect(zoomLane.items(moved).find((i) => i.id === 'z0')).toBeTruthy()
  })

  it('resize maps the dragged edge pointer-true and clamps against neighbors', () => {
    const head = applied(
      zoomLane.gesture(doc, {
        type: 'resize',
        id: 'z0',
        edge: 'start',
        t: 0.5,
      }),
    )
    expect(head.zoom[0]).toMatchObject({ in: 1.5, out: 3, source: 'manual' }) // output 0.5 → source 1.5
    // dragging the end far right clamps flush against z1 (source 4.5)
    const tail = applied(
      zoomLane.gesture(doc, { type: 'resize', id: 'z0', edge: 'end', t: 4 }),
    )
    expect(tail.zoom[0]).toMatchObject({ in: 2, out: 4.5 })
  })

  it('create inserts a span in the free gap with a fresh id (and no-ops inside one)', () => {
    const next = applied(zoomLane.gesture(doc, { type: 'create', t: 0.5 }))
    const added = next.zoom.find((z) => z.id === 'u0')!
    expect(added.in).toBeCloseTo(1.5, 6) // output 0.5 → source 1.5
    expect(added.out).toBeCloseTo(2, 6) // truncated to the gap before z0
    expect(added.level).toBeGreaterThan(1)
    expect(added.source).toBe('manual')
    // playhead inside an existing span → null (no dead undo entries)
    expect(zoomLane.gesture(doc, { type: 'create', t: 1.5 })).toBeNull()
  })

  it('remove deletes by id and is null for unknown ids', () => {
    const next = applied(zoomLane.gesture(doc, { type: 'remove', id: 'z0' }))
    expect(next.zoom.map((z) => z.id)).toEqual(['z1'])
    expect(zoomLane.gesture(doc, { type: 'remove', id: 'nope' })).toBeNull()
  })

  it('move recipes address by ID — safe against a reordered live draft (anchoring contract)', () => {
    // Gesture evaluated against the drag-START doc…
    const recipe = zoomLane.gesture(doc, { type: 'move', id: 'z0', t: 4 })
    expect(recipe).not.toBeNull()
    // …but applied to a LIVE draft whose array was re-sorted mid-drag.
    const live = structuredClone(doc)
    live.zoom.reverse() // z1 now at index 0
    recipe!(live)
    const moved = live.zoom.find((z) => z.id === 'z0')!
    const untouched = live.zoom.find((z) => z.id === 'z1')!
    expect(moved.in).toBeCloseTo(7, 6) // output 4 → source 7
    expect(untouched.in).toBe(4.5)
  })

  it('exposes clip edges as magnets', () => {
    expect(zoomLane.magnets!(doc)).toEqual([1, 2])
  })
})

describe('camLane', () => {
  const camDoc: ProjectDoc = {
    ...doc,
    source: { ...doc.source, camKey: 'blob:cam' },
  }

  it('is empty without a webcam take or when the bubble is hidden', () => {
    expect(camLane.items(doc)).toEqual([])
    expect(
      camLane.items({ ...camDoc, cam: { ...camDoc.cam, visible: false } }),
    ).toEqual([])
  })

  it('mirrors the kept segments when no window is set (take group)', () => {
    // segments keep source 1..4 and 6..9 → output 0..6, split at 3 like the
    // Video row — a cut on the parent row visibly cuts this row too.
    expect(camLane.items(camDoc)).toEqual([
      { id: 'cam-0', kind: 'clip', t: 0, duration: 3 },
      { id: 'cam-1', kind: 'clip', t: 3, duration: 3 },
    ])
  })

  it('maps a source-time window onto the output timeline', () => {
    const windowed: ProjectDoc = {
      ...camDoc,
      cam: { ...camDoc.cam, window: { in: 2, out: 7 } },
    }
    // source 2 → output 1; source 7 → output 4 (source 4..6 is cut) — the
    // window renders per kept segment it overlaps.
    expect(camLane.items(windowed)).toEqual([
      { id: 'cam-0', kind: 'clip', t: 1, duration: 2 },
      { id: 'cam-1', kind: 'clip', t: 3, duration: 1 },
    ])
  })

  it('resize edges write a clamped source-time window', () => {
    const trimmed = applied(
      camLane.gesture(camDoc, {
        type: 'resize',
        id: 'cam-0', // the window's real start edge = the FIRST clip
        edge: 'start',
        t: 1,
      }),
    )
    expect(trimmed.cam.window).toEqual({ in: 2, out: 10 }) // output 1 → source 2; out defaults to source end
    const both = applied(
      camLane.gesture(trimmed, {
        type: 'resize',
        id: 'cam-1', // the window's real end edge = the LAST clip
        edge: 'end',
        t: 4,
      }),
    )
    expect(both.cam.window).toEqual({ in: 2, out: 7 }) // output 4 → source 7
    // clamped: can never invert
    const inverted = applied(
      camLane.gesture(both, {
        type: 'resize',
        id: 'cam-1',
        edge: 'end',
        t: -99,
      }),
    )
    expect(inverted.cam.window!.out).toBeGreaterThan(inverted.cam.window!.in)
  })

  it('only responds to resize on its own clip', () => {
    expect(
      camLane.gesture(camDoc, { type: 'remove', id: 'cam-window' }),
    ).toBeNull()
    expect(
      camLane.gesture(camDoc, {
        type: 'resize',
        id: 'seg-0',
        edge: 'end',
        t: 1,
      }),
    ).toBeNull()
  })
})

describe('anchored trim restores footage (the drag-back scenario)', () => {
  it('a trimmed head can be dragged back out with an out-of-timeline target', () => {
    // trim the first clip's head: source 1→2 (clip starts at output 0)
    const trimmed = applied(
      videoLane.gesture(doc, {
        type: 'resize',
        id: 'seg-0',
        edge: 'start',
        t: 1,
      }),
    )
    expect(trimmed.segments[0]).toEqual({ in: 2, out: 4 })
    // drag back: anchored delta puts the target BEFORE output 0 (t = -1.5);
    // the lane clamps in source space → footage restored down to source 0.5
    const restored = applied(
      videoLane.gesture(trimmed, {
        type: 'resize',
        id: 'seg-0',
        edge: 'start',
        t: -1.5,
      }),
    )
    expect(restored.segments[0]).toEqual({ in: 0.5, out: 4 })
    // and all the way past the media start clamps at 0
    const full = applied(
      videoLane.gesture(restored, {
        type: 'resize',
        id: 'seg-0',
        edge: 'start',
        t: -99,
      }),
    )
    expect(full.segments[0]).toEqual({ in: 0, out: 4 })
  })
})
