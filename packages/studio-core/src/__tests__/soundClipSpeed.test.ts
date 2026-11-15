import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { bothFrames, lowerMerged } from './helpers/studio'
import type { AudioClip, ProjectDoc } from '../types'

/**
 * A take's sound clips (music, effects) at THE PLAYER'S SPEED. They are
 * Web Audio buffer sources scheduled on the audio clock, which runs in wall
 * seconds whatever the player does. At speed 2 the output clock runs two
 * seconds a wall second: scheduled as if it ran one, every clip drifts 80ms
 * in a tenth of a second and is killed and started again, four times a
 * second, at the wrong pitch for the picture. They play tape-style at the
 * speed instead, scheduled once.
 *
 * The audio graph here is a fake with a clock that advances with the wall:
 * what is asserted is every source that was started (when, from where, for
 * how long, at what rate) and every gain ramp.
 */
const FPS = 60

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: 'a1',
  key: 'blob:music',
  name: 'music',
  start: 2,
  in: 0,
  out: 10,
  duration: 30,
  gain: 0.8,
  fadeIn: 1,
  fadeOut: 2,
  ...over,
})

function doc(audio: Array<AudioClip>): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 40_000,
        width: 1600,
        height: 900,
        fps: 30,
      },
      sourceKind: 'image',
    },
    segments: [{ in: 0, out: 40 }],
    zoom: [],
    audio,
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

interface Started {
  when: number
  offset: number
  dur: number
  rate: number
  loop: boolean
  loopStart: number
  loopEnd: number
}

