import { describe, expect, it } from 'vitest'
import { planAutoZoom } from '../planner/autoZoom'
import { smoothCursor } from '../planner/smoothing'
import type { CursorTrack } from '../types'

const W = 1920
const H = 1080

describe('planAutoZoom', () => {
  it('returns no spans when there are no clicks', () => {
    const track: CursorTrack = [{ t: 0, x: 1, y: 1, type: 'move' }]
    expect(planAutoZoom(track, { width: W, height: H })).toEqual([])
  })

  it('emits one auto-tagged span per click cluster (lead before, hold after)', () => {
    const track: CursorTrack = [
      {
        t: 1000,
        x: 960,
        y: 540,
        type: 'down',
        rect: { x: 900, y: 500, w: 120, h: 80 },
      },
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'snappy' })
    expect(spans).toHaveLength(1)
    expect(spans[0].id).toBe('z0')
    expect(spans[0].level).toBeGreaterThan(1)
    expect(spans[0].in).toBeCloseTo(0.75, 3) // click 1.0s − lead 0.25
    expect(spans[0].out).toBeCloseTo(2.0, 3) // click 1.0s + hold 1.0
    expect(spans[0].source).toBe('auto')
  })

  it('focuses the clicked element (rect center → normalized cx/cy)', () => {
    const track: CursorTrack = [
      {
        t: 500,
        x: 0,
        y: 0,
        type: 'down',
        rect: { x: 0, y: 0, w: 200, h: 100 },
      },
    ]
    const [span] = planAutoZoom(track, { width: W, height: H, style: 'snappy' })
    expect(span.cx).toBeCloseTo(100 / W, 3) // rect center x = 100
    expect(span.cy).toBeCloseTo(50 / H, 3)
  })

  it('zooms more for a small element than a large one (element-aware level)', () => {
    const small = planAutoZoom(
      [
        {
          t: 500,
          x: 10,
          y: 10,
          type: 'down',
          rect: { x: 0, y: 0, w: 40, h: 20 },
        },
      ],
      { width: W, height: H, style: 'snappy' },
    )[0]
    const large = planAutoZoom(
      [
        {
          t: 500,
          x: 10,
          y: 10,
          type: 'down',
          rect: { x: 0, y: 0, w: 600, h: 350 },
        },
      ],
      { width: W, height: H, style: 'snappy' },
    )[0]
    expect(small.level).toBeGreaterThanOrEqual(large.level)
  })

  it('a cluster on a frame-sized element (a drag, a canvas) plans NO zoom', () => {
    // DRAG_FIT_LEVEL: the element fits the frame under 1.15×, so a zoom on
    // it says nothing — five real takes each carried a few of these.
    const canvas = { x: 40, y: 20, w: W - 80, h: H - 40 }
    const track: CursorTrack = []
    for (let t = 1000; t < 9000; t += 700) {
      track.push({ t, x: 300 + t / 10, y: 400, type: 'down', rect: canvas })
      // the cursor parks between drags — a pause, not a dwell to zoom on
      track.push({ t: t + 100, x: 300 + t / 10, y: 400, type: 'move' })
      track.push({ t: t + 650, x: 302 + t / 10, y: 400, type: 'move' })
    }
    track.push({ t: 9500, x: 1700, y: 900, type: 'move' })
    expect(
      planAutoZoom(track, { width: W, height: H, style: 'snappy' }),
    ).toEqual([])
    // A typing session on a wide field is still a target (the field is the
    // moment), never subject to the drag rule.
    const field = { x: 40, y: 300, w: W - 80, h: 40 }
    const typing: CursorTrack = [
      { t: 1000, x: 500, y: 320, type: 'down', rect: field },
      { t: 1400, x: 500, y: 320, type: 'key', rect: field },
      { t: 1900, x: 500, y: 320, type: 'key', rect: field },
      { t: 2500, x: 500, y: 320, type: 'key', rect: field },
    ]
    expect(planAutoZoom(typing, { width: W, height: H })).toHaveLength(1)
  })

  it('merges clustered clicks into a single sustained span', () => {
    const track: CursorTrack = [
      {
        t: 1000,
        x: 960,
        y: 540,
        type: 'down',
        rect: { x: 900, y: 500, w: 100, h: 80 },
      },
      {
        t: 1500,
        x: 970,
        y: 545,
        type: 'down',
        rect: { x: 900, y: 500, w: 100, h: 80 },
      },
      {
        t: 1900,
        x: 965,
        y: 542,
        type: 'down',
        rect: { x: 900, y: 500, w: 100, h: 80 },
      },
    ]
    const spans = planAutoZoom(track, {
      width: W,
      height: H,
      style: 'snappy',
      clusterGap: 1.2,
    })
    expect(spans).toHaveLength(1) // one cluster → one span, not 3 separate zooms
    expect(spans[0].out).toBeCloseTo(2.9, 3) // last click 1.9s + hold
  })

  it('is deterministic (same track → identical spans)', () => {
    const track: CursorTrack = [
      {
        t: 800,
        x: 100,
        y: 100,
        type: 'down',
        rect: { x: 50, y: 50, w: 100, h: 100 },
      },
    ]
    expect(
      planAutoZoom(track, { width: W, height: H, style: 'snappy' }),
    ).toEqual(planAutoZoom(track, { width: W, height: H, style: 'snappy' }))
  })

  it('suggests a point zoom for a click-less dwell (parked cursor = sample gap)', () => {
    // The recorder's distance gate means a parked cursor emits no samples: the
    // dwell is the 2s gap between the tiny drift at t=0..1s and the break at 2s.
    const track: CursorTrack = [
      { t: 0, x: 0.5 * W, y: 0.5 * H, type: 'move' },
      { t: 1000, x: 0.5 * W + 2, y: 0.5 * H, type: 'move' },
      { t: 2000, x: 0.9 * W, y: 0.9 * H, type: 'move' },
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'snappy' })
    expect(spans).toHaveLength(1)
    expect(spans[0].id).toBe('d0')
    expect(spans[0].source).toBe('auto')
    expect(spans[0].cx).toBeCloseTo(0.5, 2)
    expect(spans[0].level).toBeCloseTo(2.5, 2) // no rect → planner ceiling
  })

  it('drops dwells that would overlap a click span', () => {
    const track: CursorTrack = [
      { t: 0, x: 0.5 * W, y: 0.5 * H, type: 'move' },
      { t: 900, x: 0.5 * W + 2, y: 0.5 * H, type: 'move' },
      {
        t: 1000,
        x: 0.5 * W,
        y: 0.5 * H,
        type: 'down',
        rect: { x: 900, y: 500, w: 100, h: 80 },
      },
      { t: 2000, x: 0.9 * W, y: 0.9 * H, type: 'move' },
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'snappy' })
    expect(spans).toHaveLength(1) // the click span only — the dwell overlaps it
    expect(spans[0].id).toBe('z0')
  })

  it('glide: merges an activity session into ONE span and rides the cursor', () => {
    // Three clicks ~1.5s apart — separate clusters under snappy (gap 1.2) but
    // ONE session under glide (gap 3.0, the Cursorful window).
    const rect = { x: 900, y: 500, w: 120, h: 80 }
    const track: CursorTrack = [
      { t: 1000, x: 960, y: 540, type: 'down', rect },
      { t: 2500, x: 400, y: 300, type: 'down', rect },
      { t: 4000, x: 1500, y: 800, type: 'down', rect },
    ]
    const glide = planAutoZoom(track, { width: W, height: H, style: 'glide' })
    expect(glide).toHaveLength(1)
    expect(glide[0].in).toBeCloseTo(0.5, 3) // click 1.0s − lead 0.5
    expect(glide[0].out).toBeCloseTo(4.6, 3) // last click 4.0s + hold 0.6
    expect(glide[0].focusMode).toBe('auto') // camera follows the cursor
    expect(glide[0].level).toBeLessThanOrEqual(1.8) // modest ceiling
    const snappy = planAutoZoom(track, { width: W, height: H, style: 'snappy' })
    expect(snappy.length).toBeGreaterThan(1)
    expect(snappy[0].focusMode).toBeUndefined()
  })

  it('glide: a lone click earns no zoom (the ≥2-click rule)', () => {
    const track: CursorTrack = [
      {
        t: 1000,
        x: 960,
        y: 540,
        type: 'down',
        rect: { x: 900, y: 500, w: 120, h: 80 },
      },
      { t: 8000, x: 100, y: 100, type: 'move' },
    ]
    expect(
      planAutoZoom(track, { width: W, height: H, style: 'glide' }),
    ).toEqual([])
  })

  it('none: the planner emits nothing (manual zooms only)', () => {
    const rect = { x: 900, y: 500, w: 120, h: 80 }
    const track: CursorTrack = [
      { t: 1000, x: 960, y: 540, type: 'down', rect },
      { t: 1500, x: 970, y: 545, type: 'down', rect },
    ]
    expect(planAutoZoom(track, { width: W, height: H, style: 'none' })).toEqual(
      [],
    )
  })

  it('params overrides win over the named style (the Custom seam)', () => {
    const track: CursorTrack = [
      {
        t: 1000,
        x: 960,
        y: 540,
        type: 'down',
        rect: { x: 900, y: 500, w: 120, h: 80 },
      },
      { t: 8000, x: 100, y: 100, type: 'move' },
    ]
    // glide's ≥2-click rule drops the lone click…
    expect(
      planAutoZoom(track, { width: W, height: H, style: 'glide' }),
    ).toEqual([])
    // …unless a doc.zoomParams override relaxes it
    const spans = planAutoZoom(track, {
      width: W,
      height: H,
      style: 'glide',
      params: { minClusterClicks: 1 },
    })
    expect(spans).toHaveLength(1)
    expect(spans[0].focusMode).toBe('auto') // rest of glide still applies
  })

  it('emits nothing for continuous motion (no clicks, no rests)', () => {
    const track: CursorTrack = Array.from({ length: 20 }, (_, i) => ({
      t: i * 200,
      x: (i / 20) * W,
      y: (i / 20) * H,
      type: 'move' as const,
    }))
    expect(planAutoZoom(track, { width: W, height: H })).toEqual([])
  })
})

