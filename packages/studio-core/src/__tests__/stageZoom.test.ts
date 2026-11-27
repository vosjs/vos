import { describe, expect, it } from 'vitest'
import { projectFromArtifact } from '../ingest'
import { groupTrack, planAutoZoom } from '../planner/autoZoom'
import {
  STAGE_REST_MIN_LEVEL,
  STAGE_SMALL_WINDOW_FILL,
  STAGE_VIEW_REF,
  STAGE_WINDOW_FILL,
  stageVisits,
  windowAtPoint,
} from '../planner/stage'
import { resolveZoomStyle } from '../zoomStyle'
import type {
  CursorTrack,
  RecordingArtifact,
  RecordingMeta,
  StageWindow,
  WindowSample,
  ZoomSpan,
} from '../types'

// A stage is a display with only the windows of the apps a take named on it:
// several windows, one frame. A press there belongs to a window, and inside a
// window the camera is the camera a take of that window alone would have.

// The stage of a 1728-point display under its menu bar, as a desktop producer
// writes it: a document on the left, a small calculator, a clock over its foot.
const W = 1728
const H = 1084
const editor: StageWindow = {
  id: 11,
  app: 'TextEdit',
  x: 90,
  y: 97,
  w: 740,
  h: 640,
}
const calc: StageWindow = {
  id: 12,
  app: 'Calculator',
  x: 890,
  y: 63,
  w: 230,
  h: 408,
}
const clock: StageWindow = {
  id: 13,
  app: 'Clock',
  x: 960,
  y: 500,
  w: 690,
  h: 560,
}
// Front to back: the clock stands over the calculator's foot.
const windows: WindowSample[] = [{ t: 0, windows: [clock, calc, editor] }]

const meta: RecordingMeta = {
  dpr: 2,
  zoom: 1,
  t0: 1795761738282,
  durationMs: 16000,
  width: W,
  height: H,
  fps: 60,
  captureWidth: 3456,
  captureHeight: 2168,
  captureSurface: 'desktop',
  platform: 'mac',
  producer: 'desktop',
  apps: [
    { name: 'TextEdit', id: 'com.apple.TextEdit' },
    { name: 'Calculator', id: 'com.apple.calculator' },
    { name: 'Clock', id: 'com.apple.clock' },
  ],
  desk: [],
  windows,
}

const key = (x: number, y: number) => ({ x, y, w: 48, h: 48 })
const four = key(900, 304)
const two = key(954, 358)
const times = key(1062, 250)
const equals = key(1062, 412)
const tab = { x: 1308, y: 509, w: 96, h: 36 }
const start = { x: 1315, y: 1010, w: 150, h: 28 }

const press = (
  t: number,
  rect: { x: number; y: number; w: number; h: number },
) => {
  const x = rect.x + rect.w / 2
  const y = rect.y + rect.h / 2
  return [
    { t: t - 300, x: x - 60, y: y - 40, type: 'move' as const },
    { t, x, y, type: 'down' as const, button: 0 as const, rect },
    { t: t + 90, x, y, type: 'up' as const, button: 0 as const },
  ]
}

// A field in the document, typed into; a sum on the calculator; then a tab
// and a button in the clock.
const title = { x: 130, y: 150, w: 420, h: 32 }
const cursor: CursorTrack = [
  { t: 0, x: 860, y: 600, type: 'move' },
  { t: 700, x: 340, y: 166, type: 'down', button: 0, rect: title },
  { t: 790, x: 340, y: 166, type: 'up', button: 0 },
  ...Array.from({ length: 8 }, (_, i) => ({
    t: 950 + i * 350,
    x: 340,
    y: 166,
    type: 'key' as const,
    rect: title,
  })),
  ...press(4700, four),
  ...press(5200, two),
  ...press(5750, times),
  ...press(6950, equals),
  ...press(9100, tab),
  ...press(10100, start),
  ...press(13300, start),
]

const plan = (
  over: Partial<Parameters<typeof planAutoZoom>[1]> = {},
): ZoomSpan[] =>
  planAutoZoom(cursor, {
    width: W,
    height: H,
    duration: meta.durationMs / 1000,
    windows,
    ...over,
  })

const inside = (z: ZoomSpan, w: StageWindow): boolean =>
  z.cx * W >= w.x &&
  z.cx * W <= w.x + w.w &&
  z.cy * H >= w.y &&
  z.cy * H <= w.y + w.h

