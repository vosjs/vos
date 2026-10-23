/**
 * A clip's loudness as a target: the gain the lowering plays it at is
 * derived from `normalize` and the measured `loudness`, may exceed 1, is
 * capped under the peak ceiling, and is ignored (the clip plays at `gain`,
 * byte for byte as before) until the clip is measured for its own key.
 */
import { describe, expect, it } from 'vitest'
import { studioAudioPlan } from '../lower/audioPlan'
import { clipEnvelope } from '../lower/audioEnvelope'
import { clipGain } from '../lower/loudness'
import { lowerToComposition } from '../lower/lowerToComposition'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { AudioClip, ProjectDoc } from '../types'
import type { LoweredAudioClip } from '../lower/audioPlan'

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  id: 'score',
  key: 'music/track.mp3',
  name: 'track',
  start: 0,
  in: 0,
  out: 10,
  duration: 30,
  gain: 0.5,
  fadeIn: 0,
  fadeOut: 0,
  ...over,
})

const measured = (
  lufs: number,
  peakDb: number | null,
  src = 'music/track.mp3',
) => ({
  lufs,
  peakDb,
  at: '2026-10-22T00:00:00.000Z',
  src,
})

function doc(audio: AudioClip[]): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 12_000,
        width: 1280,
        height: 720,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 12 }],
    zoom: [],
    audio,
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const loweredClips = (d: ProjectDoc) =>
  (
    lowerToComposition(d).stack[STUDIO_ENTRY_ID] as {
      audio: LoweredAudioClip[]
    }
  ).audio

describe('clipGain', () => {
  it('is the clip’s own gain, clamped, when there is no target', () => {
    expect(clipGain(clip())).toEqual({ gain: 0.5, basis: 'gain' })
    expect(clipGain(clip({ gain: 1.4 })).gain).toBe(1)
  })

  it('lifts a quiet file to its target, past 1', () => {
    // -28 LUFS to -16 is +12 dB: ×3.98, then the 0.5 trim.
    const g = clipGain(clip({ normalize: -16, loudness: measured(-28, -20) }))
    expect(g.basis).toBe('normalize')
    expect(g.gain).toBeCloseTo(Math.pow(10, 12 / 20) * 0.5, 9)
    expect(g.gain).toBeGreaterThan(1)
    expect(g.capped).toBeUndefined()
  })

  it('brings a loud file down', () => {
    const g = clipGain(
      clip({ normalize: -16, gain: 1, loudness: measured(-10, -0.5) }),
    )
    expect(g.gain).toBeCloseTo(Math.pow(10, -6 / 20), 9)
  })

  it('caps the gain so the sample peak stays under -1 dBFS', () => {
    // +12 dB on a file peaking at -6 dBFS would peak at +6: held to +5 dB.
    const g = clipGain(
      clip({ normalize: -16, gain: 1, loudness: measured(-28, -6) }),
    )
    expect(g.capped).toBe('peak')
    expect(g.gain).toBeCloseTo(Math.pow(10, 5 / 20), 9)
    expect(g.asked).toBeCloseTo(Math.pow(10, 12 / 20), 9)
  })

  it('never lifts more than +24 dB', () => {
    const g = clipGain(
      clip({ normalize: -6, gain: 1, loudness: measured(-60, null) }),
    )
    expect(g.capped).toBe('lift')
    expect(g.gain).toBeCloseTo(Math.pow(10, 24 / 20), 9)
  })

  it('ignores a target with no measurement, or one measured for another file', () => {
    expect(clipGain(clip({ normalize: -16 }))).toEqual({
      gain: 0.5,
      basis: 'unmeasured',
    })
    expect(
      clipGain(
        clip({ normalize: -16, loudness: measured(-28, -20, 'old.mp3') }),
      ),
    ).toEqual({ gain: 0.5, basis: 'stale' })
  })
})

describe('lowering a clip with a loudness target', () => {
  it('a clip without a target lowers byte-identically, measured or not', () => {
    const plain = doc([clip(), clip({ id: 'sfx', key: 'sfx.wav', gain: 0.8 })])
    const before = JSON.stringify(lowerToComposition(plain))
    const withFacts = doc([
      clip({ loudness: measured(-20, -3) }),
      clip({ id: 'sfx', key: 'sfx.wav', gain: 0.8 }),
    ])
    expect(JSON.stringify(lowerToComposition(withFacts))).toBe(before)
    // A target that does not apply (unmeasured, stale) changes nothing.
    const ignored = doc([
      clip({ normalize: -16 }),
      clip({
        id: 'sfx',
        key: 'sfx.wav',
        gain: 0.8,
        normalize: -16,
        loudness: measured(-30, -10, 'another.wav'),
      }),
    ])
    expect(JSON.stringify(lowerToComposition(ignored))).toBe(before)
  })

  it('plays at the derived gain in the preview data and the export plan', () => {
    const c = clip({
      normalize: -16,
      fadeIn: 1,
      fadeOut: 1,
      loudness: measured(-28, -20),
    })
    const want = Math.round(Math.pow(10, 12 / 20) * 0.5 * 1000) / 1000
    const [lowered] = loweredClips(doc([c]))
    expect(lowered.gain).toBe(want)
    expect(lowered.env.map((p) => p.g)).toEqual([0, want, want, 0])
    expect(clipEnvelope(c)[1].g).toBeCloseTo(Math.pow(10, 12 / 20) * 0.5, 9)
    // The export mixer reads the same lowered clip.
    const plan = studioAudioPlan([lowered], [], 10)
    const mid = plan.tracks[0].points.find((p) => p.t >= 5)!
    expect(mid.gain).toBeCloseTo(want, 6)
  })
})
