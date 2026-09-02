import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { clipEnvelope, envelopeValueAt } from '../lower/audioEnvelope'
import { audioLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { bothFrames, lowerMerged as lowerToComposition } from './helpers/studio'
import type { AudioClip, ProjectDoc } from '../types'

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

function makeDoc(audio: AudioClip[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:v',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 20_000,
        width: 1600,
        height: 900,
        fps: 30,
      },
      sourceKind: 'image',
    },
    segments: [{ in: 0, out: 20 }],
    zoom: [],
    audio,
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('clipEnvelope', () => {
  it('builds attack/hold/release points in output time', () => {
    expect(clipEnvelope(clip())).toEqual([
      { t: 2, g: 0 },
      { t: 3, g: 0.8 },
      { t: 10, g: 0.8 },
      { t: 12, g: 0 },
    ])
  })

  it('is a constant plateau without fades', () => {
    expect(clipEnvelope(clip({ fadeIn: 0, fadeOut: 0 }))).toEqual([
      { t: 2, g: 0.8 },
      { t: 12, g: 0.8 },
    ])
  })

  it('scales fades that together exceed the span so they meet', () => {
    // span 2s, fades 3s+1s → scaled to 1.5s+0.5s
    const env = clipEnvelope(clip({ out: 2, fadeIn: 3, fadeOut: 1 }))
    expect(env).toEqual([
      { t: 2, g: 0 },
      { t: 3.5, g: 0.8 },
      { t: 4, g: 0 },
    ])
  })

  it('interpolates linearly and is 0 outside the clip', () => {
    const env = clipEnvelope(clip())
    expect(envelopeValueAt(env, 1.9)).toBe(0)
    expect(envelopeValueAt(env, 2.5)).toBeCloseTo(0.4)
    expect(envelopeValueAt(env, 5)).toBeCloseTo(0.8)
    expect(envelopeValueAt(env, 11)).toBeCloseTo(0.4)
    expect(envelopeValueAt(env, 12.1)).toBe(0)
  })
})

describe('lowering audio clips', () => {
  it('bakes clips + envelopes into ctx.data.audio', () => {
    const { data } = lowerToComposition(makeDoc([clip()]))
    const audio = data.audio as {
      key: string
      start: number
      env: { t: number; g: number }[]
    }[]
    expect(audio).toHaveLength(1)
    expect(audio[0].key).toBe('blob:music')
    expect(audio[0].start).toBe(2)
    expect(audio[0].env).toEqual(clipEnvelope(clip()))
  })
})

describe('audioLane', () => {
  const doc = makeDoc([clip()])

  it('projects clips output-anchored', () => {
    expect(audioLane.items(doc)).toEqual([
      { id: 'a1', kind: 'clip', t: 2, duration: 10, label: 'music' },
    ])
  })

  it('move retimes start (clamped at 0)', () => {
    const d = structuredClone(doc)
    audioLane.gesture(doc, { type: 'move', id: 'a1', t: -3 })!(d)
    expect(d.audio[0].start).toBe(0)
  })

  it('start-edge resize trims into the source and keeps the tail put', () => {
    const d = structuredClone(doc)
    // drag head right by 1s: in 0→1, start 2→3; clip end stays at 12
    audioLane.gesture(doc, { type: 'resize', id: 'a1', edge: 'start', t: 3 })!(
      d,
    )
    expect(d.audio[0].in).toBe(1)
    expect(d.audio[0].start).toBe(3)
    // head can't be restored past the file start
    const d2 = structuredClone(doc)
    audioLane.gesture(doc, { type: 'resize', id: 'a1', edge: 'start', t: -5 })!(
      d2,
    )
    expect(d2.audio[0].in).toBe(0)
    expect(d2.audio[0].start).toBe(2)
  })

  it('end-edge resize clamps to the source duration', () => {
    const d = structuredClone(doc)
    audioLane.gesture(doc, { type: 'resize', id: 'a1', edge: 'end', t: 50 })!(d)
    expect(d.audio[0].out).toBe(30) // duration ceiling
  })

  it('remove deletes by id', () => {
    const d = structuredClone(doc)
    audioLane.gesture(doc, { type: 'remove', id: 'a1' })!(d)
    expect(d.audio).toHaveLength(0)
  })
})

describe('ON_FRAME audio scheduler smoke run', () => {
  const g = globalThis as Record<string, unknown>

  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function fakeAudioGraph() {
    const started: { when: number; offset: number; dur: number }[] = []
    const stopped: number[] = []
    const ramps: { g: number; t: number }[] = []
    const actx = {
      currentTime: 100, // arbitrary audio-clock origin
      state: 'running',
      resume: () => undefined,
      destination: {},
      createBufferSource: () => ({
        buffer: null as unknown,
        connect: () => undefined,
        disconnect: () => undefined,
        start: (when: number, offset: number, dur: number) =>
          started.push({ when, offset, dur }),
        stop: () => stopped.push(1),
      }),
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
    return { actx, started, stopped, ramps }
  }

  function runFrames(times: number[], pausedByFrame: boolean[]) {
    const { config, data } = lowerToComposition(makeDoc([clip()]))

    const onFrame = bothFrames(config)
    const graph = fakeAudioGraph()
    const vos = {
      isPaused: true,
      audioCtx: graph.actx,
      audioBuffers: new Map([['blob:music', { duration: 30 }]]),
      audioPending: new Set(),
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
    times.forEach((t, i) => {
      vos.isPaused = pausedByFrame[i]
      onFrame(
        {
          time: t,
          data,
          renderer: undefined,
          resolution: { width: 1920, height: 1080 },
        },
        content,
        1 / 30,
      )
    })
    return graph
  }

  it('schedules the clip on play with offset/duration and envelope ramps', () => {
    const { started, ramps } = runFrames([5], [false]) // playing at t=5, clip spans 2..12
    expect(started).toHaveLength(1)
    expect(started[0].when).toBe(100) // already inside the clip → start now
    expect(started[0].offset).toBe(3) // in(0) + (t - start) = 3s into the file
    expect(started[0].dur).toBe(7) // remaining span
    // initial value at t=5 (plateau 0.8) + remaining fade-out ramp points
    expect(ramps[0].g).toBeCloseTo(0.8)
    expect(ramps.some((r) => r.g === 0 && r.t === 100 + (12 - 5))).toBe(true)
  })

  it('kills nodes on pause and does not reschedule while paused', () => {
    const { started, stopped } = runFrames([5, 5.1, 5.2], [false, true, true])
    expect(started).toHaveLength(1)
    expect(stopped.length).toBeGreaterThan(0)
  })

  it('does not schedule a clip that already ended', () => {
    const { started } = runFrames([15], [false]) // clip ends at 12
    expect(started).toHaveLength(0)
  })
})
