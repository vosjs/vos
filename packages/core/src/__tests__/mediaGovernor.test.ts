import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MEDIA_FOLLOWER_SRC } from '../runtime/mediaFollower'
import { MEDIA_GOVERNOR_SRC } from '../runtime/mediaGovernor'
import { generateRenderTemplate } from '../runtime/renderTemplate'

/**
 * The governor, RUN. A program stored before there was a follower keeps its
 * footage on the clock the way it always did: every frame, if the element
 * is more than 0.12 source seconds off inside a sped-up piece (0.3 at 1×),
 * it assigns `currentTime`, whether or not a seek is already in flight.
 * That program is played here, unchanged, against a model element whose
 * seeks take time, with the document's governor between them.
 */
const FPS = 60

function makeWorld() {
  // A window with its own HTMLMediaElement, as a document has.
  class Media {
    paused = true
    playbackRate = 1
    seeking = false
    duration = 600
    cost = 0.06
    ceiling = 16
    reached: Array<{ to: number; whileSeeking: boolean }> = []
    private pos = 0
    private target = 0
    private landAt = 0
    private wall = 0
    private listeners: Array<() => void> = []
    get position() {
      return this.pos
    }
    place(x: number) {
      this.pos = x
    }
    tick(dt: number) {
      this.wall += dt
      if (this.seeking) {
        if (this.wall >= this.landAt - 1e-9) {
          this.seeking = false
          this.pos = this.target
          for (const fn of this.listeners) fn()
        }
      } else if (!this.paused) {
        this.pos += Math.min(this.playbackRate, this.ceiling) * dt
      }
      return this.wall
    }
    /** What the element does with an assignment that reaches it. */
    _seek(x: number) {
      this.reached.push({ to: x, whileSeeking: this.seeking })
      this.seeking = true
      this.target = x
      this.landAt = this.wall + this.cost
    }
    _now() {
      return this.seeking ? this.target : this.pos
    }
    addEventListener(type: string, fn: () => void) {
      if (type === 'seeked') this.listeners.push(fn)
    }
  }
  Object.defineProperty(Media.prototype, 'currentTime', {
    configurable: true,
    enumerable: true,
    get(this: Media) {
      return this._now()
    },
    set(this: Media, x: number) {
      this._seek(x)
    },
  })
  return Media
}