describe('a stage take is a take', () => {
  const artifact: RecordingArtifact = {
    videoKey: 'recording.mp4',
    cursor,
    meta,
  }
  const { doc } = projectFromArtifact(artifact, 'recording.mp4')

  it('keeps its cursor: the producer knows where the pointer is in the frame', () => {
    expect(doc.source.cursor).toHaveLength(cursor.length)
    expect(doc.source.cursor[1]).toEqual(cursor[1])
  })

  it('draws no browser bar and no crop over it', () => {
    expect(doc.frame.browserBar.kind).toBe('none')
    expect(doc.source.crop).toBeUndefined()
  })

  it('carries what the take named, and where its windows were', () => {
    expect(doc.source.meta.captureSurface).toBe('desktop')
    expect(doc.source.meta.apps?.map((a) => a.name)).toEqual([
      'TextEdit',
      'Calculator',
      'Clock',
    ])
    expect(doc.source.meta.windows).toEqual(windows)
  })
})

describe('a press belongs to a window', () => {
  it('finds the frontmost window under a point, and none on the ground', () => {
    // The clock stands over the calculator's foot: a point in both is the clock's.
    expect(windowAtPoint(windows, 1, 1000, 520)?.app).toBe('Clock')
    expect(windowAtPoint(windows, 1, 1000, 300)?.app).toBe('Calculator')
    expect(windowAtPoint(windows, 1, 860, 900)).toBeNull()
  })

  it('a press in an app’s panel belongs to that app’s window, not to the panel', () => {
    // A tip the calculator shows: a window of its own with no title, in front
    // of the calculator and reaching past its right edge.
    const tip: StageWindow = {
      id: 14,
      app: 'Calculator',
      x: 860,
      y: 107,
      w: 468,
      h: 101,
      panel: true,
    }
    const withTip: WindowSample[] = [
      { t: 0, windows: [clock, tip, calc, editor] },
    ]
    expect(windowAtPoint(withTip, 1, 900, 150)?.id).toBe(calc.id)
    // …even where the panel hangs past the window.
    expect(windowAtPoint(withTip, 1, 1300, 150)?.id).toBe(calc.id)
    // An app that has only a panel has the panel.
    expect(windowAtPoint([{ t: 0, windows: [tip] }], 1, 900, 150)?.id).toBe(
      tip.id,
    )
  })

  it('without the windows, presses in two apps make one beat aimed between them', () => {
    const blind = plan({ windows: null })
    const sum = blind.find((z) => z.in <= 4.7 && z.out >= 6.95)
    expect(sum).toBeDefined()
    // The same span is still open when the clock's tab is pressed.
    expect(sum!.out).toBeGreaterThan(9.1)
  })

  it('with them, no beat spans two windows', () => {
    const { clusters } = groupTrack(cursor, {
      width: W,
      height: H,
      clusterGap: resolveZoomStyle().clusterGap,
      typingGap: resolveZoomStyle().typingGap,
      typingZoom: true,
      targetFill: resolveZoomStyle().targetFill,
      windows,
    })
    for (const cluster of clusters) {
      const owners = new Set(
        cluster.map((c) => windowAtPoint(windows, c.t, c.x, c.y)?.app ?? null),
      )
      expect(owners.size).toBe(1)
    }
  })

  it('cuts the take into visits: the document, the calculator, the clock', () => {
    const visits = stageVisits(cursor, windows, { lead: 0.5, duration: 16 })
    expect(visits.map((v) => v.win?.app)).toEqual([
      'TextEdit',
      'Calculator',
      'Clock',
    ])
    // Each lasts until the next opens; the last to the end of the take.
    expect(visits[0].out).toBe(visits[1].in)
    expect(visits[1].out).toBe(visits[2].in)
    expect(visits[2].out).toBe(16)
  })
})

