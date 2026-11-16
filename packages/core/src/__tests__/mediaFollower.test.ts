import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_FOLLOWER_SRC } from '../runtime/mediaFollower'
import { generateRenderTemplate } from '../runtime/renderTemplate'
import type { MediaFollowTarget, VosMedia } from '../runtime/mediaFollower'

/**
 * The follower, RUN against a model element that behaves the way a real
 * one does where the rule bites: a seek takes time, `currentTime` reads the
 * TARGET while it is in flight, and assigning it during a seek starts the
 * seek over. The cases a take's footage exercises (cuts, rated pieces, a
 * dear seek) are run through the lowered program in studio-core's
 * footageStep.test.ts, both ways; these are what only the follower does.
 */
const FPS = 60

function makeModel(o: { cost: number; ceiling?: number; refuses?: boolean }) {
  let pos = 0
  let target = 0
  let landAt = 0
  let wall = 0
  const listeners: Record<string, Array<() => void>> = {}
  const m = {
    paused: true,
    muted: !o.refuses,
    playbackRate: 1,
    preservesPitch: true,
    seeking: false,
    steps: [] as Array<{ to: number; whileSeeking: boolean }>,
    plays: 0,
    get currentTime() {
      return m.seeking ? target : pos
    },
    set currentTime(x: number) {
      m.steps.push({ to: x, whileSeeking: m.seeking })
      m.seeking = true
      target = x
      landAt = wall + o.cost
    },
    get position() {
      return pos
    },
    place(x: number) {
      pos = x
    },
    tick(dt: number, loop = 0) {
      wall += dt
      if (m.seeking) {
        if (wall >= landAt - 1e-9) {
          m.seeking = false
          pos = target
          for (const fn of listeners.seeked ?? []) fn()
        }
      } else if (!m.paused) {
        pos += Math.min(m.playbackRate, o.ceiling ?? 16) * dt
        if (loop) pos %= loop
      }
      return wall
    },
    play() {
      m.plays++
      // An unmuted play() with no gesture: the autoplay policy.
      if (o.refuses && !m.muted)
        return Promise.reject(
          Object.assign(new Error('blocked'), { name: 'NotAllowedError' }),
        )
      m.paused = false
      return Promise.resolve()
    },
    addEventListener(type: string, fn: () => void) {
      ;(listeners[type] ??= []).push(fn)
    },
  }
  return m
}

