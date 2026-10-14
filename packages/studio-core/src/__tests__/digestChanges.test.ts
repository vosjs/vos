import { describe, expect, it } from 'vitest'
import {
  CHANGE_FLOOR,
  ambientDrift,
  changedRegion,
  pickChange,
} from '../digest/changes'
import { momentsFromDoc, planForDigest } from '../digest/moments'
import { projectFromArtifact } from '../ingest'
import type { CursorEvent, ProjectDoc, RecordingMeta } from '../types'

/**
 * The digest sees consequences: the region a click or a typing run changed
 * in the seconds after it becomes a `changed` moment, framed where the
 * page answered, naming the moment it answers.
 */
const W = 1280
const H = 720

function grid(w: number, h: number, fill: (x: number, y: number) => number) {
  const luma = new Array<number>(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) luma[y * w + x] = fill(x, y)
  return { w, h, luma }
}

describe('changedRegion', () => {
  it('finds the box of the cells that moved, as frame fractions', () => {
    const before = grid(16, 9, () => 10)
    // A dialog: a block from (4,2) to (11,6) went bright.
    const after = grid(16, 9, (x, y) =>
      x >= 4 && x <= 11 && y >= 2 && y <= 6 ? 200 : 10,
    )
    const r = changedRegion(before, after, 24)
    expect(r?.fraction).toBeCloseTo((8 * 5) / (16 * 9), 6)
    expect(r?.rect).toEqual({ x: 4 / 16, y: 2 / 9, w: 8 / 16, h: 5 / 9 })
  })

  it('discounts what each cell moves by on its own', () => {
    // An animated background: the left half drifts 60 luma per half second.
    const earlier = grid(16, 9, (x) => (x < 8 ? 100 : 10))
    const before = grid(16, 9, (x) => (x < 8 ? 160 : 10))
    const rate = ambientDrift(earlier, before, 0.5)!
    expect(rate[0]).toBe(120)
    expect(rate[15]).toBe(0)
    // 0.8 s after the press the background has drifted on (96 more) and a
    // card appeared at right.
    const after = grid(16, 9, (x, y) =>
      x < 8 ? 64 : x >= 10 && x <= 13 && y >= 3 && y <= 5 ? 220 : 10,
    )
    // Undiscounted, the drifting half counts and the box reaches it;
    // discounted, it contributes nothing and the box is the card's.
    expect(changedRegion(before, after, 24)?.rect.x).toBe(0)
    const r = changedRegion(before, after, 24, 1, { rate, dt: 0.8 })
    expect(r?.rect).toEqual({ x: 10 / 16, y: 3 / 9, w: 4 / 16, h: 3 / 9 })
    expect(r?.fraction).toBeCloseTo((4 * 3) / (16 * 9), 6)
  })

  it('a haze is scattered cells that never join: the largest cluster is one cell, under the floor', () => {
    const before = grid(16, 9, () => 10)
    // Flickers at the four corners: four clusters of one.
    const after = grid(16, 9, (x, y) =>
      (x === 0 || x === 15) && (y === 0 || y === 8) ? 200 : 10,
    )
    const r = changedRegion(before, after, 24)
    expect(r?.fraction).toBeCloseTo(1 / 144, 6)
    expect(r?.rect.w).toBe(1 / 16)
    expect(pickChange({ id: 'm', at: 1 }, [{ dt: 0.3, region: r }])).toBeNull()
  })

  it('is null when nothing moved past the delta, or the grids disagree', () => {
    const a = grid(8, 4, () => 50)
    expect(
      changedRegion(
        a,
        grid(8, 4, () => 60),
        24,
      ),
    ).toBeNull()
    expect(
      changedRegion(
        a,
        grid(4, 4, () => 200),
        24,
      ),
    ).toBeNull()
  })
})

describe('pickChange', () => {
  it('keeps the sample that changed most once it clears the floor', () => {
    const w = pickChange({ id: 'm03', at: 4 }, [
      {
        dt: 0.3,
        region: { fraction: 0.01, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } },
      },
      {
        dt: 0.8,
        region: { fraction: 0.2, rect: { x: 0.3, y: 0.2, w: 0.4, h: 0.4 } },
      },
      {
        dt: 1.5,
        region: { fraction: 0.12, rect: { x: 0.3, y: 0.2, w: 0.3, h: 0.3 } },
      },
      { dt: 2.5, region: null },
    ])
    expect(w).toEqual({
      seed: 'm03',
      at: 4,
      peakAt: 4.8,
      fraction: 0.2,
      rect: { x: 0.3, y: 0.2, w: 0.4, h: 0.4 },
    })
    expect(
      pickChange({ id: 'm03', at: 4 }, [
        {
          dt: 0.3,
          region: {
            fraction: CHANGE_FLOOR / 2,
            rect: { x: 0, y: 0, w: 1, h: 1 },
          },
        },
      ]),
    ).toBeNull()
  })
})

describe('momentsFromDoc with changes', () => {
  function doc(): ProjectDoc {
    const ev: CursorEvent[] = []
    const btn = { x: 600, y: 300, w: 120, h: 40 }
    for (let t = 1000; t <= 2800; t += 300)
      ev.push({ t, x: 400 + t / 10, y: 300, type: 'move' })
    ev.push({ t: 3000, x: 660, y: 320, type: 'down', button: 0, rect: btn })
    ev.push({ t: 3080, x: 660, y: 320, type: 'up', button: 0, rect: btn })
    for (let t = 3500; t <= 9000; t += 400)
      ev.push({ t, x: 660, y: 320, type: 'move' })
    const meta = {
      dpr: 1,
      zoom: 1,
      t0: 0,
      durationMs: 10_000,
      width: W,
      height: H,
      fps: 30,
      captureWidth: W,
      captureHeight: H,
    } as RecordingMeta
    return projectFromArtifact(
      { videoKey: 'recording.webm', cursor: ev, meta },
      'recording.webm',
    ).doc
  }

  it('adds a changed moment after the click it answers, framed at the peak', () => {
    const d = doc()
    const plan = planForDigest(d)
    const base = momentsFromDoc(d, plan, {})
    const click = base.find((m) => m.kind === 'click')!
    const moments = momentsFromDoc(d, plan, {
      changes: [
        {
          seed: click.id,
          at: click.at!,
          peakAt: click.at! + 0.8,
          fraction: 0.18,
          rect: { x: 0.25, y: 0.2, w: 0.5, h: 0.5 },
        },
      ],
    })
    const changed = moments.find((m) => m.kind === 'changed')!
    const seed = moments.find((m) => m.kind === 'click')!
    expect(changed.seed).toBe(seed.id)
    expect(changed.source).toEqual({ in: seed.at, out: seed.at! + 0.8 })
    expect(changed.at).toBeCloseTo(seed.at! + 0.8, 3)
    expect(changed.focus).toEqual({ cx: 0.5, cy: 0.45 })
    expect(changed.rect).toEqual({ x: 0.25, y: 0.2, w: 0.5, h: 0.5 })
    expect(changed.activity).toBe(0.18)
    // Ids stay positional and unique with the new moment in the order.
    expect(new Set(moments.map((m) => m.id)).size).toBe(moments.length)
    expect(moments.indexOf(changed)).toBeGreaterThan(moments.indexOf(seed))
  })
})
