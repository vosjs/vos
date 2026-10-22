import { describe, expect, it } from 'vitest'
import {
  channelWeights,
  createLoudnessMeter,
  crowdedRuns,
  loudnessFromEnergies,
  loudnessWarnings,
  posterWarning,
  sceneChanges,
  sceneWarnings,
  windowCounts,
} from '../videoChecks'

/** Meter `seconds` of a sine (amplitude per channel) at `rate`, in 1024-sample buffers. */
function meterSine(
  amplitudes: number[],
  seconds: number,
  rate = 48_000,
  hz = 997,
) {
  const meter = createLoudnessMeter(rate, amplitudes.length, 0.1)
  const total = Math.round(seconds * rate)
  for (let start = 0; start < total; start += 1024) {
    const n = Math.min(1024, total - start)
    meter.push(
      amplitudes.map((a) => {
        const d = new Float32Array(n)
        for (let i = 0; i < n; i++)
          d[i] = a * Math.sin((2 * Math.PI * hz * (start + i)) / rate)
        return d
      }),
    )
  }
  return meter.finish()
}

describe('BS.1770 loudness', () => {
  it('reads a full-scale 997 Hz sine in one channel at -3.01 LUFS, the standard’s own check', () => {
    const m = meterSine([1, 0], 10)
    const l = loudnessFromEnergies(m.energies, m.peak)
    expect(l.integrated).toBeCloseTo(-3.0, 1)
    expect(l.samplePeakDb).toBeCloseTo(0, 1)
  })

  it('reads a stereo sine of amplitude 0.1 at about -20 LUFS, at 44.1 kHz too', () => {
    for (const rate of [48_000, 44_100]) {
      const m = meterSine([0.1, 0.1], 6, rate)
      const l = loudnessFromEnergies(m.energies, m.peak)
      expect(l.integrated).toBeGreaterThan(-20.2)
      expect(l.integrated).toBeLessThan(-19.8)
      expect(l.shortTerm.map((s) => s.time)).toEqual([0, 3])
      expect(l.samplePeakDb).toBeCloseTo(-20, 1)
    }
  })

  it('gates out silence: a quiet stretch does not pull the integrated value down', () => {
    const loud = meterSine([0.1, 0.1], 4)
    const silence = meterSine([0, 0], 4)
    const energies = loud.energies.map((e, c) => [...e, ...silence.energies[c]])
    const l = loudnessFromEnergies(energies, loud.peak)
    // The blocks across the edge pass the relative gate, as the standard
    // has it, and pull a little; four seconds of silence would pull 3 LU.
    expect(l.integrated).toBeGreaterThan(-20.5)
    expect(l.integrated).toBeLessThan(-19.8)
    expect(l.shortTerm.at(-1)?.loudness).toBeNull()
  })

  it('calls digital silence silent, and names the quiet and the loud', () => {
    const s = meterSine([0, 0], 3)
    const silent = loudnessFromEnergies(s.energies, s.peak)
    expect(silent.integrated).toBeNull()
    expect(silent.samplePeakDb).toBeNull()
    expect(loudnessWarnings(silent)[0]).toMatch(/silent/)
    const quiet = meterSine([0.01, 0.01], 3)
    expect(
      loudnessWarnings(loudnessFromEnergies(quiet.energies, quiet.peak))[0],
    ).toMatch(/below -23: too quiet/)
    const loud = meterSine([0.9, 0.9], 3)
    expect(
      loudnessWarnings(loudnessFromEnergies(loud.energies, loud.peak))[0],
    ).toMatch(/above -9: too loud/)
    const fine = meterSine([0.15, 0.15], 3)
    expect(
      loudnessWarnings(loudnessFromEnergies(fine.energies, fine.peak)),
    ).toEqual([])
  })

  it('runs from its own source text, the way the decode page runs it', () => {
    const make = new Function(`return (${String(createLoudnessMeter)})`)()
    const meter = make(48_000, 1, 0.1)
    meter.push([new Float32Array(4800).fill(0.5)])
    const out = meter.finish()
    expect(out.energies[0]).toHaveLength(1)
    expect(out.peak).toBe(0.5)
  })

  it('weights the surrounds of 5.1 and drops its LFE', () => {
    expect(channelWeights(2)).toEqual([1, 1])
    expect(channelWeights(6)).toEqual([1, 1, 1, 0, 1.41, 1.41])
  })
})

describe('scene changes', () => {
  const times = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
  it('keeps the peak of a run, once', () => {
    expect(
      sceneChanges(times, [0, 0.01, 0.3, 0.2, 0.01, 0.5, 0.02]).map(
        (c) => c.time,
      ),
    ).toEqual([0.2, 0.5])
  })

  it('never counts motion: a stretch where every frame changes about as much is a camera move', () => {
    const ramp = [0, 0.01, 0.06, 0.14, 0.18, 0.2, 0.21, 0.2, 0.18, 0.12, 0.05]
    expect(
      sceneChanges(
        ramp.map((_, i) => i / 30),
        ramp,
      ),
    ).toEqual([])
    // The same move with a cut in the middle of it: the cut still stands out.
    const cut = [...ramp.slice(0, 6), 0.7, ...ramp.slice(6)]
    expect(
      sceneChanges(
        cut.map((_, i) => i / 30),
        cut,
      ).map((c) => c.change),
    ).toEqual([0.7])
  })

  it('counts per 5 s window and finds two cuts closer than 5 s wherever the window starts', () => {
    const cuts = [
      { time: 4.8, change: 0.4 },
      { time: 5.3, change: 0.4 },
      { time: 12, change: 0.4 },
    ]
    expect(windowCounts(cuts, 14)).toEqual([
      { start: 0, count: 1 },
      { start: 5, count: 1 },
      { start: 10, count: 1 },
    ])
    expect(crowdedRuns(cuts).map((r) => r.map((c) => c.time))).toEqual([
      [4.8, 5.3],
    ])
    expect(sceneWarnings(cuts)[0]).toMatch(
      /2 full-frame changes within 5 s \(at 4\.80s, 5\.30s\)/,
    )
  })
})

describe('posters', () => {
  it('calls a flat frame near-uniform and a picture not', () => {
    expect(posterWarning('first', 0.4)).toMatch(/first frame is near-uniform/)
    expect(posterWarning('last', 0.4)).toMatch(/last frame is near-uniform/)
    expect(posterWarning('first', 30)).toBeNull()
  })
})