describe('the camera on a stage', () => {
  const spans = plan()
  const rests = spans.filter((z) => z.id.startsWith('w'))
  const beats = spans.filter((z) => !z.id.startsWith('w'))

  it('proposes nothing before the first visit: the take opens on the whole stage', () => {
    expect(spans[0].in).toBeGreaterThan(0)
    expect(spans[0].in).toBeLessThanOrEqual(0.7)
  })

  it('never overlaps itself, and every span is the planner’s own', () => {
    for (let i = 0; i + 1 < spans.length; i++) {
      expect(spans[i].out).toBeLessThanOrEqual(spans[i + 1].in)
    }
    expect(spans.every((z) => z.source === 'auto')).toBe(true)
    expect(new Set(spans.map((z) => z.id)).size).toBe(spans.length)
  })

  it('aims every beat inside the window it happened in', () => {
    const windowOf = (z: ZoomSpan) =>
      [editor, calc, clock].filter((w) => inside(z, w))
    for (const z of beats) expect(windowOf(z).length).toBeGreaterThan(0)
    const typing = beats.find((z) => z.id.startsWith('k'))!
    expect(inside(typing, editor)).toBe(true)
    // The sum is the calculator's, every beat of it, and it is over before the
    // clock is touched.
    const sum = beats.filter((z) => z.in >= 4.3 && z.in < 8.6)
    expect(sum.length).toBeGreaterThan(0)
    for (const z of sum) {
      expect(inside(z, calc)).toBe(true)
      expect(z.out).toBeLessThanOrEqual(9.1)
    }
    for (const z of beats.filter((b) => b.in >= 8.6))
      expect(inside(z, clock)).toBe(true)
  })

  it('keeps a beat’s view inside its window, and centres a window smaller than the view', () => {
    for (const z of beats) {
      const w = [editor, calc, clock].find((x) => inside(z, x))!
      for (const [focus, start, length, frame] of [
        [z.cx, w.x, w.w, W],
        [z.cy, w.y, w.h, H],
      ] as const) {
        const view = 1 / z.level
        if (length / frame <= view) {
          expect(focus).toBeCloseTo((start + length / 2) / frame, 2)
        } else {
          expect(focus - view / 2).toBeGreaterThanOrEqual(start / frame - 1e-3)
          expect(focus + view / 2).toBeLessThanOrEqual(
            (start + length) / frame + 1e-3,
          )
        }
      }
    }
  })

  it('never shows less of the stage than a reader needs', () => {
    // 600 units across at the default ceiling: the calculator's keys are not
    // entered until one fills the picture.
    const least = STAGE_VIEW_REF / resolveZoomStyle().maxLevel
    for (const z of beats) expect(W / z.level).toBeGreaterThanOrEqual(least - 1)
  })

  it('stands as close as a take of that window alone would, up to that', () => {
    // A take of the calculator alone, planned by the same planner.
    const alone = planAutoZoom(
      cursor
        .filter((e) => e.t >= 4200 && e.t < 8600)
        .map((e) => ({
          ...e,
          x: e.x - calc.x,
          y: e.y - calc.y,
          ...(e.rect
            ? {
                rect: { ...e.rect, x: e.rect.x - calc.x, y: e.rect.y - calc.y },
              }
            : {}),
        })),
      { width: calc.w, height: calc.h, duration: 8.6 },
    ).find((z) => z.id.startsWith('z'))!
    const onStage = beats.find((z) => z.in >= 4.3 && z.in < 8.6)!
    const fit = Math.min(W / calc.w, H / calc.h)
    // The calculator is small: the least of the stage a beat may show would
    // hold nearly all of it, so it is shown whole, closer than its rest.
    const least = (W * resolveZoomStyle().maxLevel) / STAGE_VIEW_REF
    const closest = fit * STAGE_SMALL_WINDOW_FILL
    expect(closest).toBeLessThan(least)
    expect(closest).toBeGreaterThan(fit * STAGE_WINDOW_FILL)
    expect(alone.level * fit).toBeGreaterThan(closest)
    expect(onStage.level).toBeCloseTo(closest, 2)
    expect(calc.w / W).toBeLessThanOrEqual(1 / onStage.level)
    expect(calc.h / H).toBeLessThanOrEqual(1 / onStage.level)
    // The clock is not: its beats stop at the least of the stage.
    const onClock = beats.find((z) => z.in >= 8.6 && !z.id.startsWith('w'))!
    expect(onClock.level).toBeCloseTo(least, 2)
    // A window wide enough that the limit is far away: the two agree.
    const wide: StageWindow = {
      id: 31,
      app: 'Code',
      x: 100,
      y: 60,
      w: 1300,
      h: 900,
    }
    const here = planAutoZoom(
      [
        { t: 0, x: 500, y: 500, type: 'move' },
        ...press(2000, { x: 400, y: 300, w: 120, h: 40 }),
        ...press(2500, { x: 560, y: 300, w: 120, h: 40 }),
      ],
      {
        width: W,
        height: H,
        duration: 8,
        windows: [{ t: 0, windows: [wide] }],
      },
    ).find((z) => z.id.startsWith('z'))!
    const there = planAutoZoom(
      [
        { t: 0, x: 400, y: 440, type: 'move' },
        ...press(2000, { x: 300, y: 240, w: 120, h: 40 }),
        ...press(2500, { x: 460, y: 240, w: 120, h: 40 }),
      ],
      { width: wide.w, height: wide.h, duration: 8 },
    ).find((z) => z.id.startsWith('z'))!
    expect(here.level).toBeCloseTo(
      there.level * Math.min(W / wide.w, H / wide.h),
      2,
    )
  })

  it('rests on the window between beats, the whole window in the frame', () => {
    const restOn = (w: StageWindow) => rests.filter((z) => inside(z, w))
    // The clock, between its presses and after the last. The sum was all
    // beats: the calculator has no gap long enough to rest in.
    expect(restOn(calc)).toHaveLength(0)
    for (const w of [clock]) {
      const mine = restOn(w)
      expect(mine.length).toBe(2)
      const fit = Math.min(W / w.w, H / w.h) * STAGE_WINDOW_FILL
      for (const z of mine) {
        expect(z.level).toBeCloseTo(fit, 2)
        // The view (1/level of the frame) holds the window on both axes.
        expect(w.w / W).toBeLessThanOrEqual(1 / z.level + 1e-6)
        expect(w.h / H).toBeLessThanOrEqual(1 / z.level + 1e-6)
        // …and never shows what is past the stage (a focus is kept to 3 places).
        expect(z.cx).toBeGreaterThanOrEqual(0.5 / z.level - 1e-3)
        expect(z.cx).toBeLessThanOrEqual(1 - 0.5 / z.level + 1e-3)
        expect(z.cy).toBeGreaterThanOrEqual(0.5 / z.level - 1e-3)
        expect(z.cy).toBeLessThanOrEqual(1 - 0.5 / z.level + 1e-3)
      }
    }
    // The clock holds the camera to the end of the take.
    expect(spans.at(-1)!.out).toBe(16)
    expect(inside(spans.at(-1)!, clock)).toBe(true)
  })

  it('is the same plan for the same track', () => {
    expect(plan()).toEqual(spans)
  })
})

