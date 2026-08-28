import { describe, expect, it } from 'vitest'
import {
  createPcm,
  mixAudio,
  normalizeEnvelope,
  planAudio,
  renderAudio,
  sampleEnvelope,
} from '../audio'
import type { PcmBuffer } from '../audio'
import { compileVosConfig } from '../compiler/compileVosConfig'
import type { VosConfigJson } from '../types/vosConfigJson'

// renderAudio: the sound a program plays, rendered offline from the same
// schedule live playback drives (playing / currentTime / gain through the
// tween sampler), through retime, into plain PCM.

const RATE = 8000

/** A tone at `hz` for `seconds`, amplitude 1, mono. */
function tone(hz: number, seconds: number, amp = 1): PcmBuffer {
  const pcm = createPcm(RATE, Math.round(seconds * RATE), 1)
  const d = pcm.channels[0]
  for (let i = 0; i < d.length; i++)
    d[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE)
  return pcm
}

/** RMS of channel 0 over [from, to) seconds. */
function rms(pcm: PcmBuffer, from: number, to: number): number {
  const d = pcm.channels[0]
  const a = Math.round(from * pcm.sampleRate)
  const b = Math.min(d.length, Math.round(to * pcm.sampleRate))
  let s = 0
  for (let i = a; i < b; i++) s += d[i] * d[i]
  return Math.sqrt(s / Math.max(1, b - a))
}

const SINE_RMS = Math.SQRT1_2

const base = (
  extra: Partial<VosConfigJson>,
  createTimeline: string,
): VosConfigJson => ({
  version: 2,
  duration: 4,
  camera: { preset: 'perspective', fov: 30 },
  elements: [{ id: 'bed', type: 'audio', src: 'bed.wav' } as never],
  createContent: '(ctx) => ({ objects: [], refs: {} })',
  createTimeline,
  ...extra,
})

const sources = new Map([['bed.wav', tone(440, 10)]])

describe('gain envelope', () => {
  it('is linear between points and flat outside, empty is unity', () => {
    const env = normalizeEnvelope([
      [2, 0],
      [1, 1],
    ])
    expect(env).toEqual([
      [1, 1],
      [2, 0],
    ])
    expect(sampleEnvelope(env, 0)).toBe(1)
    expect(sampleEnvelope(env, 1.5)).toBeCloseTo(0.5, 9)
    expect(sampleEnvelope(env, 3)).toBe(0)
    expect(sampleEnvelope([], 3)).toBe(1)
  })
})

describe('planAudio', () => {
  it('is silent until the timeline sets playing, then advances natively from startTime', () => {
    const plan = planAudio(
      base(
        {
          elements: [
            { id: 'bed', type: 'audio', src: 'bed.wav', startTime: 2 } as never,
          ],
        },
        "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); tl.set(ctx.elements.get('bed').props, { playing: true }, 1); tl.to({}, { duration, ease: 'none' }, 0); return tl; }",
      ),
    )
    expect(plan.tracks).toHaveLength(1)
    const at = (t: number) => plan.tracks[0].points[Math.round(t / plan.step)]
    expect(at(0.5).on).toBe(false)
    expect(at(1).on).toBe(true)
    expect(at(1).pos).toBeCloseTo(2, 6)
    expect(at(3).pos).toBeCloseTo(4, 6)
    expect(at(3).gain).toBe(1)
  })

  it('follows an animated currentTime and a gain tween, and multiplies the envelope', () => {
    const plan = planAudio(
      base(
        {
          elements: [
            {
              id: 'bed',
              type: 'audio',
              src: 'bed.wav',
              gainEnvelope: [
                [0, 0.5],
                [4, 0.5],
              ],
            } as never,
          ],
        },
        "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); const p = ctx.elements.get('bed').props; tl.set(p, { playing: true }, 0); tl.fromTo(p, { currentTime: 5 }, { currentTime: 9, duration: 4, ease: 'none' }, 0); tl.to(p, { gain: 0, duration: 2, ease: 'none' }, 2); return tl; }",
      ),
    )
    const at = (t: number) => plan.tracks[0].points[Math.round(t / plan.step)]
    expect(at(1).pos).toBeCloseTo(6, 6)
    expect(at(1).gain).toBeCloseTo(0.5, 6)
    expect(at(3).gain).toBeCloseTo(0.25, 6)
    expect(at(4).gain).toBeCloseTo(0, 6)
  })

  it('samples the program through retime', () => {
    const plan = planAudio(
      base(
        { data: { rate: 0.5 }, retime: '(t, data) => t * data.rate' },
        "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); const p = ctx.elements.get('bed').props; tl.set(p, { playing: true }, 1); tl.to({}, { duration, ease: 'none' }, 0); return tl; }",
      ),
    )
    const at = (t: number) => plan.tracks[0].points[Math.round(t / plan.step)]
    // playing flips at program time 1 = output time 2.
    expect(at(1.9).on).toBe(false)
    expect(at(2).on).toBe(true)
  })

  it('has no tracks without audio elements', () => {
    expect(
      planAudio(base({ elements: [] }, '(ctx) => ctx.gsap.timeline()')).tracks,
    ).toEqual([])
  })
})