describe('the media follower', () => {
  const g = globalThis as Record<string, unknown>
  let wall = 0
  let media: VosMedia
  let transport: { playing: boolean; speed: number; epoch: number }

  beforeEach(() => {
    wall = 0
    vi.spyOn(performance, 'now').mockImplementation(() => wall * 1000)
    transport = { playing: true, speed: 1, epoch: 0 }
    g.window = { __vos__: { transport } }
    new Function(MEDIA_FOLLOWER_SRC)()
    media = (g.window as { __vos__: { media: VosMedia } }).__vos__.media
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete g.window
  })

  /** One frame: the element advances, then the caller says where it should be. */
  function frame(
    m: ReturnType<typeof makeModel>,
    target: MediaFollowTarget,
    loop = 0,
  ) {
    wall = m.tick(1 / FPS, loop)
    return media.follow(m as unknown as HTMLMediaElement, target)
  }

  it('is installed by the playback document, and by nothing else', () => {
    expect(media.v).toBe(1)
    expect(generateRenderTemplate('', { mode: 'playback' })).toContain(
      'ns.media = { v: 1, follow: follow, draw: draw };',
    )
    expect(
      generateRenderTemplate('export const initVos = async () => ({})', {
        mode: 'capture-thumbnail',
        capture: { width: 320, height: 180, time: 0 },
      } as never),
    ).not.toContain('ns.media =')
  })

  it('a loop is measured around its wrap: the boundary is not a step', () => {
    // A 10s loop on the output clock. The element wraps a frame or two off
    // the clock; the raw distance is about ten seconds, the real one a frame.
    const m = makeModel({ cost: 0.05 })
    m.place(9.5)
    let t = 9.5
    for (let i = 0; i < 2 * FPS; i++) {
      t = (t + 1 / FPS) % 10
      frame(m, { at: t, piece: 'bg', loop: { dur: 10 } }, 10)
    }
    expect(m.steps).toHaveLength(0)
    expect(m.paused).toBe(false)
  })

  it('a loop that drifted is stepped once, and the aim wraps', () => {
    const m = makeModel({ cost: 0.2 })
    m.place(3)
    // Teach it what a seek costs here: one step from a second off.
    let t = 4
    for (let i = 0; i < FPS; i++) {
      t = (t + 1 / FPS) % 10
      frame(m, { at: t, piece: 'bg', loop: { dur: 10 } }, 10)
    }
    const taught = m.steps.length
    expect(taught).toBeGreaterThan(0)
    expect(taught).toBeLessThanOrEqual(2)
    // Now knock it a second off just before the wrap: the step is aimed
    // ahead by the cost, past the end, so it lands at the loop's start.
    m.place(8.9)
    t = 9.9
    frame(m, { at: t, piece: 'bg', loop: { dur: 10 } }, 10)
    expect(m.steps).toHaveLength(taught + 1)
    const to = m.steps.at(-1)!.to
    expect(to).toBeLessThan(1)
    expect(to).toBeCloseTo((9.9 + 0.2) % 10, 1)
  })

  it('one element, two callers: the lead is followed and the other stands back', () => {
    // A layer that shows the take's own footage: the card wants second 40,
    // the layer second 5, on the same element.
    const m = makeModel({ cost: 0.05 })
    m.place(40)
    let a = 40
    let b = 5
    let ignored = 0
    for (let i = 0; i < FPS; i++) {
      a += 1 / FPS
      b += 1 / FPS
      frame(m, { lead: true, at: a, piece: 0 })
      if (
        !media.follow(m as unknown as HTMLMediaElement, { at: b, piece: 'l1' })
      )
        ignored++
    }
    expect(ignored).toBe(FPS)
    expect(m.steps).toHaveLength(0)
    expect(m.position).toBeCloseTo(a, 1)
    // The card stops asking (its clip ended): the layer takes the element.
    for (let i = 0; i < FPS; i++) {
      b += 1 / FPS
      frame(m, { at: b, piece: 'l1' })
    }
    expect(m.steps).toHaveLength(1)
    expect(m.position).toBeCloseTo(b, 1)
  })

  it('a seek in flight is left alone, unless the clock jumped', () => {
    const m = makeModel({ cost: 0.5 })
    m.place(0)
    // A second behind: one step, half a second in flight.
    frame(m, { at: 10, piece: 0 })
    expect(m.steps).toHaveLength(1)
    // The same piece, the playhead moving on: nothing is issued over it.
    for (let i = 1; i <= 10; i++) frame(m, { at: 10 + i / FPS, piece: 0 })
    expect(m.steps).toHaveLength(1)
    // The viewer seeks (the transport's epoch ticks), inside the same
    // piece: the seek in flight aims nowhere near, and is re-aimed once.
    transport.epoch++
    frame(m, { at: 60, piece: 0 })
    expect(m.steps).toHaveLength(2)
    expect(m.steps[1].whileSeeking).toBe(true)
    for (let i = 1; i <= 10; i++) frame(m, { at: 60 + i / FPS, piece: 0 })
    expect(m.steps).toHaveLength(2)
  })

  it("carries the player's speed: the rate, the lead and the allowance", () => {
    // A 3.2× piece at player speed 2: 6.4 source seconds a wall second.
    transport.speed = 2
    const m = makeModel({ cost: 0.05 })
    m.place(20)
    let at = 20
    for (let i = 0; i < 2 * FPS; i++) {
      // The element starts playing on the first frame, so the clock and it
      // leave together.
      if (i) at += (3.2 * 2) / FPS
      frame(m, { at, rate: 3.2, piece: 0 })
    }
    expect(m.playbackRate).toBeCloseTo(6.4, 6)
    expect(m.preservesPitch).toBe(false)
    // It holds the rate, so it is never stepped: before, the element stayed
    // at 3.2× under a clock running 6.4 and was stepped 15 times a second.
    expect(m.steps).toHaveLength(0)
    expect(Math.abs(m.position - at)).toBeLessThan(0.2)
  })

  it('never asks the browser for a rate it refuses', () => {
    transport.speed = 2
    const m = makeModel({ cost: 0.05 })
    frame(m, { at: 0, rate: 16, piece: 0 })
    expect(m.playbackRate).toBe(16)
    transport.speed = 0.5
    frame(m, { at: 0, rate: 0.05, piece: 0 })
    expect(m.playbackRate).toBe(0.0625)
  })

  it('plays muted when the browser refuses sound, and lifts the mute when the viewer asks', async () => {
    const m = makeModel({ cost: 0.05, refuses: true })
    frame(m, { at: 0, piece: 0 })
    await Promise.resolve()
    await Promise.resolve()
    expect(m.muted).toBe(true)
    expect(m.paused).toBe(false)
    frame(m, { at: 1 / FPS, piece: 0 })
    expect(m.muted).toBe(true)
    frame(m, { at: 2 / FPS, piece: 0, unlocked: true })
    expect(m.muted).toBe(false)
  })

  it('without a transport it is the rule at speed 1', () => {
    delete (g.window as { __vos__: { transport?: unknown } }).__vos__.transport
    const m = makeModel({ cost: 0.05 })
    m.place(5)
    let at = 5
    for (let i = 0; i < FPS; i++) {
      if (i) at += 4 / FPS
      frame(m, { at, rate: 4, piece: 0 })
    }
    expect(m.playbackRate).toBe(4)
    expect(m.steps).toHaveLength(0)
  })
})