describe('planAutoZoom — typing sessions (TZ)', () => {
  // A text field and its center, the shape the extension's `key` pings carry.
  const FIELD = { x: 800, y: 500, w: 320, h: 40 }
  const FX = 960
  const FY = 520
  const ping = (t: number, rect = FIELD): CursorTrack[number] => ({
    t,
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    type: 'key',
    rect,
  })

  it('click into a field then type = ONE span entering at the click (glide)', () => {
    // glide's ≥2-click rule would drop this lone click, and the keystrokes
    // emit no cursor motion — the exact moment that used to get no camera.
    const track: CursorTrack = [
      { t: 1000, x: FX, y: FY, type: 'down', rect: FIELD },
      ping(1300),
      ping(1700),
      ping(2100),
      ping(2600),
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'glide' })
    expect(spans).toHaveLength(1)
    expect(spans[0].id).toBe('k0')
    expect(spans[0].in).toBeCloseTo(0.5, 3) // absorbed click 1.0s − lead 0.5
    expect(spans[0].out).toBeCloseTo(3.7, 3) // last ping 2.6s + typingHold 1.1
    expect(spans[0].cx).toBeCloseTo(FX / W, 3) // frames the FIELD
    expect(spans[0].cy).toBeCloseTo(FY / H, 3)
    expect(spans[0].focusMode).toBeUndefined() // never follows a parked cursor
    expect(spans[0].source).toBe('auto')
  })

  it('holds through a thinking pause shorter than typingGap', () => {
    const track: CursorTrack = [
      ping(1000),
      ping(1400),
      ping(3800), // 2.4s of silence — under glide's 2.5s gap
      ping(4300),
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'glide' })
    expect(spans).toHaveLength(1)
    expect(spans[0].out).toBeCloseTo(5.4, 3)
  })

  it('splits on a pause longer than typingGap — two chained beats', () => {
    const track: CursorTrack = [
      ping(1000),
      ping(1600),
      ping(5000), // 3.4s of silence — past glide's 2.5s gap
      ping(5700),
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'glide' })
    expect(spans.map((s) => s.id)).toEqual(['k0', 'k1'])
  })

  it('a lone Enter or a sub-half-second burst earns nothing', () => {
    const track: CursorTrack = [ping(1000), ping(5000), ping(5300)]
    expect(
      planAutoZoom(track, { width: W, height: H, style: 'glide' }),
    ).toEqual([])
    // …and 'none' still silences everything.
    const typed: CursorTrack = [ping(1000), ping(1600), ping(2400)]
    expect(planAutoZoom(typed, { width: W, height: H, style: 'none' })).toEqual(
      [],
    )
  })

  it('frames the field element-aware: wide bar → gentle, small box → tight', () => {
    const wide = { x: 160, y: 40, w: 1600, h: 60 }
    const small = { x: 860, y: 40, w: 200, h: 40 }
    const wideSpan = planAutoZoom([ping(1000, wide), ping(1700, wide)], {
      width: W,
      height: H,
      style: 'glide',
    })[0]
    const smallSpan = planAutoZoom([ping(1000, small), ping(1700, small)], {
      width: W,
      height: H,
      style: 'glide',
    })[0]
    // Wide fields clamp to the TYPING floor (1.4), above glide's click
    // minLevel (1.3) — the field being typed into reads a notch punchier.
    expect(wideSpan.level).toBeCloseTo(1.4, 2)
    expect(smallSpan.level).toBeCloseTo(1.8, 2) // capped at glide's maxLevel
  })

  it('typingMinLevel is a zoomParams knob like the rest (the Custom seam)', () => {
    const wide = { x: 160, y: 40, w: 1600, h: 60 }
    const span = planAutoZoom([ping(1000, wide), ping(1700, wide)], {
      width: W,
      height: H,
      style: 'glide',
      params: { typingMinLevel: 1.6 },
    })[0]
    expect(span.level).toBeCloseTo(1.6, 2)
  })

  it('switching fields splits the session and the spans chain edge-to-edge', () => {
    const fieldA = { x: 100, y: 280, w: 200, h: 40 }
    const fieldB = { x: 100, y: 680, w: 200, h: 40 }
    const track: CursorTrack = [
      ping(1000, fieldA),
      ping(1600, fieldA),
      ping(1900, fieldB), // tab to the next form field
      ping(2600, fieldB),
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'glide' })
    expect(spans.map((s) => s.id)).toEqual(['k0', 'k1'])
    // The earlier span cedes its hold to the next field's entry — adjacency,
    // which the lowering's chainGap turns into a field-to-field pan.
    expect(spans[0].out).toBeCloseTo(spans[1].in, 3)
    expect(spans[0].cy).toBeLessThan(spans[1].cy)
  })

  it('reserves its window against the parked-cursor dwell (wrong-target fix)', () => {
    // The mouse parks at (300,300) while typing happens in the field — the
    // dwell detector would zoom the parked DOT, not the field.
    const parked: CursorTrack = [
      { t: 0, x: 300, y: 300, type: 'move' },
      { t: 500, x: 302, y: 300, type: 'move' },
      { t: 2500, x: 1700, y: 900, type: 'move' },
    ]
    const typed: CursorTrack = [
      ...parked.slice(0, 2),
      ping(800),
      ping(1300),
      ping(1900),
      parked[2],
    ]
    const without = planAutoZoom(typed, {
      width: W,
      height: H,
      style: 'glide',
      params: { typingZoom: false },
    })
    expect(without.map((s) => s.id)).toEqual(['d0']) // the wrong-target dwell
    const spans = planAutoZoom(typed, { width: W, height: H, style: 'glide' })
    expect(spans.map((s) => s.id)).toEqual(['k0']) // the field wins
    expect(spans[0].cx).toBeCloseTo(FX / W, 3)
  })

  it('merges with a same-field click span (union extents, typing focus)', () => {
    const track: CursorTrack = [
      { t: 800, x: FX, y: FY, type: 'down', rect: FIELD },
      { t: 1200, x: FX, y: FY, type: 'down', rect: FIELD },
      ping(1500),
      ping(2200),
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'snappy' })
    expect(spans).toHaveLength(1)
    expect(spans[0].id).toBe('k0')
    expect(spans[0].in).toBeCloseTo(0.55, 3) // first click 0.8s − lead 0.25
    expect(spans[0].out).toBeCloseTo(3.0, 3) // last ping 2.2s + typingHold 0.8
  })

  it('cedes the overlap to a different-field click beat (travel by pan)', () => {
    const button = { x: 1500, y: 900, w: 120, h: 40 }
    const track: CursorTrack = [
      ping(1000),
      ping(1600),
      { t: 2000, x: 1560, y: 920, type: 'down', rect: button },
      ping(2400),
      ping(3200),
    ]
    const spans = planAutoZoom(track, { width: W, height: H, style: 'snappy' })
    expect(spans.map((s) => s.id)).toEqual(['k0', 'z0'])
    expect(spans[0].out).toBeCloseTo(spans[1].in, 3) // typing cedes at the click span
  })

  it('is deterministic with typing in the track', () => {
    const track: CursorTrack = [
      { t: 1000, x: FX, y: FY, type: 'down', rect: FIELD },
      ping(1300),
      ping(1900),
      { t: 4000, x: 100, y: 100, type: 'move' },
    ]
    expect(
      planAutoZoom(track, { width: W, height: H, style: 'glide' }),
    ).toEqual(planAutoZoom(track, { width: W, height: H, style: 'glide' }))
  })
})

