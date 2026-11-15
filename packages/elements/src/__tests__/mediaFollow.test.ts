import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_FOLLOWER_SRC } from '@vosjs/core/runtime'
import { createElementProps } from '../createElementProps'

/**
 * A `video` or `audio` element WHILE IT PLAYS. With the player document's
 * follower present (`window.__vos__.media`, the real one from @vosjs/core)
 * the element is kept where the program last said it should be, carried
 * forward on the player's clock (`transport.time`). With none it runs free
 * as it always did. Two ways a program plays one, both run here:
 *
 *   - LET IT RUN: set `playing` and say nothing more;
 *   - ANIMATE ITS TIME: write `currentTime` every frame.
 *
 * The media element is a MODEL: a seek takes time, `currentTime` reads the
 * target while it is in flight, and it can stall.
 */
const FPS = 60

function makeModel(o: { cost?: number; duration?: number; loop?: boolean }) {
  let pos = 0
  let target = 0
  let landAt = 0
  let wall = 0
  let stalledUntil = 0
  let rate = 1
  const listeners: Record<string, Array<() => void>> = {}
  const m = {
    paused: true,
    muted: false,
    volume: 1,
    loop: !!o.loop,
    duration: o.duration ?? 600,
    preservesPitch: true,
    seeking: false,
    steps: [] as Array<number>,
    /** Every rate the element is ever given, in order. */
    rates: [] as Array<number>,
    plays: 0,
    refuses: false,
    get playbackRate() {
      return rate
    },
    set playbackRate(x: number) {
      rate = x
      m.rates.push(x)
    },
    get currentTime() {
      return m.seeking ? target : pos
    },
    set currentTime(x: number) {
      m.steps.push(x)
      m.seeking = true
      target = x
      landAt = wall + (o.cost ?? 0.05)
    },
    get position() {
      return pos
    },
    /** The network stalls: the element stops advancing for this long. */
    stall(seconds: number) {
      stalledUntil = wall + seconds
    },
    tick(dt: number) {
      wall += dt
      if (m.seeking) {
        if (wall >= landAt - 1e-9) {
          m.seeking = false
          pos = target
          for (const fn of listeners.seeked ?? []) fn()
        }
      } else if (!m.paused && wall >= stalledUntil) {
        pos += rate * dt
        if (m.loop && m.duration > 0) pos %= m.duration
        else if (pos >= m.duration) {
          pos = m.duration
          m.paused = true
        }
      }
      return wall
    },
    play() {
      m.plays++
      if (m.refuses && !m.muted)
        return Promise.reject(
          Object.assign(new Error('blocked'), { name: 'NotAllowedError' }),
        )
      // An ended element that is played again starts over.
      if (!m.loop && pos >= m.duration) pos = 0
      m.paused = false
      return Promise.resolve()
    },
    pause() {
      m.paused = true
    },
    addEventListener(type: string, fn: () => void) {
      ;(listeners[type] ??= []).push(fn)
    },
  }
  return m
}
type Model = ReturnType<typeof makeModel>

const mesh = () =>
  ({
    scale: { x: 1, y: 1, set: () => undefined },
    position: { x: 0, y: 0, z: 0 },
    rotation: { set: () => undefined },
    material: { opacity: 1, needsUpdate: false },
    userData: {},
    renderOrder: 0,
  }) as never