describe('mixAudio + renderAudio', () => {
  const fadeConfig = base(
    {},
    "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); const p = ctx.elements.get('bed').props; tl.set(p, { playing: true }, 1); tl.to(p, { gain: 0, duration: 2, ease: 'none' }, 2); tl.to({}, { duration, ease: 'none' }, 0); return tl; }",
  )

  it('renders a tone with the fade the timeline plays', async () => {
    const out = await renderAudio(fadeConfig, {
      sampleRate: RATE,
      channels: 2,
      decode: async (src) => sources.get(src) ?? null,
    })
    expect(out.length).toBe(4 * RATE)
    expect(out.channels).toHaveLength(2)
    expect(rms(out, 0, 1)).toBe(0) // before playing
    expect(rms(out, 1, 2)).toBeCloseTo(SINE_RMS, 2) // full gain
    // Linear fade 1 → 0 over [2, 4): the RMS of a linearly fading sine over
    // the whole ramp is 1/√3 of the steady value.
    expect(rms(out, 2, 4)).toBeCloseTo(SINE_RMS / Math.sqrt(3), 2)
    expect(rms(out, 3.9, 4)).toBeLessThan(0.05)
  })

  it('the envelope and an animated gain compose multiplicatively', async () => {
    const cfg = {
      ...fadeConfig,
      elements: [
        {
          id: 'bed',
          type: 'audio',
          src: 'bed.wav',
          gainEnvelope: [
            [0, 0.5],
            [4, 0.5],
          ],
        } as never,
      ],
    }
    const out = await renderAudio(cfg, {
      sampleRate: RATE,
      decode: async () => tone(440, 10),
    })
    expect(rms(out, 1, 2)).toBeCloseTo(SINE_RMS * 0.5, 2)
    expect(rms(out, 2, 4)).toBeCloseTo((SINE_RMS * 0.5) / Math.sqrt(3), 2)
  })

  it('loops a short source and ends a long-enough one', () => {
    const plan = planAudio(
      base(
        {
          elements: [
            { id: 'bed', type: 'audio', src: 'bed.wav', loop: true } as never,
          ],
        },
        "(ctx) => { const tl = ctx.gsap.timeline(); tl.set(ctx.elements.get('bed').props, { playing: true }, 0); tl.to({}, { duration: 4, ease: 'none' }, 0); return tl; }",
      ),
    )
    const looped = mixAudio(plan, new Map([['bed.wav', tone(440, 1)]]), {
      sampleRate: RATE,
      channels: 1,
    })
    expect(rms(looped, 3, 4)).toBeCloseTo(SINE_RMS, 2)
    plan.tracks[0].loop = false
    const ended = mixAudio(plan, new Map([['bed.wav', tone(440, 1)]]), {
      sampleRate: RATE,
      channels: 1,
    })
    expect(rms(ended, 0, 1)).toBeCloseTo(SINE_RMS, 2)
    expect(rms(ended, 1.01, 4)).toBe(0)
  })

  it('a source that fails to decode leaves its track silent, never the render', async () => {
    const out = await renderAudio(fadeConfig, {
      sampleRate: RATE,
      decode: async () => null,
    })
    expect(rms(out, 0, 4)).toBe(0)
  })
})

describe('the live half', () => {
  it('a program with elements publishes outputTime and runs frame callbacks; one without stays as it was', () => {
    const withEl = compileVosConfig(fadeConfigFor())
    expect(withEl).toContain(
      'window.__vos__.frameCallbacks = window.__vos__.frameCallbacks || new Set();',
    )
    expect(withEl).toContain(
      'window.__vos__.frameCallbacks.forEach(cb => cb(currentOutputTime));',
    )
    const without = compileVosConfig({ ...fadeConfigFor(), elements: [] })
    expect(without).not.toContain('frameCallbacks.forEach')
  })
})

function fadeConfigFor(): VosConfigJson {
  return base(
    {},
    '(ctx) => { const tl = ctx.gsap.timeline(); tl.to({}, { duration: 4 }, 0); return tl; }',
  )
}
