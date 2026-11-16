import { afterEach, describe, expect, it } from 'vitest'
import {
  lerpArray,
  mapTime,
  rateAt,
  sample,
  totalDuration,
} from '@vosjs/timeline'
import {
  BASE_FRAME_STYLE,
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
} from '../types'
import { bothFrames, lowerMerged } from './helpers/studio'
import type { OverlayClip, ProjectDoc } from '../types'

/**
 * WHO drives a playing element. With the player document's follower present
 * (`window.__vos__.media`) the footage, the backdrop loop and a video layer
 * each hand it their element and their moment, and assign nothing
 * themselves. Without it each keeps the rule it was compiled with. The
 * paused frame is the program's either way: an export steps to an exact
 * frame and takes nothing from the follower.
 */

interface Call {
  el: unknown
  target: Record<string, unknown>
}

function stubVideo(over: Record<string, unknown> = {}) {
  const v = {
    videoWidth: 1600,
    videoHeight: 900,
    readyState: 2,
    paused: true,
    seeking: false,
    muted: true,
    duration: 10,
    playbackRate: 1,
    preservesPitch: false,
    assigned: [] as Array<number>,
    plays: 0,
    _t: 0,
    get currentTime() {
      return v._t
    },
    set currentTime(x: number) {
      v.assigned.push(x)
      v._t = x
    },
    play() {
      v.plays++
      v.paused = false
      return Promise.resolve()
    },
    pause() {
      v.paused = true
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    ...over,
  }
  return v
}

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 60000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 60 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

const layer = (over: Partial<OverlayClip> = {}): OverlayClip =>
  ({
    id: 'l1',
    kind: 'video',
    key: 'blob:layer',
    start: 1,
    duration: 4,
    transform: { x: 0.5, y: 0.5, scale: 0.4, rotation: 0 },
    ...over,
  }) as OverlayClip

describe('who drives a playing element', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function frame(
    d: ProjectDoc,
    time: number,
    o: {
      follower: boolean
      paused?: boolean
      cache?: Map<string, unknown>
      video?: ReturnType<typeof stubVideo>
      /** The player's follower can supply the picture: what `draw` answers. */
      draw?: boolean
    },
  ) {
    const { config, data } = lowerMerged(d)
    const onFrame = bothFrames(config)
    const calls: Array<Call> = []
    const draws: Array<Array<unknown>> = []
    const images: Array<unknown> = []
    g.window = {
      __vos__: {
        isPaused: !!o.paused,
        videoCache: o.cache ?? new Map<string, unknown>(),
        pendingDecodes: new Set(),
        ...(o.follower
          ? {
              media: {
                v: 1,
                follow: (el: unknown, target: Record<string, unknown>) => {
                  calls.push({ el, target })
                  return true
                },
                ...(o.draw === undefined
                  ? {}
                  : {
                      draw: (...args: Array<unknown>) => {
                        draws.push(args)
                        return o.draw
                      },
                    }),
              },
            }
          : {}),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray, rateAt, totalDuration }
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          if (key === 'drawImage')
            return (img: unknown) => {
              images.push(img)
            }
          return () => {}
        },
        set: () => true,
      },
    )
    const mk = () => ({
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    const video = o.video ?? stubVideo({ duration: 60 })
    const refs = { bg: mk(), card: mk(), ov: mk(), video, cam: null }
    onFrame(
      {
        time,
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
      1 / 60,
    )
    return { calls, video, draws, images, c2d }
  }

  it('the footage: the follower is told the moment, the rate, the piece and its end, and leads', () => {
    const d = doc({
      segments: [
        { in: 0, out: 10 },
        { in: 20, out: 60 },
      ],
      speed: [{ id: 's', in: 20, out: 60, rate: 4 }],
    })
    const { calls, video } = frame(d, 12, { follower: true })
    expect(calls).toHaveLength(1)
    expect(calls[0].el).toBe(video)
    // Output 12 is two seconds into the second piece, at 4×: source 28.
    expect(calls[0].target.at).toBeCloseTo(28, 6)
    expect(calls[0].target).toMatchObject({
      lead: true,
      rate: 4,
      end: 60,
      unlocked: false,
    })
    // And the program touches nothing: no seek, no rate, no play.
    expect(video.assigned).toHaveLength(0)
    expect(video.playbackRate).toBe(1)
    expect(video.plays).toBe(0)
  })

  it('the picture: a player that can supply it is told the card draws through it, and is asked before the element is drawn', () => {
    const d = doc({ speed: [{ id: 's', in: 0, out: 60, rate: 4 }] })
    const video = stubVideo({ duration: 60, __vosSilent: true })
    const { calls, draws, images, c2d } = frame(d, 2, {
      follower: true,
      video,
      draw: true,
    })
    expect(calls[0].target).toMatchObject({ picture: true, silent: true })
    // Asked once, for the card, at the moment the follower was given.
    expect(draws).toHaveLength(1)
    expect(draws[0][0]).toBe(video)
    expect(draws[0][1]).toBe(c2d)
    expect(draws[0].at(-1)).toBe(calls[0].target.at)
    // It drew: the element is not drawn over it.
    expect(images).not.toContain(video)
  })

  it('the picture: the follower is told a fast piece exists, and what piece comes next on the same media', () => {
    const d = doc({
      segments: [
        { in: 0, out: 10 },
        { in: 20, out: 60 },
      ],
      speed: [{ id: 's', in: 20, out: 60, rate: 4 }],
    })
    // Output 9.9: a tenth of a second before the cut into the 4× piece.
    const a = frame(d, 9.9, { follower: true, draw: false }).calls[0].target
    expect(a.warm).toBe(true)
    expect(a.next).toMatchObject({ at: 20, rate: 4 })
    expect((a.next as { in: number }).in).toBeCloseTo(0.1, 6)
    // In the last piece nothing comes next.
    const b = frame(d, 12, { follower: true, draw: false }).calls[0].target
    expect(b.next).toBeNull()
    // A document with nothing fast says so, and a player with no decoder
    // is told neither.
    const plain = frame(doc(), 5, { follower: true, draw: false }).calls[0]
      .target
    expect(plain.warm).toBe(false)
    const old = frame(d, 9.9, { follower: true }).calls[0].target
    expect(old.warm).toBe(false)
    expect(old.next).toBeNull()
  })

  it('the picture: where the player answers no, the element is drawn as it always was', () => {
    const video = stubVideo({ duration: 60 })
    const { calls, draws, images } = frame(doc(), 5, {
      follower: true,
      video,
      draw: false,
    })
    // An element not marked silent is one with sound: it may never rest.
    expect(calls[0].target).toMatchObject({ picture: true, silent: false })
    expect(draws).toHaveLength(1)
    expect(images.filter((i) => i === video)).toHaveLength(1)
  })

  it('the picture: a player with a follower and no decoder is not promised a draw', () => {
    const video = stubVideo({ duration: 60 })
    const { calls, images } = frame(doc(), 5, { follower: true, video })
    expect(calls[0].target.picture).toBe(false)
    expect(images.filter((i) => i === video)).toHaveLength(1)
  })

  it("the picture: a paused frame asks too, so the last picture can stand in while the element seeks, and it is the element's when the answer is no", () => {
    const video = stubVideo({ duration: 60 })
    const { calls, draws, images } = frame(doc(), 5, {
      follower: true,
      paused: true,
      video,
      draw: false,
    })
    expect(calls).toHaveLength(0)
    expect(draws).toHaveLength(1)
    expect(draws[0].at(-1)).toBe(5)
    expect(images.filter((i) => i === video)).toHaveLength(1)
  })

  it('the picture: the document says which media are silent where it loads them', () => {
    const { config } = lowerMerged(doc())
    const setup = JSON.stringify(config)
    expect(setup).toContain('v.__vosSilent = !!muted')
  })

  it('the footage: a cut is a change of piece', () => {
    const d = doc({
      segments: [
        { in: 0, out: 10 },
        { in: 20, out: 60 },
      ],
    })
    const a = frame(d, 5, { follower: true }).calls[0].target.piece
    const b = frame(d, 15, { follower: true }).calls[0].target.piece
    expect(a).not.toBe(b)
  })

  it('the footage: with no follower in the document, the program drives it itself', () => {
    const video = stubVideo({ duration: 60 })
    video._t = 3
    frame(doc(), 5, { follower: false, video })
    expect(video.plays).toBe(1)
    expect(video.assigned).toHaveLength(1)
  })

  it("a paused frame is the program's: the follower is not asked", () => {
    const video = stubVideo({ duration: 60 })
    const { calls } = frame(doc(), 5, { follower: true, paused: true, video })
    expect(calls).toHaveLength(0)
    expect(video.assigned).toEqual([5])
  })

  it('the backdrop loop: the output clock around its wrap, at rate 1', () => {
    const bg = stubVideo({ duration: 4 })
    const d = doc({
      frame: {
        ...BASE_FRAME_STYLE,
        browserBar: DEFAULT_BROWSER_BAR,
        backgroundMedia: { kind: 'video', key: 'bg.webm', duration: 4, dim: 0 },
      },
    })
    const { calls } = frame(d, 9, {
      follower: true,
      cache: new Map<string, unknown>([['bg.webm', bg]]),
    })
    const call = calls.find((c) => c.el === bg)!
    expect(call.target).toMatchObject({ rate: 1, loop: { dur: 4 } })
    expect(call.target.at).toBeCloseTo(1, 6)
    expect(call.target.lead).toBeUndefined()
    expect(bg.assigned).toHaveLength(0)
    expect(bg.plays).toBe(0)
  })

  it('the backdrop loop: a length not known yet is left to play, never stepped to zero', () => {
    const bg = stubVideo({ duration: 0 })
    const d = doc({
      frame: {
        ...BASE_FRAME_STYLE,
        browserBar: DEFAULT_BROWSER_BAR,
        backgroundMedia: { kind: 'video', key: 'bg.webm', duration: 0, dim: 0 },
      },
    })
    const { calls } = frame(d, 9, {
      follower: true,
      cache: new Map<string, unknown>([['bg.webm', bg]]),
    })
    expect(calls.find((c) => c.el === bg)).toBeUndefined()
    expect(bg.plays).toBe(1)
    expect(bg.assigned).toHaveLength(0)
  })

  it('a video layer: clip-local time, to its end', () => {
    const el = stubVideo({ duration: 10 })
    const { calls } = frame(doc({ overlays: [layer()] }), 2.5, {
      follower: true,
      cache: new Map<string, unknown>([['blob:layer', el]]),
    })
    const call = calls.find((c) => c.el === el)!
    expect(call.target.at).toBeCloseTo(1.5, 6)
    expect(call.target).toMatchObject({ rate: 1, piece: 'l1', end: 10 })
    expect(call.target.loop).toBeNull()
    expect(el.assigned).toHaveLength(0)
    expect(el.plays).toBe(0)
  })

  it('a looping video layer is measured around its wrap', () => {
    const el = stubVideo({ duration: 0.4 })
    const { calls } = frame(doc({ overlays: [layer({ loop: true })] }), 2.5, {
      follower: true,
      cache: new Map<string, unknown>([['blob:layer', el]]),
    })
    const call = calls.find((c) => c.el === el)!
    expect(call.target.loop).toEqual({ dur: 0.4 })
    expect(call.target.at).toBeCloseTo(1.5 % 0.4, 6)
  })

  it('a video layer past its own end is held, paused, and the follower is not asked', () => {
    const el = stubVideo({ duration: 1, paused: false })
    const { calls } = frame(doc({ overlays: [layer()] }), 3.5, {
      follower: true,
      cache: new Map<string, unknown>([['blob:layer', el]]),
    })
    expect(calls.find((c) => c.el === el)).toBeUndefined()
    expect(el.paused).toBe(true)
  })
})