describe.each([
  ['with no follower in the document', false],
  ["with the player's follower", true],
])('a playing media element, %s', (_name, follower) => {
  const g = globalThis as Record<string, unknown>
  let wall = 0
  let out = 0
  let vos: Record<string, any>
  let frames: Array<() => void> = []

  beforeEach(() => {
    wall = 0
    out = 0
    frames = []
    vi.spyOn(performance, 'now').mockImplementation(() => wall * 1000)
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
      frames.push(fn)
      return frames.length
    })
    vos = {
      isPaused: false,
      videoCallbacks: new Set<() => void>(),
      transport: { playing: true, speed: 1, epoch: 0, time: 0 },
    }
    g.window = { __vos__: vos }
    if (follower) {
      expect(MEDIA_FOLLOWER_SRC).toContain('ns.media =')
      new Function(MEDIA_FOLLOWER_SRC)()
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete g.window
  })

  function element(m: Model) {
    return createElementProps(
      {} as never,
      mesh(),
      0,
      0,
      1,
      m as unknown as HTMLMediaElement,
    ) as Record<string, any>
  }
  /**
   * Play for `seconds` of wall time. Each frame: the element advances, the
   * program writes its time when it animates one (`at(t)`, t the output
   * clock), the player publishes the clock, and the frame callbacks run, as
   * a page does.
   */
  function run(
    m: Model,
    props: Record<string, any>,
    seconds: number,
    at?: (t: number) => number,
  ) {
    for (let i = 0; i < Math.round(seconds * FPS); i++) {
      wall = m.tick(1 / FPS)
      out += vos.transport.speed / FPS
      if (at) props.currentTime = at(out)
      vos.transport.time = out
      const now = frames
      frames = []
      for (const fn of now) fn()
    }
  }
  /** The player's clock jumps: a seek, or its loop's wrap. */
  function jump(to: number) {
    out = to
    vos.transport.time = to
    vos.transport.epoch++
  }
  /** The whole player pauses or resumes, as the bridge does it. */
  function pause(paused: boolean) {
    vos.isPaused = paused
    vos.transport.playing = !paused
    for (const cb of vos.videoCallbacks) cb()
  }

  describe('left to run (the program sets `playing` and says no more)', () => {
    it('plays, and is never stepped while nothing goes wrong', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 3)
      expect(m.paused).toBe(false)
      expect(m.steps).toHaveLength(0)
      expect(m.rates).toHaveLength(0)
      expect(m.position).toBeCloseTo(3, 1)
    })

    it('a stall: the follower brings it back; without one it stays behind', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 1)
      m.stall(1)
      run(m, props, 3)
      if (follower) {
        // A second behind is over the 0.3s allowed: stepped back, few times.
        expect(m.steps.length).toBeGreaterThan(0)
        expect(m.steps.length).toBeLessThanOrEqual(4)
        expect(Math.abs(m.position - out)).toBeLessThan(0.1)
      } else {
        expect(m.steps).toHaveLength(0)
        expect(out - m.position).toBeGreaterThan(0.9)
      }
    })

    it("the player's speed reaches it", () => {
      vos.transport.speed = 2
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 3)
      if (follower) {
        expect(m.playbackRate).toBe(2)
        expect(m.steps.length).toBeLessThanOrEqual(1)
        expect(Math.abs(m.position - out)).toBeLessThan(0.1)
      } else {
        expect(m.playbackRate).toBe(1)
        expect(out - m.position).toBeGreaterThan(2.5)
      }
    })

    it('a seek of the player takes it along', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 2)
      jump(20)
      run(m, props, 1)
      if (follower) {
        expect(m.steps.length).toBeGreaterThan(0)
        expect(m.steps.length).toBeLessThanOrEqual(2)
        // One seek's cost behind at most, well inside the allowance.
        expect(Math.abs(m.position - 21)).toBeLessThan(0.1)
      } else {
        expect(m.position).toBeCloseTo(3, 1)
      }
    })

    it('a pause and resume of the player goes on from where it was', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 2)
      pause(true)
      expect(m.paused).toBe(true)
      pause(false)
      run(m, props, 1)
      if (follower) {
        expect(Math.abs(m.position - 3)).toBeLessThan(0.1)
      } else {
        // As it always was: paused back onto the time the program last
        // wrote (it never wrote one), so it starts over.
        expect(m.position).toBeCloseTo(1, 1)
      }
    })

    it('past its own end it is left alone: never replayed, never stepped there', () => {
      const m = makeModel({ duration: 2 })
      const props = element(m)
      props.playing = true
      run(m, props, 4)
      expect(m.position).toBe(2)
      expect(m.paused).toBe(true)
      expect(m.plays).toBe(1)
      expect(m.steps).toHaveLength(0)
    })

    it('a looping element goes round with the clock', () => {
      const m = makeModel({ duration: 2, loop: true })
      const props = element(m)
      props.playing = true
      run(m, props, 5)
      expect(m.steps).toHaveLength(0)
      expect(m.position).toBeCloseTo(5 % 2, 1)
    })
  })

  describe('its time animated (the program writes `currentTime` every frame)', () => {
    it('at its own rate: never stepped, its rate never touched', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 3, (t) => t)
      expect(m.paused).toBe(false)
      expect(m.steps).toHaveLength(0)
      expect(m.rates).toHaveLength(0)
      expect(m.position).toBeCloseTo(3, 1)
    })

    it('the program jumps: the follower goes with it', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 3, (t) => t)
      // The same clock, the program now ten seconds further on.
      run(m, props, 1, (t) => t + 10)
      if (follower) {
        expect(m.steps).toHaveLength(1)
        expect(m.position).toBeCloseTo(14, 1)
      } else {
        expect(m.steps).toHaveLength(0)
        expect(m.position).toBeCloseTo(4, 1)
      }
    })

    it('at half speed: the rate is measured, then held', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 4, (t) => t / 2)
      if (follower) {
        expect(m.playbackRate).toBe(0.5)
        // Set when it was measured, not on every frame.
        expect(m.rates.length).toBeLessThanOrEqual(2)
        expect(m.steps.length).toBeLessThanOrEqual(1)
        expect(Math.abs(m.position - out / 2)).toBeLessThan(0.15)
      } else {
        expect(m.rates).toHaveLength(0)
      }
    })

    it("at the player's speed 2: the element runs at 2, measured as rate 1", () => {
      vos.transport.speed = 2
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 3, (t) => t)
      if (follower) {
        expect(m.playbackRate).toBe(2)
        expect(m.steps.length).toBeLessThanOrEqual(1)
        expect(Math.abs(m.position - out)).toBeLessThan(0.1)
      } else {
        expect(m.playbackRate).toBe(1)
      }
    })

    it('held still: not followed, the element runs free', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 3, () => 5)
      // Placed where the program said, once at most, and then left to run.
      expect(m.steps.length).toBeLessThanOrEqual(1)
      expect(m.paused).toBe(false)
      expect(m.position).toBeGreaterThan(follower ? 7 : 2.9)
    })

    it('moving backward: not followed', () => {
      const m = makeModel({})
      const props = element(m)
      props.playing = true
      run(m, props, 3, (t) => 10 - t)
      expect(m.steps.length).toBeLessThanOrEqual(1)
    })
  })

  it("a paused frame is the program's: the element is put exactly there", () => {
    vos.isPaused = true
    const m = makeModel({})
    const props = element(m)
    props.playing = true
    props.currentTime = 7.25
    expect(m.steps).toEqual([7.25])
    expect(m.paused).toBe(true)
  })

  it('an element that is not playing is not followed', () => {
    const m = makeModel({})
    const props = element(m)
    run(m, props, 1, (t) => t)
    expect(m.paused).toBe(true)
    expect(m.plays).toBe(0)
    expect(frames).toHaveLength(0)
  })

  it('a browser that refuses sound: muted by the follower until the viewer acts', async () => {
    const m = makeModel({})
    m.refuses = true
    const props = element(m)
    props.playing = true
    await Promise.resolve()
    await Promise.resolve()
    if (!follower) {
      // As it always was: refused, and left paused.
      expect(m.paused).toBe(true)
      return
    }
    expect(m.muted).toBe(true)
    expect(m.paused).toBe(false)
    // The player pauses and resumes: the mute stays.
    pause(true)
    pause(false)
    expect(m.muted).toBe(true)
    // The viewer has acted: the next frame lifts it.
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } })
    run(m, props, 0.1)
    expect(m.muted).toBe(false)
  })

  it("the instance's mute outlasts the follower's", async () => {
    if (!follower) return
    const m = makeModel({})
    m.refuses = true
    const props = element(m)
    props.playing = true
    await Promise.resolve()
    await Promise.resolve()
    expect(m.muted).toBe(true)
    vos.isMuted = true
    vi.stubGlobal('navigator', { userActivation: { hasBeenActive: true } })
    run(m, props, 0.1)
    // The follower lifted its own; the host's still says muted.
    expect((m as Record<string, any>).__vosAutoMuted).toBe(false)
    expect(m.muted).toBe(true)
  })
})
