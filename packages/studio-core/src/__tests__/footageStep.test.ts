import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  lerpArray,
  mapTime,
  rateAt,
  sample,
  totalDuration,
} from '@vosjs/timeline'
import { MEDIA_FOLLOWER_SRC } from '@vosjs/core/runtime'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { ProjectDoc, Segment, SpeedSpan } from '../types'

/**
 * The footage WHILE IT PLAYS. ON_FRAME lets the element run and steps it
 * when it drifts; these tests play the lowered program against a MODEL
 * element that behaves the way a real one does where the rules bite:
 *
 *   - a seek takes time (`cost`), and `currentTime` reads the TARGET while
 *     it is in flight;
 *   - assigning `currentTime` during a seek starts the seek over;
 *   - the decoder has a ceiling: asked for 16×, it plays what it can.
 *
 * A stub that lands every seek at once (the rest of the suite's) cannot
 * see any of this, which is how a step on every frame went unnoticed.
 *
 * Every case runs TWICE: against the program's own copy of the rule (a
 * player with no follower: an older CLI, a standalone page), and against
 * the player document's follower (`window.__vos__.media`, @vosjs/core),
 * which the program calls when it finds one. The two are the same rule and
 * are held to the same numbers.
 */
const FPS = 60

interface Step {
  /** Output seconds when the program assigned `currentTime`. */
  at: number
  to: number
  /** The source moment the playhead wanted on that frame. */
  want: number
  whileSeeking: boolean
}

