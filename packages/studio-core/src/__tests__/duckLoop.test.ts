import { describe, expect, it } from 'vitest'
import { clipEnvelope } from '../lower/audioEnvelope'
import { DEFAULT_DUCK, computeMicRms, duckCurve } from '../lower/duckCurve'
import { audioLane } from '../timeline/lanes'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  clipLength,
} from '../types'
import type { AudioClip, ProjectDoc } from '../types'

const loopClip: AudioClip = {
  id: 'a1',
  key: 'blob:beat',
  name: 'beat',
  start: 1,
  in: 0,
  out: 4, // 4s span
  duration: 4,
  gain: 1,
  fadeIn: 0,
  fadeOut: 2,
  loop: true,
  loopLen: 10, // placed for 10s
}

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
        hasAudio: true,
      },
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

describe('loop clips', () => {
  it('clipLength uses the placed loop length', () => {
    expect(clipLength(loopClip)).toBe(10)
    expect(clipLength({ ...loopClip, loop: false })).toBe(4)
    expect(clipLength({ ...loopClip, loopLen: 2 })).toBe(4) // never below the span
  })

  it('fades span the placed length', () => {
    const env = clipEnvelope(loopClip)
    expect(env).toEqual([
      { t: 1, g: 1 },
      { t: 9, g: 1 },
      { t: 11, g: 0 }, // fade-out over the last 2s of the 10s run
    ])
  })

  it('end-edge resize sets the placed length, unclamped by the file', () => {
    const doc = makeDoc([loopClip])
    const d = structuredClone(doc)
    audioLane.gesture(doc, { type: 'resize', id: 'a1', edge: 'end', t: 16 })!(d)
    expect(d.audio[0].loopLen).toBe(15)
    expect(d.audio[0].out).toBe(4) // source span untouched
  })

  it('start-edge resize keeps the end fixed by shrinking the placed length', () => {
    const doc = makeDoc([loopClip])
    const d = structuredClone(doc)
    audioLane.gesture(doc, { type: 'resize', id: 'a1', edge: 'start', t: 3 })!(
      d,
    )
    expect(d.audio[0].start).toBe(3)
    expect(d.audio[0].loopLen).toBe(8) // end stays at 11
    expect(d.audio[0].in).toBe(0)
  })
})

describe('auto-duck curve', () => {
  it('computeMicRms windows PCM into per-window loudness', () => {
    const rate = 1000
    // 1s: first half silent, second half loud
    const pcm = new Float32Array(rate)
    pcm.fill(0.5, rate / 2)
    const rms = computeMicRms([pcm], rate, 0.1)
    expect(rms.rate).toBe(10)
    expect(rms.values.length).toBe(10)
    expect(rms.values[0]).toBe(0)
    expect(rms.values[9]).toBeCloseTo(0.5, 3)
  })

  it('ducks during speech and recovers after', () => {
    // 4s source: speech only in [1..2)s
    const rms = { values: new Float32Array(40), rate: 10 }
    rms.values.fill(0.3, 10, 20)
    const env = duckCurve(rms, [{ in: 0, out: 4 }], 4)
    const at = (t: number) => {
      let g = 1
      for (const p of env) if (p.t <= t) g = p.g
      return g
    }
    expect(at(0.5)).toBe(1) // before speech
    expect(at(1.9)).toBeLessThan(DEFAULT_DUCK.duckTo + 0.1) // ducked during speech
    expect(at(4)).toBeGreaterThan(0.9) // recovered by the end
    // attack is faster than release: gain at speech-start+attack is already low
    expect(at(1 + DEFAULT_DUCK.attack + 0.1)).toBeLessThan(0.5)
  })

  it('maps through trims (output time → source time)', () => {
    // speech lives at source [10..12); the kept cut starts at source 9
    const rms = { values: new Float32Array(200), rate: 10 }
    rms.values.fill(0.3, 100, 120)
    const env = duckCurve(rms, [{ in: 9, out: 14 }], 5)
    const at = (t: number) => {
      let g = 1
      for (const p of env) if (p.t <= t) g = p.g
      return g
    }
    expect(at(0.4)).toBe(1) // output 0.4 → source 9.4, silent
    expect(at(2.5)).toBeLessThan(0.4) // output 2.5 → source 11.5, speech
    expect(at(4.9)).toBeGreaterThan(0.85) // recovered
  })

  it('is empty without loudness data', () => {
    expect(
      duckCurve(
        { values: new Float32Array(0), rate: 10 },
        [{ in: 0, out: 4 }],
        4,
      ),
    ).toEqual([])
  })
})
