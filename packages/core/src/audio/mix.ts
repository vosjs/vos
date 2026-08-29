import type { AudioPlan } from './plan'
import { createPcm, pcmDuration } from './pcm'
import type { PcmBuffer } from './pcm'

export interface MixAudioOptions {
  sampleRate?: number
  channels?: number
}

/** Read one channel of a source at a fractional frame, linear, looping or ended. */
function readSource(data: Float32Array, frame: number, loop: boolean): number {
  const n = data.length
  if (!n) return 0
  let f = frame
  if (loop) {
    f = f % n
    if (f < 0) f += n
  } else if (f < 0 || f >= n) {
    return 0
  }
  const i = Math.floor(f)
  const frac = f - i
  const a = data[i]
  const j = i + 1
  const b = j < n ? data[j] : loop ? data[0] : a
  return a + (b - a) * frac
}

/**
 * Render a plan against decoded sources into one PCM buffer. Pure and
 * sample-exact: every output frame reads each audible track at the position
 * the plan interpolates between its two neighbouring points, scaled by the
 * interpolated gain. Mono sources feed every output channel; a source with
 * more channels than the output is averaged down; fewer are padded with its
 * last channel.
 */
export function mixAudio(
  plan: AudioPlan,
  sources: Map<string, PcmBuffer> | ((src: string) => PcmBuffer | undefined),
  opts: MixAudioOptions = {},
): PcmBuffer {
  const sampleRate = opts.sampleRate ?? 48000
  const channelCount = opts.channels ?? 2
  const length = Math.max(0, Math.round(plan.duration * sampleRate))
  const out = createPcm(sampleRate, length, channelCount)
  const lookup =
    typeof sources === 'function' ? sources : (src: string) => sources.get(src)

  for (const track of plan.tracks) {
    const src = lookup(track.src)
    if (!src || !src.channels.length || !src.length) continue
    const srcDur = pcmDuration(src)
    const srcRate = src.sampleRate
    const srcN = src.channels.length

    // Output channel -> the source channels it reads.
    const reads: Float32Array[][] = []
    for (let c = 0; c < channelCount; c++) {
      if (srcN === 1) reads.push([src.channels[0]])
      else if (srcN <= channelCount)
        reads.push([src.channels[Math.min(c, srcN - 1)]])
      else if (channelCount === 1) reads.push(src.channels)
      else reads.push([src.channels[Math.min(c, srcN - 1)]])
    }

    const pts = track.points
    for (let k = 0; k + 1 < pts.length; k++) {
      const p0 = pts[k]
      if (!p0.on) continue
      const p1 = pts[k + 1]
      const i0 = Math.ceil(p0.t * sampleRate)
      const i1 = Math.min(length, Math.ceil(p1.t * sampleRate))
      if (i1 <= i0) continue
      const span = p1.t - p0.t
      // Between two points the position sweeps linearly — unless the next
      // point is a SEEK: a jump the playback rate could not have covered
      // (a loop wrapping back to its start, a set of currentTime). Then the
      // interval plays on from the first point at native rate and the jump
      // lands at the second, the way an element seeks.
      const seek = Math.abs(p1.pos - p0.pos - span) > Math.max(0.05, span * 8)
      const continuous = p1.on && !seek
      for (let i = i0; i < i1; i++) {
        const t = i / sampleRate
        const u = span > 0 ? (t - p0.t) / span : 0
        const pos = continuous
          ? p0.pos + (p1.pos - p0.pos) * u
          : p0.pos + (t - p0.t)
        const gain = continuous ? p0.gain + (p1.gain - p0.gain) * u : p0.gain
        if (gain <= 0) continue
        if (!track.loop && (pos < 0 || pos >= srcDur)) continue
        const frame = pos * srcRate
        for (let c = 0; c < channelCount; c++) {
          const chans = reads[c]
          let v = 0
          for (const data of chans) v += readSource(data, frame, track.loop)
          out.channels[c][i] += (v / chans.length) * gain
        }
      }
    }
  }
  return out
}