describe("a take's sound clips at the player's speed", () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function session(audio: Array<AudioClip>, o: { transport?: boolean } = {}) {
    const { config, data } = lowerMerged(doc(audio))
    const onFrame = bothFrames(config)
    const started: Array<Started> = []
    const ramps: Array<{ g: number; t: number }> = []
    let stops = 0
    const actx = {
      currentTime: 100,
      state: 'running',
      resume: () => undefined,
      destination: {},
      createBufferSource: () => {
        const src = {
          buffer: null as unknown,
          loop: false,
          loopStart: 0,
          loopEnd: 0,
          playbackRate: { value: 1 },
          connect: () => undefined,
          disconnect: () => undefined,
          start: (when: number, offset: number, dur: number) =>
            started.push({
              when,
              offset,
              dur,
              rate: src.playbackRate.value,
              loop: src.loop,
              loopStart: src.loopStart,
              loopEnd: src.loopEnd,
            }),
          stop: () => void stops++,
        }
        return src
      },
      createGain: () => ({
        connect: () => undefined,
        disconnect: () => undefined,
        gain: {
          setValueAtTime: (gv: number, t: number) => ramps.push({ g: gv, t }),
          linearRampToValueAtTime: (gv: number, t: number) =>
            ramps.push({ g: gv, t }),
        },
      }),
    }
    const transport = { playing: true, speed: 1, epoch: 0, time: 0 }
    const vos: Record<string, unknown> = {
      isPaused: false,
      audioCtx: actx,
      audioBuffers: new Map(audio.map((a) => [a.key, { duration: 30 }])),
      audioPending: new Set(),
      ...(o.transport === false ? {} : { transport }),
    }
    g.window = { __vos__: vos }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 10 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return () => undefined
        },
        set: () => true,
      },
    )
    const content = {
      refs: {
        c2d,
        canvas: { width: 1920, height: 1080 },
        texture: { needsUpdate: false, dispose: () => undefined },
        video: { naturalWidth: 1600, naturalHeight: 900 },
        cam: null,
      },
    }
    let t = 0
    const frame = () =>
      onFrame(
        {
          time: t,
          data,
          renderer: undefined,
          resolution: { width: 1920, height: 1080 },
        },
        content,
        1 / FPS,
      )
    return {
      started,
      ramps,
      stops: () => stops,
      actx,
      transport,
      /** Put the playhead somewhere, as a seek does. */
      seek(to: number) {
        t = to
      },
      /** Play for `seconds` of WALL time at the transport's speed. */
      play(seconds: number) {
        for (let i = 0; i < Math.round(seconds * FPS); i++) {
          frame()
          actx.currentTime += 1 / FPS
          t += transport.speed / FPS
        }
      },
      time: () => t,
    }
  }

  it('at speed 1 every call is the one it always was, with a transport or without', () => {
    const run = (transport: boolean) => {
      const s = session(
        [clip(), clip({ id: 'a2', key: 'blob:fx', start: 6 })],
        {
          transport,
        },
      )
      s.seek(3)
      s.play(4)
      return { started: s.started, ramps: s.ramps, stops: s.stops() }
    }
    const without = run(false)
    const withOne = run(true)
    expect(withOne).toEqual(without)
    // One source a clip, at the buffer's own rate, never restarted.
    expect(without.started).toHaveLength(2)
    expect(without.started.every((x) => x.rate === 1)).toBe(true)
    expect(without.started[0]).toMatchObject({ when: 100, offset: 1, dur: 9 })
  })

  it('at speed 2 a clip is scheduled once, at double rate', () => {
    const s = session([clip()])
    s.transport.speed = 2
    s.seek(3)
    s.play(3)
    // Three wall seconds at speed 2 is six output seconds, 3 to 9, all
    // inside the clip (2 to 12): one source, never killed.
    expect(s.started).toHaveLength(1)
    expect(s.stops()).toBe(0)
    // Where it starts and how much of it plays are seconds of the BUFFER.
    expect(s.started[0]).toMatchObject({
      when: 100,
      offset: 1,
      dur: 9,
      rate: 2,
    })
  })

  it('its fades land where the picture is: output seconds become half as many wall seconds', () => {
    const s = session([clip()])
    s.transport.speed = 2
    s.seek(3)
    s.play(0.1)
    // The fade out runs output 10 to 12: seven and nine output seconds
    // ahead, so 3.5 and 4.5 seconds on the audio clock.
    expect(s.ramps.some((r) => Math.abs(r.t - 103.5) < 1e-9)).toBe(true)
    expect(s.ramps.some((r) => r.g === 0 && Math.abs(r.t - 104.5) < 1e-9)).toBe(
      true,
    )
  })

  it('a clip still to come starts when the playhead will reach it', () => {
    const s = session([clip()])
    s.transport.speed = 2
    s.seek(0)
    s.play(0.1)
    // Two output seconds ahead is one wall second.
    expect(s.started).toHaveLength(1)
    expect(s.started[0]).toMatchObject({
      when: 101,
      offset: 0,
      dur: 10,
      rate: 2,
    })
  })

  it('a change of speed is one reschedule, from where the playhead is', () => {
    const s = session([clip()])
    s.seek(3)
    s.play(1)
    expect(s.started).toHaveLength(1)
    s.transport.speed = 2
    s.play(2)
    // Once when it started, once at the change: never a third.
    expect(s.started).toHaveLength(2)
    expect(s.started[1].rate).toBe(2)
    // The playhead was at output 4: two seconds into the clip.
    expect(s.started[1].offset).toBeCloseTo(2, 6)
    expect(s.started[1].dur).toBeCloseTo(8, 6)
    s.transport.speed = 1
    s.play(1)
    expect(s.started).toHaveLength(3)
    expect(s.started[2].rate).toBe(1)
  })

  it('half speed: half rate, and its fades take twice as long', () => {
    const s = session([clip()])
    s.transport.speed = 0.5
    s.seek(9)
    s.play(2)
    expect(s.started).toHaveLength(1)
    expect(s.started[0]).toMatchObject({ offset: 7, dur: 3, rate: 0.5 })
    // The fade out starts one output second ahead: two wall seconds.
    expect(s.ramps.some((r) => Math.abs(r.t - 102) < 1e-9)).toBe(true)
  })

  it('a looping clip keeps its loop, in seconds of the buffer', () => {
    const s = session([
      clip({ in: 1, out: 3, loop: true, loopLen: 20, fadeIn: 0, fadeOut: 0 }),
    ])
    s.transport.speed = 2
    s.seek(7)
    s.play(2)
    expect(s.started).toHaveLength(1)
    expect(s.started[0]).toMatchObject({
      loop: true,
      loopStart: 1,
      loopEnd: 3,
      rate: 2,
    })
    // Five output seconds into a two second loop: one second into it.
    expect(s.started[0].offset).toBeCloseTo(2, 6)
  })

  it('a seek while playing is one reschedule, at the speed', () => {
    const s = session([clip({ out: 30, duration: 60 })])
    s.transport.speed = 2
    s.seek(3)
    s.play(1)
    expect(s.started).toHaveLength(1)
    s.seek(20)
    s.play(1)
    expect(s.started).toHaveLength(2)
    expect(s.started[1].rate).toBe(2)
    expect(s.started[1].offset).toBeCloseTo(18, 6)
  })

  it('a pause kills what plays, and playing again schedules once at the speed', () => {
    const s = session([clip()])
    s.transport.speed = 2
    s.seek(3)
    s.play(1)
    ;(g.window as { __vos__: { isPaused: boolean } }).__vos__.isPaused = true
    s.play(0.2)
    expect(s.stops()).toBeGreaterThan(0)
    const paused = s.started.length
    ;(g.window as { __vos__: { isPaused: boolean } }).__vos__.isPaused = false
    s.play(1)
    expect(s.started).toHaveLength(paused + 1)
    expect(s.started.at(-1)!.rate).toBe(2)
  })
})
