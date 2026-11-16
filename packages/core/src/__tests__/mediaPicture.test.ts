import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_FOLLOWER_SRC } from '../runtime/mediaFollower'
import { generateRenderTemplate } from '../runtime/renderTemplate'
import type {
  MediaFollowTarget,
  MediaSink,
  VosMedia,
} from '../runtime/mediaFollower'

/**
 * The picture from a decoder, RUN: the follower against a model element
 * (a seek takes time, a playing one advances at its rate) and a model
 * decoder that has a CAPACITY, in source seconds a wall second, keyframes
 * every two seconds, and decodes from the keyframe under wherever it is
 * asked to start. What a real decoder and a real file do is the picture
 * gate's (a browser); these are the rules: when the decoder is the
 * picture, when it gives the picture back, and what the element does
 * meanwhile.
 */
const FPS = 60
const KEY = 2

function makeElement(o: { cost: number; ceiling?: number }) {
  let pos = 0
  let target = 0
  let landAt = 0
  let wall = 0
  const listeners: Record<string, Array<() => void>> = {}
  const m = {
    paused: true,
    muted: true,
    playbackRate: 1,
    preservesPitch: true,
    seeking: false,
    readyState: 4,
    duration: 600,
    videoWidth: 1920,
    videoHeight: 1080,
    currentSrc: 'https://example.test/footage.mp4',
    steps: [] as Array<{ to: number; whileSeeking: boolean }>,
    pauses: 0,
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
    tick(dt: number) {
      wall += dt
      if (m.seeking) {
        if (wall >= landAt - 1e-9) {
          m.seeking = false
          pos = target
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
      if (!m.paused) m.pauses++
      m.paused = true
    },
    addEventListener(type: string, fn: () => void) {
      ;(listeners[type] ??= []).push(fn)
    },
  }
  return m
}

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

function makeDecoder(o: { capacity: number }) {
  type It = { burn: number; n: number }
  type Ask = { it: It; res: (r: { done: boolean; value?: unknown }) => void }
  // One ask outstanding per walk; two walks (the walk, the walk ahead)
  // share the one decoder's capacity.
  let asks: Array<Ask> = []
  const s = {
    capacity: o.capacity,
    budget: 0,
    /** Frames decoded, the ones burnt from a keyframe included. */
    decoded: 0,
    /** Walks begun: the first, and one for every start-over. */
    walks: 0,
    /** Samples made and not closed. */
    live: 0,
    drawn: [] as Array<number>,
    tick(dt: number) {
      const add = s.capacity * dt * FPS
      // A decoder does not bank idle time: a few frames ahead, no more.
      s.budget = Math.min(s.budget + add, add + 6)
    },
    sink: {
      samples(t: number) {
        s.walks++
        const n = Math.floor(t * FPS + 1e-6)
        const it: It & {
          next: () => Promise<unknown>
          return: () => Promise<unknown>
        } = {
          n,
          burn: n - Math.round(Math.floor(t / KEY + 1e-9) * KEY * FPS),
          next: () =>
            new Promise((res) => {
              asks.push({ it, res: res as never })
            }),
          return: () => {
            const mine = asks.filter((a) => a.it === it)
            asks = asks.filter((a) => a.it !== it)
            for (const a of mine) a.res({ done: true })
            return Promise.resolve({ done: true })
          },
        }
        return it as never
      },
      keyAt: (t: number) => Promise.resolve(Math.floor(t / KEY + 1e-9) * KEY),
    } as MediaSink,
    /** Decode what the budget allows, the walks asking as they go. */
    async drain() {
      for (let i = 0; i < 100000; i++) {
        await flush()
        const p = asks[0]
        if (!p) return
        if (p.it.burn > 0) {
          const b = Math.min(p.it.burn, Math.floor(s.budget))
          if (b < 1) return
          p.it.burn -= b
          s.budget -= b
          s.decoded += b
          continue
        }
        if (s.budget < 1) return
        s.budget -= 1
        s.decoded++
        asks.shift()
        const idx = p.it.n++
        s.live++
        p.res({
          done: false,
          value: {
            timestamp: idx / FPS,
            duration: 1 / FPS,
            draw: () => s.drawn.push(idx),
            close: () => s.live--,
          },
        })
      }
    },
  }
  return s
}

describe('the picture from a decoder', () => {
  const g = globalThis as Record<string, unknown>
  let wall = 0
  let media: VosMedia
  let transport: { playing: boolean; speed: number; epoch: number }
  let opened = 0
  let timers: Array<() => void> = []

  function install(o: {
    decoder: ReturnType<typeof makeDecoder> | null
    on?: boolean
  }) {
    transport = { playing: true, speed: 1, epoch: 0 }
    g.window = {
      VideoDecoder: function () {},
      __vos__: {
        transport,
        mediaDecoder: o.on !== false,
        mediaSink: () => {
          opened++
          return Promise.resolve(o.decoder ? o.decoder.sink : null)
        },
      },
    }
    new Function(MEDIA_FOLLOWER_SRC)()
    media = (g.window as { __vos__: { media: VosMedia } }).__vos__.media
  }

  beforeEach(() => {
    wall = 0
    opened = 0
    timers = []
    vi.spyOn(performance, 'now').mockImplementation(() => wall * 1000)
    vi.stubGlobal('setInterval', (fn: () => void) => timers.push(fn))
    vi.stubGlobal('clearInterval', (id: number) => {
      timers[id - 1] = () => {}
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete g.window
  })

  type El = ReturnType<typeof makeElement>
  const c2d = {} as CanvasRenderingContext2D
  /** One frame: the world advances, the caller follows, then draws. */
  async function frame(
    el: El,
    dec: ReturnType<typeof makeDecoder> | null,
    target: MediaFollowTarget,
  ) {
    wall = el.tick(1 / FPS)
    dec?.tick(1 / FPS)
    media.follow(el as unknown as HTMLMediaElement, {
      lead: true,
      picture: true,
      ...target,
    })
    const drew = media.draw(
      el as unknown as HTMLMediaElement,
      c2d,
      null,
      0,
      0,
      1920,
      1080,
      target.at,
    )
    await dec?.drain()
    return drew
  }
  /**
   * Play a piece from `from` at `rate` for `seconds` of output; returns
   * which frames the decoder drew and how far its picture was from the
   * clock, in output seconds.
   */
  async function piece(
    el: El,
    dec: ReturnType<typeof makeDecoder> | null,
    o: {
      from: number
      rate: number
      seconds: number
      piece: number
      silent?: boolean
    },
  ) {
    const drew: Array<boolean> = []
    const off: Array<number> = []
    let at = o.from
    const end = o.from + o.rate * o.seconds
    for (let i = 0; i < Math.round(o.seconds * FPS); i++) {
      at += o.rate / FPS
      const before = dec ? dec.drawn.length : 0
      const d = await frame(el, dec, {
        at,
        rate: o.rate,
        piece: o.piece,
        end,
        silent: o.silent,
      })
      drew.push(d)
      if (d && dec && dec.drawn.length > before)
        off.push(Math.abs(dec.drawn.at(-1)! / FPS - at) / o.rate)
    }
    return { drew, off, end }
  }
  const share = (a: Array<boolean>) => a.filter(Boolean).length / a.length

  it('is the host switch: the document carries it only when asked, and only for playback', () => {
    expect(
      generateRenderTemplate('', { mode: 'playback', mediaDecoder: true }),
    ).toContain('window.__vos__.mediaDecoder = true;')
    expect(generateRenderTemplate('', { mode: 'playback' })).not.toContain(
      '__vos__.mediaDecoder = true',
    )
    expect(
      generateRenderTemplate('export const initVos = async () => ({})', {
        mode: 'capture-thumbnail',
        mediaDecoder: true,
        capture: { width: 320, height: 180, time: 0 },
      } as never),
    ).not.toContain('__vos__.mediaDecoder = true')
  })

  it('switched off, nothing is opened and the element is the picture', async () => {
    const dec = makeDecoder({ capacity: 40 })
    install({ decoder: dec, on: false })
    const el = makeElement({ cost: 0.05 })
    const r = await piece(el, dec, {
      from: 10,
      rate: 4,
      seconds: 2,
      piece: 0,
      silent: true,
    })
    expect(opened).toBe(0)
    expect(share(r.drew)).toBe(0)
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(4)
  })

  it('a caller that does not ask for the picture is untouched', async () => {
    const dec = makeDecoder({ capacity: 40 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    let at = 10
    for (let i = 0; i < 2 * FPS; i++) {
      at += 4 / FPS
      wall = el.tick(1 / FPS)
      media.follow(el as unknown as HTMLMediaElement, { at, rate: 4 })
    }
    expect(opened).toBe(0)
    expect(el.paused).toBe(false)
  })

  it('at plain 1× the decoder is never opened', async () => {
    const dec = makeDecoder({ capacity: 40 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    const r = await piece(el, dec, {
      from: 10,
      rate: 1,
      seconds: 3,
      piece: 0,
      silent: true,
    })
    expect(opened).toBe(0)
    expect(share(r.drew)).toBe(0)
    expect(el.steps).toHaveLength(0)
  })

  it('a fast piece: the decoder is the picture, on the clock, and a silent element rests at its end', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    await piece(el, dec, { from: 10, rate: 1, seconds: 1, piece: 0 })
    const r = await piece(el, dec, {
      from: 11,
      rate: 8,
      seconds: 3,
      piece: 1,
      silent: true,
    })
    expect(opened).toBe(1)
    // The picture is the decoder's once it has opened and found its place.
    expect(share(r.drew)).toBeGreaterThan(0.9)
    expect(share(r.drew.slice(30))).toBe(1)
    // Two frames of the output clock at most, from start to end.
    expect(Math.max(...r.off.slice(10))).toBeLessThan(2.5 / FPS)
    // The element: paused, and parked where the piece ends, by one seek.
    expect(el.paused).toBe(true)
    expect(el.position).toBeCloseTo(r.end, 3)
    const parks = el.steps.filter((s) => Math.abs(s.to - r.end) < 1e-6)
    expect(parks).toHaveLength(1)
    expect(el.steps.filter((s) => s.whileSeeking)).toHaveLength(0)
    // One decoder holds one frame.
    expect(dec.live).toBeLessThanOrEqual(1)
  })

  /** Play a piece, saying each frame what piece comes after it. */
  async function pieceThen(
    el: El,
    dec: ReturnType<typeof makeDecoder>,
    o: { from: number; rate: number; seconds: number; piece: number },
    next: { at: number; rate: number },
  ) {
    const drew: Array<boolean> = []
    let at = o.from
    const end = o.from + o.rate * o.seconds
    const n = Math.round(o.seconds * FPS)
    for (let i = 0; i < n; i++) {
      at += o.rate / FPS
      drew.push(
        await frame(el, dec, {
          at,
          rate: o.rate,
          piece: o.piece,
          end,
          silent: true,
          warm: true,
          next: { ...next, in: (n - 1 - i) / FPS },
        }),
      )
    }
    return { drew, end }
  }

  it("told what comes next, a fast piece is the decoder's from its first frame, across a cut too", async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.1 })
    el.place(10)
    // One second at 1×, then a cut to source 40 at 4×.
    const a = await pieceThen(
      el,
      dec,
      { from: 10, rate: 1, seconds: 1, piece: 0 },
      { at: 40, rate: 4 },
    )
    expect(a.drew.some(Boolean)).toBe(false)
    // One walk, begun in the last 0.3 s, holding one frame.
    expect(dec.walks).toBe(1)
    expect(dec.live).toBe(1)
    const r = await piece(el, dec, {
      from: 40,
      rate: 4,
      seconds: 1,
      piece: 1,
      silent: true,
    })
    expect(r.drew[0]).toBe(true)
    expect(share(r.drew)).toBe(1)
    expect(Math.max(...r.off)).toBeLessThan(2.5 / FPS)
    // The walk ahead became the walk: no second one was begun.
    expect(dec.walks).toBe(1)
  })

  it('a cut between two fast pieces: the next one is on screen on the frame of the cut', async () => {
    // The incident's time-lapse: 16× pieces of one recording, minutes apart.
    const dec = makeDecoder({ capacity: 40 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.1 })
    el.place(22)
    const a = await pieceThen(
      el,
      dec,
      { from: 22, rate: 16, seconds: 2, piece: 0 },
      { at: 330, rate: 16 },
    )
    expect(share(a.drew.slice(30))).toBe(1)
    const before = dec.drawn.length
    const r = await piece(el, dec, {
      from: 330,
      rate: 16,
      seconds: 1,
      piece: 1,
      silent: true,
    })
    // Every frame of the new piece is the decoder's, and the first frame
    // drawn after the cut is from the new piece, not a hold on the old one.
    expect(share(r.drew)).toBe(1)
    expect(dec.drawn[before] / FPS).toBeGreaterThanOrEqual(330)
    expect(Math.max(...r.off)).toBeLessThan(2.5 / FPS)
    // Two walks in all, and when the cut is done one frame is held.
    expect(dec.walks).toBe(2)
    expect(dec.live).toBe(1)
  })

  it('a walk ahead for a piece that never comes is let go', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.1 })
    el.place(10)
    await pieceThen(
      el,
      dec,
      { from: 10, rate: 1, seconds: 1, piece: 0 },
      { at: 40, rate: 4 },
    )
    expect(dec.live).toBe(1)
    // The viewer seeks elsewhere instead: plain 1×, nothing fast in sight.
    transport.epoch++
    await piece(el, dec, { from: 100, rate: 1, seconds: 0.5, piece: 5 })
    expect(dec.live).toBe(0)
  })

  it('the hand-back: the next piece starts from where the element was parked, with no seek', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    const fast = await piece(el, dec, {
      from: 10,
      rate: 8,
      seconds: 3,
      piece: 0,
      silent: true,
    })
    const seeks = el.steps.length
    const after = await piece(el, dec, {
      from: fast.end,
      rate: 1,
      seconds: 2,
      piece: 1,
      silent: true,
    })
    expect(el.steps.length).toBe(seeks)
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(1)
    // The element is the picture again within a few frames, and stays it.
    expect(after.drew.slice(6).some(Boolean)).toBe(false)
    expect(Math.abs(el.position - (fast.end + 2))).toBeLessThan(0.1)
  })

  it('the hand-back across a cut: the decoder covers while a silent element is brought onto the clock, then steps aside', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    // A fifth of a second a seek, and no seek measured yet: the first
    // step lands that far behind.
    const el = makeElement({ cost: 0.2 })
    el.place(10)
    await piece(el, dec, {
      from: 10,
      rate: 8,
      seconds: 2,
      piece: 0,
      silent: true,
    })
    const seeks = el.steps.length
    const after = await piece(el, dec, {
      from: 200,
      rate: 1,
      seconds: 3,
      piece: 1,
      silent: true,
    })
    // The picture never waited for the element: the decoder had it from
    // a few frames after the cut until the element was back.
    const first = after.drew.indexOf(true)
    expect(first).toBeLessThan(8)
    expect(Math.max(...after.off)).toBeLessThan(2.5 / FPS)
    const last = after.drew.lastIndexOf(true)
    expect(last).toBeLessThan(1.5 * FPS)
    // The element: the cut's seek and one more to land on the clock, none
    // issued while another was in flight, and it ends within a tenth.
    const mine = el.steps.slice(seeks)
    expect(mine.length).toBeGreaterThanOrEqual(1)
    expect(mine.length).toBeLessThanOrEqual(3)
    expect(mine.filter((x) => x.whileSeeking)).toHaveLength(0)
    expect(Math.abs(el.position - 203)).toBeLessThan(0.1)
    expect(el.paused).toBe(false)
  })

  it('an element with sound keeps playing under the decoder: it is never paused', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    const r = await piece(el, dec, {
      from: 10,
      rate: 4,
      seconds: 3,
      piece: 0,
      silent: false,
    })
    expect(share(r.drew.slice(30))).toBe(1)
    expect(el.pauses).toBe(0)
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(4)
    expect(Math.abs(el.position - r.end)).toBeLessThan(1.3)
  })

  it('another caller drawing the same element keeps it playing', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    let at = 10
    for (let i = 0; i < 2 * FPS; i++) {
      at += 4 / FPS
      wall = el.tick(1 / FPS)
      dec.tick(1 / FPS)
      const t = { at, rate: 4, piece: 0, end: 100, silent: true }
      media.follow(el as unknown as HTMLMediaElement, {
        ...t,
        lead: true,
        picture: true,
      })
      // A layer that shows the same footage, and draws the element itself.
      media.follow(el as unknown as HTMLMediaElement, t)
      await dec.drain()
    }
    expect(el.pauses).toBe(0)
    expect(el.paused).toBe(false)
  })

  it('short of the rate, it catches up by keyframes and stays the picture while that keeps it inside the allowance', async () => {
    // The incident in Safari: 16× on a decoder that holds 9×. An element
    // there presents a few frames a second; the decoder runs on and steps
    // to the keyframe under the clock each time it trails by the allowance.
    const dec = makeDecoder({ capacity: 9 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05, ceiling: 16 })
    el.place(10)
    const r = await piece(el, dec, {
      from: 10,
      rate: 16,
      seconds: 4,
      piece: 0,
      silent: true,
    })
    expect(share(r.drew.slice(30))).toBe(1)
    // Several start-overs, each at a keyframe, and never far behind: the
    // allowance, and the time one catch-up takes.
    expect(dec.walks).toBeGreaterThan(3)
    expect(Math.max(...r.off.slice(30))).toBeLessThan(0.3 + 0.25)
    expect(el.paused).toBe(true)
  })

  it('capacity decides: a decoder that cannot catch up gives the picture back, and is not asked again at that rate', async () => {
    const dec = makeDecoder({ capacity: 1.5 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05, ceiling: 16 })
    el.place(10)
    const r = await piece(el, dec, {
      from: 10,
      rate: 16,
      seconds: 4,
      piece: 0,
      silent: true,
    })
    // It gave up inside two and a half seconds, and the element has
    // played since, stepped back onto the clock.
    expect(r.drew.slice(2.5 * FPS).some(Boolean)).toBe(false)
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(16)
    expect(Math.abs(el.position - r.end)).toBeLessThan(16 * 0.3 + 1)
    // Asked again at the same rate, it is not even walked.
    const before = dec.decoded
    const again = await piece(el, dec, {
      from: r.end,
      rate: 16,
      seconds: 1,
      piece: 0,
      silent: true,
    })
    expect(dec.decoded).toBe(before)
    expect(share(again.drew)).toBe(0)
    // Nor at a cut inside that rate: no cover it cannot keep, no walk ahead.
    transport.epoch++
    await piece(el, dec, {
      from: 300,
      rate: 16,
      seconds: 1,
      piece: 7,
      silent: true,
    })
    expect(dec.decoded).toBe(before)
  })

  it('one long frame is not a verdict: the decoder keeps a rate it can hold', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    await piece(el, dec, {
      from: 10,
      rate: 4,
      seconds: 1,
      piece: 0,
      silent: true,
    })
    // The tab sleeps for three seconds; the clock is found far ahead.
    wall += 3
    const r = await piece(el, dec, {
      from: 400,
      rate: 4,
      seconds: 2,
      piece: 0,
      silent: true,
    })
    expect(share(r.drew.slice(30))).toBe(1)
  })

  it('the latest request wins: after a stall it starts over at the keyframe under the clock', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    await piece(el, dec, {
      from: 10,
      rate: 4,
      seconds: 1,
      piece: 0,
      silent: true,
    })
    // The decoder stalls for half a second while the clock runs on, then
    // the clock is found far ahead (a long frame, a tab that slept).
    const walks = dec.walks
    dec.capacity = 0
    await piece(el, dec, {
      from: 14,
      rate: 4,
      seconds: 0.5,
      piece: 0,
      silent: true,
    })
    dec.capacity = 20
    const before = dec.decoded
    const r = await piece(el, dec, {
      from: 60,
      rate: 4,
      seconds: 1,
      piece: 0,
      silent: true,
    })
    // One start-over, and nothing between 16 and 60 was decoded: a second
    // of 4× is 240 frames, and a keyframe is at most 120 before it.
    expect(dec.walks).toBe(walks + 1)
    expect(dec.decoded - before).toBeLessThan(240 + 120 + 30)
    expect(share(r.drew.slice(20))).toBe(1)
  })

  it("a paused frame is the element's: the decoder holds its last picture only while the element seeks to it", async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.1 })
    el.place(10)
    const r = await piece(el, dec, {
      from: 10,
      rate: 8,
      seconds: 2,
      piece: 0,
      silent: true,
    })
    const stop = r.end - 4
    // The viewer pauses: the caller steps the element itself, as an export
    // does, and asks to draw at the paused moment. No follow.
    const draw = () =>
      media.draw(
        el as unknown as HTMLMediaElement,
        c2d,
        null,
        0,
        0,
        1920,
        1080,
        stop,
      )
    el.currentTime = stop
    expect(draw()).toBe(true)
    for (let i = 0; i < 5; i++) wall = el.tick(1 / FPS)
    expect(draw()).toBe(true)
    for (let i = 0; i < 5; i++) wall = el.tick(1 / FPS)
    expect(el.seeking).toBe(false)
    expect(draw()).toBe(false)
    // And it does not come back: a scrub is the element's alone.
    el.currentTime = stop + 1
    expect(draw()).toBe(false)
  })

  it("paused on the very moment last followed, the frame is still the element's", async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.1 })
    el.place(10)
    const r = await piece(el, dec, {
      from: 10,
      rate: 8,
      seconds: 2,
      piece: 0,
      silent: true,
    })
    // The clock stopped between two frames: the paused moment is exactly
    // the one the last playing frame followed, and drew.
    const draw = () =>
      media.draw(
        el as unknown as HTMLMediaElement,
        c2d,
        null,
        0,
        0,
        1920,
        1080,
        r.end,
      )
    // The resting element sits at the piece's end already: nothing to wait for.
    expect(el.seeking).toBe(false)
    expect(draw()).toBe(false)
    expect(draw()).toBe(false)
  })

  it("a file the decoder cannot open is the element's, as before, and is asked once", async () => {
    install({ decoder: null })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    const r = await piece(el, null, {
      from: 10,
      rate: 4,
      seconds: 2,
      piece: 0,
      silent: true,
    })
    await flush()
    await piece(el, null, {
      from: r.end,
      rate: 4,
      seconds: 1,
      piece: 0,
      silent: true,
    })
    expect(opened).toBe(1)
    expect(share(r.drew)).toBe(0)
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(4)
  })

  it("a cut where the element's seek is dear: the decoder covers it, then steps aside", async () => {
    // Safari on footage with sound: most of a second a seek, at plain 1×.
    const dec = makeDecoder({ capacity: 12 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.8 })
    el.place(10)
    // The first cut measures what a seek costs; nothing covers it.
    const a = await piece(el, dec, { from: 30, rate: 1, seconds: 2, piece: 1 })
    expect(share(a.drew)).toBe(0)
    // The second is covered while the element is on its way.
    const b = await piece(el, dec, { from: 60, rate: 1, seconds: 2, piece: 2 })
    const first = b.drew.indexOf(true)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(0.3 * FPS)
    // On the clock while it covers, and gone once the element is back.
    expect(Math.max(...b.off)).toBeLessThan(2.5 / FPS)
    expect(b.drew.slice(-20).some(Boolean)).toBe(false)
    expect(el.pauses).toBe(0)
    // The element was stepped as it always is: a cut, and at most its one
    // re-aim.
    expect(el.steps.filter((s) => s.whileSeeking)).toHaveLength(0)
  })

  it('a decoder that faults is never why an element is not driven', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    await piece(el, dec, {
      from: 10,
      rate: 4,
      seconds: 1,
      piece: 0,
      silent: true,
    })
    expect(el.paused).toBe(true)
    // The file goes bad under it: the next walk throws where it starts.
    dec.sink.samples = () => {
      throw new Error('decode error')
    }
    transport.epoch++
    const r = await piece(el, dec, {
      from: 200,
      rate: 4,
      seconds: 2,
      piece: 1,
      silent: true,
    })
    // The element was stepped to the new place and has played since.
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(4)
    expect(Math.abs(el.position - r.end)).toBeLessThan(4 * 0.3 + 0.5)
    expect(r.drew.slice(10).some(Boolean)).toBe(false)
    expect(dec.live).toBe(0)
  })

  it('an idle walk is let go: no frame is held once the element is the picture', async () => {
    const dec = makeDecoder({ capacity: 20 })
    install({ decoder: dec })
    const el = makeElement({ cost: 0.05 })
    el.place(10)
    const fast = await piece(el, dec, {
      from: 10,
      rate: 4,
      seconds: 1,
      piece: 0,
      silent: true,
    })
    expect(dec.live).toBe(1)
    await piece(el, dec, {
      from: fast.end,
      rate: 1,
      seconds: 4,
      piece: 1,
      silent: true,
    })
    for (const fn of timers) fn()
    expect(dec.live).toBe(0)
  })
})