describe('what a stage does not chase', () => {
  it('a window that fills the stage earns no rest: the stage is its framing', () => {
    const big: StageWindow = {
      id: 21,
      app: 'Code',
      x: 60,
      y: 20,
      w: 1620,
      h: 1040,
    }
    const fit = Math.min(W / big.w, H / big.h) * STAGE_WINDOW_FILL
    expect(fit).toBeLessThan(STAGE_REST_MIN_LEVEL)
    const spans = planAutoZoom(
      [
        { t: 0, x: 400, y: 400, type: 'move' },
        ...press(2000, { x: 300, y: 200, w: 90, h: 30 }),
        ...press(2600, { x: 420, y: 200, w: 90, h: 30 }),
      ],
      { width: W, height: H, duration: 8, windows: [{ t: 0, windows: [big] }] },
    )
    expect(spans.some((z) => z.id.startsWith('w'))).toBe(false)
    expect(spans.some((z) => z.id.startsWith('z'))).toBe(true)
  })

  it('a window being moved: the camera waits for it to settle, then rests where it is', () => {
    const moved: StageWindow = { ...calc, x: 1300, y: 300 }
    const track: WindowSample[] = [
      { t: 0, windows: [calc] },
      // dragged for half a second, a sample every 33 ms
      ...Array.from({ length: 15 }, (_, i) => ({
        t: 7000 + i * 33,
        windows: [
          { ...calc, x: calc.x + (i + 1) * 27, y: calc.y + (i + 1) * 16 },
        ],
      })),
      { t: 7500, windows: [moved] },
    ]
    const spans = planAutoZoom(
      [
        { t: 0, x: 860, y: 600, type: 'move' },
        ...press(4700, four),
        ...press(5200, two),
        ...press(11000, key(moved.x + 10, moved.y + 240)),
        ...press(11500, key(moved.x + 64, moved.y + 240)),
      ],
      { width: W, height: H, duration: 14, windows: track },
    )
    // No span is open while the window travels.
    expect(spans.some((z) => z.in < 7.45 && z.out > 7.05)).toBe(false)
    // Before the move the camera is on where the window was; after it, on where it is.
    const before = spans.filter((z) => z.out <= 7.05)
    const after = spans.filter((z) => z.in >= 7.45)
    expect(before.length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)
    for (const z of before) expect(inside(z, calc)).toBe(true)
    for (const z of after) expect(inside(z, moved)).toBe(true)
  })

  it('a press on the ground is planned against the stage, as on any take', () => {
    const spans = planAutoZoom(
      [
        { t: 0, x: 860, y: 600, type: 'move' },
        ...press(2000, { x: 840, y: 880, w: 60, h: 24 }),
        ...press(2500, { x: 840, y: 920, w: 60, h: 24 }),
      ],
      { width: W, height: H, duration: 8, windows },
    )
    expect(spans.some((z) => z.id.startsWith('w'))).toBe(false)
    const z = spans.find((s) => s.id.startsWith('z'))!
    expect(z.cx * W).toBeCloseTo(870, -1)
    expect(z.level).toBeLessThanOrEqual(resolveZoomStyle().maxLevel)
  })
})
