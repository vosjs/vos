import type { EnvelopePoint } from './audioEnvelope'

/**
 * The studio's audio clips as an ENGINE audio plan:
 * the shape `@vosjs/core/audio`'s `mixAudio` renders. One builder for every
 * export path (the device exporter, the fleet's audio page) from the same
 * lowered data the preview scheduler plays, so what you hear is what exports.
 *
 * A clip is OUTPUT-anchored: it plays from `start` for `len` seconds, reading
 * the source from `in` (looping over `[in, out]` when `loop`), at its gain
 * envelope (`env`, absolute output seconds, fades included) times the duck
 * curve when it ducks. The plan samples that at `step` (240/s, the engine's
 * default); the mixer interpolates between points and treats the loop's
 * wrap as a seek.
 *
 * Structurally typed: the lowered clip, not the doc — this runs on the fleet
 * from stored config data as well as in the studio.
 */
export interface LoweredAudioClip {
  key: string
  start: number
  in: number
  out: number
  gain: number
  loop: boolean
  len: number
  duck: boolean
  env: EnvelopePoint[]
}

export interface AudioPlanPoint {
  t: number
  on: boolean
  pos: number
  gain: number
}

export interface AudioPlanTrack {
  id: string
  src: string
  loop: boolean
  points: AudioPlanPoint[]
}

export interface StudioAudioPlan {
  duration: number
  step: number
  tracks: AudioPlanTrack[]
}

export const AUDIO_PLAN_STEP = 1 / 240

/** Linear interpolation over absolute-time envelope points; `def` outside an empty one. */
export function envelopeAt(
  env: readonly EnvelopePoint[],
  t: number,
  def: number,
): number {
  const n = env.length
  if (!n) return def
  if (t <= env[0].t) return env[0].g
  if (t >= env[n - 1].t) return env[n - 1].g
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (env[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = env[lo]
  const b = env[hi]
  if (b.t <= a.t) return b.g
  return a.g + ((b.g - a.g) * (t - a.t)) / (b.t - a.t)
}

export function studioAudioPlan(
  clips: readonly LoweredAudioClip[],
  duckEnv: readonly EnvelopePoint[],
  duration: number,
  step = AUDIO_PLAN_STEP,
): StudioAudioPlan {
  const count = Math.max(0, Math.ceil(duration / step)) + 1
  const tracks: AudioPlanTrack[] = []
  clips.forEach((clip, i) => {
    const span = clip.out - clip.in
    const len = clip.len > 0 ? clip.len : span
    if (!(span > 0) || !(len > 0) || clip.start >= duration) return
    const end = clip.start + len
    const points: AudioPlanPoint[] = new Array(count)
    for (let k = 0; k < count; k++) {
      const t = k * step
      const on = t >= clip.start && t < end
      const local = Math.max(0, t - clip.start)
      const pos = clip.loop
        ? clip.in + (local % span)
        : clip.in + Math.min(local, span)
      const gain = on
        ? Math.max(
            0,
            envelopeAt(clip.env, t, clip.gain) *
              (clip.duck ? envelopeAt(duckEnv, t, 1) : 1),
          )
        : 0
      points[k] = { t, on, pos, gain }
    }
    // The mixer loops over the WHOLE source; a clip loops over `[in, out]`,
    // which the positions above express themselves (the wrap is a seek).
    tracks.push({ id: `clip${i}`, src: clip.key, loop: false, points })
  })
  return { duration, step, tracks }
}