describe('smoothCursor', () => {
  it('produces a fixed-cadence path bounded by the input range', () => {
    const track: CursorTrack = [
      { t: 0, x: 0, y: 0, type: 'move' },
      { t: 1000, x: 100, y: 0, type: 'move' },
    ]
    const pts = smoothCursor(track, { factor: 0.2, fps: 30 })
    expect(pts.length).toBeGreaterThan(20)
    expect(pts[0].t).toBeCloseTo(0, 3)
    // smoothing lags the target — never overshoots the endpoint
    expect(Math.max(...pts.map((p) => p.x))).toBeLessThanOrEqual(100)
    expect(pts[pts.length - 1].x).toBeGreaterThan(50)
  })

  it('is deterministic', () => {
    const track: CursorTrack = [
      { t: 0, x: 0, y: 0, type: 'move' },
      { t: 500, x: 50, y: 50, type: 'move' },
    ]
    expect(smoothCursor(track)).toEqual(smoothCursor(track))
  })

  it('returns [] for an empty/position-less track', () => {
    expect(smoothCursor([{ t: 0, x: 0, y: 0, type: 'scroll' }])).toEqual([])
  })

  it('ignores typing pings — synthesized element centers never enter the path', () => {
    const withKeys: CursorTrack = [
      { t: 0, x: 0, y: 0, type: 'move' },
      { t: 500, x: 50, y: 50, type: 'move' },
      {
        t: 700,
        x: 900,
        y: 20,
        type: 'key',
        rect: { x: 800, y: 4, w: 200, h: 32 },
      },
    ]
    expect(smoothCursor(withKeys)).toEqual(smoothCursor(withKeys.slice(0, 2)))
  })
})
