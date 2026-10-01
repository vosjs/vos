import { describe, expect, it } from 'vitest'
import { resolveEase, springSettleTime } from '@vosjs/timeline'
import { PAINTER_LIB } from '../painterLib'

// The block runs as written into a program: evaluated, it defines `lib`.
const lib = new Function(`${PAINTER_LIB}\nreturn lib`)() as {
  spring: (o: Record<string, unknown>) => number
  springFrames: (fps: number, config?: Record<string, unknown>) => number
  springSeconds: (config?: { damping?: number; stiffness?: number }) => number
  springTo: (...a: unknown[]) => number
  interpolate: (
    v: number,
    a: number[],
    b: number[],
    o?: Record<string, unknown>,
  ) => number
  bezier: (...a: number[]) => (x: number) => number
  noise2D: (seed: unknown, x: number, y: number) => number
  noise3D: (seed: unknown, x: number, y: number, z: number) => number
  random: (seed: unknown) => number
}

// Remotion's spring, measured by running it (remotion 4.0.529), frames 0..12.
const REMOTION = {
  default30: [
    0, 0.04941510804510185, 0.17381586354057232, 0.3402998466082984,
    0.5213516324407459, 0.6958917272121958, 0.8494256348541122,
    0.9735341838620929, 1.0649395616400006, 1.1243547674084116,
    1.1552855913778497, 1.1629107356164519, 1.153122768414049,
  ],
  // `damping: 200`, the smooth spring: frames 0..9.
  smooth30: [
    0, 0.0446, 0.1443, 0.2642, 0.3849, 0.4963, 0.594, 0.6768, 0.7452, 0.8009,
  ],
}

describe('the painter starter', () => {
  it("springs the way Remotion's spring does, frame by frame", () => {
    REMOTION.default30.forEach((v, frame) =>
      expect(lib.spring({ frame, fps: 30 })).toBeCloseTo(v, 9),
    )
    REMOTION.smooth30.forEach((v, frame) =>
      expect(
        lib.spring({ frame, fps: 30, config: { damping: 200 } }),
      ).toBeCloseTo(v, 4),
    )
  })

  it('stretches to durationInFrames and lands on `to` past it, as Remotion does', () => {
    // Remotion, default config stretched to 20 frames: frames 1, 5, 19, 21.
    const at = (frame: number) =>
      lib.spring({ frame, fps: 30, durationInFrames: 20 })
    expect(at(1)).toBeCloseTo(0.0921, 3)
    expect(at(5)).toBeCloseTo(0.9735, 3)
    expect(at(19)).toBeCloseTo(0.99118, 4)
    expect(at(21)).toBe(1)
    expect(lib.springFrames(30)).toBe(28)
    expect(lib.springFrames(30, { damping: 200 })).toBe(23)
  })

  it("gives the duration that makes the timeline's spring ease Remotion's spring", () => {
    for (const config of [
      {},
      { damping: 200 },
      { damping: 12, stiffness: 180 },
    ]) {
      const secs = lib.springSeconds(config)
      expect(secs).toBe(
        springSettleTime(config.damping, config.stiffness, undefined),
      )
      // A tween that long, eased spring(...), IS Remotion's spring.
      const ease = resolveEase(
        `spring(${config.damping ?? 10}, ${config.stiffness ?? 100}, 1)`,
      )
      for (let frame = 0; frame * (1 / 30) < secs; frame++)
        expect(ease(frame / 30 / secs)).toBeCloseTo(
          lib.spring({ frame, fps: 30, config }),
          9,
        )
    }
  })

  it('takes from, to, delay, and clamps an overshoot when asked', () => {
    expect(lib.spring({ frame: 0, fps: 30, from: 100, to: 200 })).toBe(100)
    expect(lib.spring({ frame: 300, fps: 30, from: 100, to: 200 })).toBeCloseTo(
      200,
      3,
    )
    expect(lib.spring({ frame: 5, fps: 30, delay: 5 })).toBe(0)
    expect(
      lib.spring({ frame: 11, fps: 30, config: { overshootClamping: true } }),
    ).toBe(1)
    // Over- and critically damped settle without overshoot.
    for (const damping of [20, 200])
      for (let f = 0; f < 90; f++)
        expect(
          lib.spring({ frame: f, fps: 30, config: { damping } }),
        ).toBeLessThanOrEqual(1)
  })

  it('puts a spring on the timeline, one linear step per frame, landing exactly', () => {
    const calls: { at: number; v: Record<string, unknown> }[] = []
    const tl = {
      set: (_t: unknown, v: Record<string, unknown>, at: number) =>
        calls.push({ at, v }),
      to: (_t: unknown, v: Record<string, unknown>, at: number) =>
        calls.push({ at, v }),
    }
    const end = lib.springTo(tl, {}, { y: [120, 0] }, 1, { fps: 30 })
    const frames = lib.springFrames(30)
    expect(calls).toHaveLength(frames + 1)
    expect(calls[0]).toEqual({ at: 1, v: { y: 120 } })
    expect(calls[1].v).toMatchObject({ duration: 1 / 30, ease: 'none' })
    expect(calls[1].v.y).toBeCloseTo(120 - 120 * REMOTION.default30[1], 6)
    expect(calls.at(-1)!.v.y).toBe(0)
    expect(end).toBeCloseTo(1 + frames / 30, 9)
  })

  it('interpolates over any number of stops, extrapolating as asked', () => {
    expect(lib.interpolate(5, [0, 10], [0, 100])).toBe(50)
    expect(lib.interpolate(15, [0, 10, 20], [0, 100, 0])).toBe(50)
    expect(lib.interpolate(-5, [0, 10], [0, 100])).toBe(-50)
    expect(
      lib.interpolate(-5, [0, 10], [0, 100], { extrapolateLeft: 'clamp' }),
    ).toBe(0)
    expect(
      lib.interpolate(20, [0, 10], [0, 100], { extrapolateRight: 'identity' }),
    ).toBe(20)
  })

  it('eases along a cubic bezier', () => {
    const linear = lib.bezier(0, 0, 1, 1)
    const ease = lib.bezier(0.25, 0.1, 0.25, 1)
    expect(linear(0.3)).toBeCloseTo(0.3, 5)
    expect(ease(0.5)).toBeCloseTo(0.8024, 3)
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
  })

  it('gives seeded noise in [-1, 1], the same for a seed, different across seeds', () => {
    let lo = 1,
      hi = -1
    for (let i = 0; i < 400; i++) {
      const v = lib.noise3D('blob', i * 0.137, i * 0.071, i * 0.05)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
      expect(Math.abs(v)).toBeLessThanOrEqual(1)
    }
    expect(hi - lo).toBeGreaterThan(1)
    expect(lib.noise2D('a', 1.3, 2.7)).toBe(lib.noise2D('a', 1.3, 2.7))
    expect(lib.noise2D('a', 1.3, 2.7)).not.toBe(lib.noise2D('b', 1.3, 2.7))
    expect(lib.random(7)).toBe(lib.random(7))
  })
})
