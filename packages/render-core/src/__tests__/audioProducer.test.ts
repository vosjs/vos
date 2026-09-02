import { describe, expect, it } from 'vitest'
import {
  CORE_AUDIO_CDN_URL,
  audioProducerCode,
  dataHasAudio,
  studioEntryData,
} from '../audioProducer'
import type { AudioPlanJson } from '../audioProducer'

const plan: AudioPlanJson = {
  duration: 1,
  step: 0.5,
  tracks: [
    {
      id: 'clip0',
      src: 'tone.wav',
      loop: false,
      points: [
        { t: 0, on: true, pos: 0, gain: 1 },
        { t: 0.5, on: true, pos: 0.5, gain: 1 },
        { t: 1, on: false, pos: 1, gain: 0 },
      ],
    },
  ],
}

describe('studioEntryData', () => {
  it('reads the stored config stack array by entry id', () => {
    const data = { audio: [{ key: 'a' }] }
    expect(
      studioEntryData([
        { id: 'other', data: {} },
        { id: 'vosso.studio', data },
      ]),
    ).toBe(data)
  })

  it('reads the lowered record keyed by entry id', () => {
    const data = { audio: [] }
    expect(studioEntryData({ 'vosso.studio': data })).toBe(data)
  })

  it('null when absent or malformed', () => {
    expect(studioEntryData(undefined)).toBeNull()
    expect(studioEntryData(null)).toBeNull()
    expect(studioEntryData([])).toBeNull()
    expect(studioEntryData([{ id: 'vosso.studio' }])).toBeNull()
    expect(studioEntryData({})).toBeNull()
    expect(studioEntryData('nope')).toBeNull()
  })
})

describe('dataHasAudio', () => {
  it('true for mic audio (hasAudio + videoSrc)', () => {
    expect(dataHasAudio({ hasAudio: true, videoSrc: 'rec.webm' })).toBe(true)
    expect(dataHasAudio({ micSrc: 'mic.webm' })).toBe(true)
  })

  it('true for music/SFX clips on the studio stack entry, in either shape', () => {
    expect(
      dataHasAudio({}, [
        { id: 'vosso.studio', data: { audio: [{ key: 'tone.wav' }] } },
      ]),
    ).toBe(true)
    expect(
      dataHasAudio({}, { 'vosso.studio': { audio: [{ key: 'tone.wav' }] } }),
    ).toBe(true)
    expect(dataHasAudio(null, { 'vosso.studio': { audio: [{}] } })).toBe(true)
  })

  it('true for a built plan with tracks', () => {
    expect(dataHasAudio({}, undefined, plan)).toBe(true)
    expect(dataHasAudio({}, undefined, { ...plan, tracks: [] })).toBe(false)
  })

  it('false for silent takes and non-take data', () => {
    expect(dataHasAudio(null)).toBe(false)
    expect(dataHasAudio(undefined)).toBe(false)
    expect(dataHasAudio({})).toBe(false)
    expect(dataHasAudio({ hasAudio: true })).toBe(false) // no videoSrc
    expect(dataHasAudio({ videoSrc: 'rec.webm' })).toBe(false) // no hasAudio
    expect(dataHasAudio({}, { 'vosso.studio': { audio: [] } })).toBe(false)
    expect(dataHasAudio({}, [{ id: 'vosso.studio', data: {} }])).toBe(false)
    // Clips on the ROOT data are not read any more: they moved.
    expect(dataHasAudio({ audio: [{ key: 'tone.wav' }] })).toBe(false)
    expect(dataHasAudio('nope')).toBe(false)
  })
})

describe('audioProducerCode', () => {
  it('defines the engine producer contract and mirrors the client mixer surface', () => {
    const code = audioProducerCode()
    expect(code).toContain('window.__vosAudioProducer__')
    expect(code).toContain('({ data, plan, duration, sampleRate })')
    // The load-bearing schema fields the client mixer reads — a rename there
    // must break this test so the mirror gets updated.
    for (const field of [
      'videoSrc',
      'hasAudio',
      'segments',
      'micGain',
      'sysGain',
      'OfflineAudioContext',
    ]) {
      expect(code).toContain(field)
    }
    // The per-clip Web Audio graph is gone: the plan renders through the
    // engine's mixer, imported from the pinned CDN build.
    expect(code).not.toContain('loopStart')
    expect(code).not.toContain('duckEnv')
    expect(code).toContain('mixAudio(audioPlan, clipPcm')
    expect(code).toContain(JSON.stringify(CORE_AUDIO_CDN_URL))
    expect(CORE_AUDIO_CDN_URL).toMatch(
      /^https:\/\/esm\.sh\/@vosjs\/core@\d+\.\d+\.\d+\/audio\?target=es2022$/,
    )
  })

  it('bakes a plan for callers that cannot pass one, and reads a passed one first', () => {
    expect(audioProducerCode()).not.toContain('window.__vosAudioPlan__ =')
    const code = audioProducerCode({ plan })
    expect(code).toContain(`window.__vosAudioPlan__ = ${JSON.stringify(plan)};`)
    expect(code).toContain(
      'plan === undefined ? window.__vosAudioPlan__ : plan',
    )
  })

  it('takes a mixer URL override', () => {
    expect(
      audioProducerCode({ coreAudioUrl: 'http://localhost/audio.js' }),
    ).toContain('"http://localhost/audio.js"')
  })

  it('bounds the voice-only fast path to the requested duration', () => {
    // The fast path may return the spliced buffer directly ONLY when it fits
    // the requested output duration; an overlong take must fall through to
    // the OfflineAudioContext render, whose length IS the duration. Guard the
    // guard: the length check must sit in the fast-path condition.
    const code = audioProducerCode()
    expect(code).toMatch(
      /mic\.length <= Math\.ceil\(duration \* mic\.sampleRate\)/,
    )
  })

  it('prefers the host page stream-splice seam with whole-file fallback', () => {
    const code = audioProducerCode()
    expect(code).toContain('window.__vosStreamSplice__')
    // Fallback must survive: a stream-splice failure degrades to the
    // decodeAudioData path, never to a lost mix.
    expect(code).toContain('decodeAudio')
    expect(code).toContain('spliceAudio')
  })
})