describe('the media governor', () => {
  const g = globalThis as Record<string, unknown>
  let wall = 0
  let Media: ReturnType<typeof makeWorld>
  let cache: Map<string, unknown>

  beforeEach(() => {
    wall = 0
    vi.spyOn(performance, 'now').mockImplementation(() => wall * 1000)
    Media = makeWorld()
    cache = new Map()
    g.window = { HTMLMediaElement: Media, __vos__: { videoCache: cache } }
    new Function(MEDIA_GOVERNOR_SRC)()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete g.window
  })

  type El = InstanceType<ReturnType<typeof makeWorld>> & {
    currentTime: number
    __vosGov?: { asked: number; passed: number }
  }
  const media = (key = 'footage') => {
    const el = new Media() as El
    if (key) cache.set(key, el)
    return el
  }
  /**
   * The stored program's rule, as every release before the fix had it: an
   * assignment whenever the element is off by more than `allow`, with no
   * guard for a seek in flight.
   */
  function oldProgram(
    el: El,
    seconds: number,
    o: { rate: number; from: number; allow?: number },
  ) {
    const allow = o.allow ?? (o.rate !== 1 ? 0.12 : 0.3)
    let want = o.from
    let asked = 0
    const off: Array<number> = []
    el.playbackRate = o.rate
    el.paused = false
    for (let i = 0; i < Math.round(seconds * FPS); i++) {
      wall = el.tick(1 / FPS)
      want += o.rate / FPS
      if (Math.abs(el.currentTime - want) > allow) {
        asked++
        el.currentTime = want
      }
      off.push(Math.abs(el.position - want) / o.rate)
    }
    return { asked, off, want }
  }

  it('is installed by the playback document, after the follower, and not on a capture page', () => {
    const html = generateRenderTemplate('', { mode: 'playback' })
    expect(html).toContain('ns.mediaGovernor = { v: 1 };')
    expect(html.indexOf('ns.mediaGovernor =')).toBeGreaterThan(
      html.indexOf('ns.media = { v: 1'),
    )
    expect(
      generateRenderTemplate('export const initVos = async () => ({})', {
        mode: 'capture-thumbnail',
        capture: { width: 320, height: 180, time: 0 },
      } as never),
    ).not.toContain('ns.mediaGovernor =')
  })

  it('the incident: 16× on a decoder that manages 13×. Ungoverned, a seek on every frame, none landing', () => {
    // Without the governor, to see what it is for.
    delete g.window
    const Bare = makeWorld()
    const el = new Bare() as El
    el.ceiling = 13
    el.place(100)
    const r = oldProgram(el, 2, { rate: 16, from: 100 })
    expect(r.asked).toBeGreaterThan(100)
    expect(el.reached.length).toBe(r.asked)
    expect(el.reached.filter((s) => s.whileSeeking).length).toBeGreaterThan(90)
    // The picture is where it stopped: seconds of output behind.
    expect(r.off.at(-1)!).toBeGreaterThan(1)
  })

  it('governed: the program asks as it always did, a few become seeks, and every one lands', () => {
    const el = media()
    el.ceiling = 13
    el.place(100)
    const r = oldProgram(el, 2, { rate: 16, from: 100 })
    expect(r.asked).toBeGreaterThan(20)
    expect(el.__vosGov!.asked).toBe(r.asked)
    expect(el.reached.length).toBeLessThanOrEqual(4)
    expect(el.reached.length).toBe(el.__vosGov!.passed)
    expect(el.reached.filter((s) => s.whileSeeking)).toHaveLength(0)
    // Never further behind than the allowance, the seek that answers it and a frame.
    expect(Math.max(...r.off)).toBeLessThan(0.3 + 0.06 + 2 / FPS)
  })

  it('an element that holds the rate is never touched', () => {
    const el = media()
    el.place(50)
    const r = oldProgram(el, 3, { rate: 4, from: 50 })
    expect(r.asked).toBe(0)
    expect(el.reached).toHaveLength(0)
  })

  it('a cut is told by the size of the jump, even with a seek in flight', () => {
    const el = media()
    el.cost = 0.5
    el.place(10)
    el.paused = false
    wall = el.tick(1 / FPS)
    // A second off: one seek, half a second in flight.
    el.currentTime = 11
    expect(el.reached).toHaveLength(1)
    wall = el.tick(1 / FPS)
    // Near where it is going: dropped.
    el.currentTime = 11.05
    expect(el.reached).toHaveLength(1)
    // Minutes away: the program cut. Re-aimed.
    el.currentTime = 300
    expect(el.reached).toHaveLength(2)
    expect(el.reached[1].whileSeeking).toBe(true)
  })

  it('a seek is aimed ahead by what the last one cost, and never onto the last frames', () => {
    const el = media()
    el.cost = 0.2
    el.playbackRate = 2
    el.place(10)
    el.paused = false
    wall = el.tick(1 / FPS)
    el.currentTime = 20
    // Nothing measured yet: what was asked.
    expect(el.reached[0].to).toBe(20)
    for (let i = 0; i < 20; i++) wall = el.tick(1 / FPS)
    el.currentTime = 40
    // 0.2s at rate 2 is 0.4 source seconds ahead.
    expect(el.reached[1].to).toBeCloseTo(40.4, 1)
    for (let i = 0; i < 20; i++) wall = el.tick(1 / FPS)
    el.duration = 100
    el.currentTime = 99.99
    expect(el.reached[2].to).toBeLessThanOrEqual(99.99)
  })

  it("a paused element is the program's: every assignment passes, exactly", () => {
    const el = media()
    el.paused = true
    for (const x of [1, 1.016, 1.033, 50, 50.016]) el.currentTime = x
    expect(el.reached.map((s) => s.to)).toEqual([1, 1.016, 1.033, 50, 50.016])
    expect(el.__vosGov).toBeUndefined()
  })

  it("an element that is not a take's media is not governed", () => {
    const el = media('')
    el.paused = false
    for (let i = 0; i < 10; i++) el.currentTime = 5 + i * 0.01
    expect(el.reached).toHaveLength(10)
  })

  it('an element with a rule of its own is left to it', () => {
    // A lowering with its inline copy keeps its state under __vosSv.
    const inline = media('a') as El & { __vosSv?: object }
    inline.__vosSv = {}
    inline.paused = false
    for (let i = 0; i < 5; i++) inline.currentTime = 5 + i * 0.01
    expect(inline.reached).toHaveLength(5)
    // And the follower's own steps pass straight through.
    new Function(MEDIA_FOLLOWER_SRC)()
    const followed = media('b')
    followed.paused = false
    followed.place(0)
    const follow = (
      g.window as {
        __vos__: { media: { follow: (el: unknown, t: object) => void } }
      }
    ).__vos__.media.follow
    wall = followed.tick(1 / FPS)
    follow(followed, { at: 10, piece: 0 })
    expect(followed.reached).toHaveLength(1)
    expect(followed.reached[0].to).toBe(10)
    expect(followed.__vosGov).toBeUndefined()
  })

  it('at 1× with a dear seek it settles, where the program alone never did', () => {
    // Safari on footage with sound: most of a second a seek, a second behind.
    const el = media()
    el.cost = 0.85
    el.place(4)
    const r = oldProgram(el, 8, { rate: 1, from: 5 })
    expect(el.reached.length).toBeGreaterThan(0)
    expect(el.reached.length).toBeLessThanOrEqual(3)
    expect(el.reached.filter((s) => s.whileSeeking)).toHaveLength(0)
    expect(Math.max(...r.off.slice(-3 * FPS))).toBeLessThan(0.3 + 2 / FPS)
  })
})