function makeModel(o: { cost: number; ceiling?: number; duration?: number }) {
  let pos = 0
  let target = 0
  let landAt = 0
  let wall = 0
  const listeners: Record<string, Array<() => void>> = {}
  const m = {
    videoWidth: 1600,
    videoHeight: 900,
    readyState: 2,
    paused: true,
    muted: true,
    volume: 1,
    duration: o.duration ?? 600,
    playbackRate: 1,
    preservesPitch: false,
    seeking: false,
    cost: o.cost,
    steps: [] as Array<Step>,
    landed: 0,
    placed: false,
    /** Filled by the loop before each frame so a step can record it. */
    want: 0,
    out: 0,
    get currentTime() {
      return m.seeking ? target : pos
    },
    set currentTime(x: number) {
      m.steps.push({ at: m.out, to: x, want: m.want, whileSeeking: m.seeking })
      m.seeking = true
      target = x
      landAt = wall + m.cost
    },
    /** The element's real position, which `currentTime` hides mid-seek. */
    get position() {
      return pos
    },
    place(x: number) {
      pos = x
    },
    tick(dt: number) {
      wall += dt
      if (m.seeking) {
        if (wall >= landAt - 1e-9) {
          m.seeking = false
          pos = target
          m.landed++
          for (const fn of listeners.seeked ?? []) fn()
        }
      } else if (!m.paused) {
        pos += Math.min(m.playbackRate, o.ceiling ?? 16) * dt
      }
      return wall
    },
    play() {
      m.paused = false
      return Promise.resolve()
    },
    pause() {
      m.paused = true
    },
    addEventListener(type: string, fn: () => void) {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener: () => undefined,
  }
  return m
}
type Model = ReturnType<typeof makeModel>

function doc(
  segments: Array<Segment>,
  speed: Array<SpeedSpan> = [],
): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:a',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 600000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments,
    speed,
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe.each([
  ['by its own copy of the rule', false],
  ["by the player's follower", true],
])('the footage follows the clock while it plays, %s', (_name, follower) => {
  const g = globalThis as Record<string, unknown>
  let wall = 0
  beforeEach(() => {
    wall = 0
    vi.spyOn(performance, 'now').mockImplementation(() => wall * 1000)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete g.window
    delete g.__vosTimeline
  })

  /**
   * Play `d` from output second `from` to `to` at 60 frames a second, the
   * model advanced one frame of wall time before each. A model starts where
   * the playhead is, less `behind` seconds, and keeps its place across
   * calls. Returns how far the element really was from the playhead on
   * every frame, in output seconds.
   */
  function play(d: ProjectDoc, m: Model, from: number, to: number, behind = 0) {
    const { config, data } = lowerToComposition(d)
    const onFrame = new Function(
      `"use strict"; return (${config.onFrame as string})`,
    )() as (ctx: unknown, content: unknown, dt: number) => void
    g.window = { __vos__: { isPaused: false } }
    if (follower) {
      expect(MEDIA_FOLLOWER_SRC).toContain('ns.media =')
      new Function(MEDIA_FOLLOWER_SRC)()
    }
    g.__vosTimeline = { mapTime, sample, lerpArray, rateAt, totalDuration }
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return () => {}
        },
        set: () => true,
      },
    )
    const refs = {
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      video: m,
      cam: null,
    }
    const segments = (data as { segments: Array<Segment> }).segments
    if (!m.placed) {
      m.place(mapTime(segments, from) - behind)
      m.placed = true
    }
    const off: Array<number> = []
    for (let t = from; t < to - 1e-9; t += 1 / FPS) {
      wall = m.tick(1 / FPS)
      m.out = t
      m.want = mapTime(segments, t)
      onFrame(
        {
          time: t,
          data,
          renderer: undefined,
          resolution: {
            width: 1920,
            height: 1080,
            drawingBufferWidth: 1920,
            drawingBufferHeight: 1080,
          },
        },
        { refs },
        1 / FPS,
      )
      off.push(Math.abs(m.position - m.want) / rateAt(segments, t))
    }
    // Which rule drove the element: each keeps its state under its own name.
    expect('__vosFollow' in m).toBe(follower)
    expect('__vosSv' in m).toBe(!follower)
    return off
  }

  it('a 16× piece on a decoder that cannot hold it: every step lands, and steps are few', () => {
    // Two output seconds at 16×, a 60ms seek, a decoder that manages 13×.
    const m = makeModel({ cost: 0.06, ceiling: 13 })
    const off = play(
      doc([{ in: 0, out: 100 }], [{ id: 's', in: 4, out: 36, rate: 16 }]),
      m,
      3,
      6,
    )
    // One seek in flight: an assignment during a seek aborts it, and a step
    // on every frame was a seek that never landed.
    expect(m.steps.filter((s) => s.whileSeeking)).toHaveLength(0)
    expect(m.landed).toBe(m.steps.length)
    // The allowance is 0.3 OUTPUT seconds, so a decoder 3 source seconds a
    // second short is stepped about once every 1.6s, not 60 times a second.
    expect(m.steps.length).toBeGreaterThan(0)
    expect(m.steps.length).toBeLessThanOrEqual(4)
    // And the picture is never further behind than the allowance, plus the
    // seek that answers it, plus a frame.
    expect(Math.max(...off)).toBeLessThan(0.3 + 0.06 + 2 / FPS)
  })

  it('an element that holds the rate is never stepped inside a piece', () => {
    const m = makeModel({ cost: 0.06 })
    play(
      doc([{ in: 0, out: 100 }], [{ id: 's', in: 4, out: 12, rate: 4 }]),
      m,
      3,
      6.5,
    )
    expect(m.steps).toHaveLength(0)
  })

  it('a cheap seek: a cut is one step, aimed at now until a seek has been measured, then at where the playhead will be', () => {
    // Three clips, two cuts, a 50ms seek, all at 1×.
    const m = makeModel({ cost: 0.05 })
    play(
      doc([
        { in: 0, out: 2 },
        { in: 10, out: 12 },
        { in: 30, out: 32 },
      ]),
      m,
      1,
      5.5,
    )
    expect(m.steps).toHaveLength(2)
    const [first, second] = m.steps
    // Nothing is guessed: the first step asks for the moment on screen.
    expect(first.to).toBeCloseTo(first.want, 6)
    // The second leads by what the first one cost, so it lands on time.
    expect(second.to - second.want).toBeCloseTo(0.05, 1)
    expect(m.steps.filter((s) => s.whileSeeking)).toHaveLength(0)
  })

  it('a dear seek: the first cut lands a whole seek late and is re-aimed once; the next lands on time', () => {
    // The same three clips with a 200ms seek. The first step is aimed at now
    // and lands 0.2s behind, more than half the 0.3s allowed.
    const m = makeModel({ cost: 0.2 })
    const off = play(
      doc([
        { in: 0, out: 2 },
        { in: 10, out: 12 },
        { in: 30, out: 32 },
      ]),
      m,
      1,
      5.5,
    )
    expect(m.steps).toHaveLength(3)
    const [cut, again, next] = m.steps
    expect(cut.to).toBeCloseTo(cut.want, 6)
    expect(again.to - again.want).toBeCloseTo(0.2, 1)
    expect(next.to - next.want).toBeCloseTo(0.2, 1)
    expect(m.steps.filter((s) => s.whileSeeking)).toHaveLength(0)
    // The last second of the third clip is on time to within two frames.
    expect(Math.max(...off.slice(-FPS))).toBeLessThan(2 / FPS)
  })

  it('a seek that costs more than the allowance still settles', () => {
    // Footage with sound in Safari: most of a second per seek, and the
    // element starts a second behind. Chasing 0.3s with 0.85s seeks never
    // ends; the allowance is never under what a seek costs.
    const m = makeModel({ cost: 0.85 })
    const off = play(doc([{ in: 0, out: 100 }]), m, 5, 13, 1)
    expect(m.steps.length).toBeGreaterThan(0)
    expect(m.steps.length).toBeLessThanOrEqual(3)
    expect(m.steps.filter((s) => s.whileSeeking)).toHaveLength(0)
    expect(m.landed).toBe(m.steps.length)
    // The last five seconds are quiet and the picture is on time to a frame.
    expect(m.steps.filter((s) => s.at > 8)).toHaveLength(0)
    expect(Math.max(...off.slice(-5 * FPS))).toBeLessThan(2 / FPS)
  })

  it('a landing that misses by more than a seek costs is re-aimed once', () => {
    // A cheap first cut teaches a 40ms cost; the second cut's seek takes
    // half a second, so it lands far behind where it was aimed.
    const m = makeModel({ cost: 0.04 })
    const d = doc([
      { in: 0, out: 2 },
      { in: 10, out: 12 },
      { in: 30, out: 34 },
    ])
    play(d, m, 1, 3.9)
    expect(m.steps).toHaveLength(1)
    m.cost = 0.5
    play(d, m, 3.9, 7.5)
    // The cut, then one correction with the cost it just measured. Never a third.
    expect(m.steps).toHaveLength(3)
    expect(m.steps.filter((s) => s.whileSeeking)).toHaveLength(0)
  })

  it('a step never aims onto the last frames of its piece', () => {
    // An ended element rewinds when it is played. A decoder far under the
    // rate is stepped right up to the end of a short 16× piece.
    const m = makeModel({ cost: 0.1, ceiling: 4, duration: 8 })
    play(
      doc([{ in: 0, out: 8 }], [{ id: 's', in: 0, out: 8, rate: 16 }]),
      m,
      0,
      0.5,
    )
    expect(m.steps.length).toBeGreaterThan(0)
    for (const s of m.steps)
      expect(s.to).toBeLessThanOrEqual(Math.max(s.want, 8 - 0.05) + 1e-9)
  })

  it('slow motion keeps its tighter leash', () => {
    // Half speed on a decoder that manages a quarter: 0.25 source seconds
    // behind every second. The step comes at 0.12, not at 0.3.
    const m = makeModel({ cost: 0.02, ceiling: 0.25 })
    const off = play(
      doc([{ in: 0, out: 100 }], [{ id: 's', in: 0, out: 50, rate: 0.5 }]),
      m,
      2,
      6,
    )
    expect(m.steps.length).toBeGreaterThan(1)
    // `off` is output seconds: 0.12 source seconds at half speed is 0.24.
    expect(Math.max(...off)).toBeLessThan(0.24 + 2 / FPS)
  })
})
