/**
 * Gain envelope for an audio clip, in OUTPUT-timeline seconds — the single
 * source of truth shared by preview and export: the lowering bakes these
 * points into `ctx.data.audio[i].env`, the program applies them with
 * setValueAtTime/linearRampToValueAtTime, and the export applies the SAME
 * points in its OfflineAudioContext mix. Fades that together exceed the clip
 * span are scaled down proportionally so they meet instead of crossing.
 */
import { clipLength } from '../types'
import type { AudioClip } from '../types'

export interface EnvelopePoint {
  /** output-timeline seconds. */
  t: number
  /** linear gain 0..1. */
  g: number
}

export function clipEnvelope(
  clip: Pick<
    AudioClip,
    'start' | 'in' | 'out' | 'gain' | 'fadeIn' | 'fadeOut' | 'loop' | 'loopLen'
  >,
): EnvelopePoint[] {
  // Fades span the PLACED length (a looped clip fades over its full run).
  const span = clipLength(clip)
  const end = clip.start + span
  let fi = Math.max(0, clip.fadeIn)
  let fo = Math.max(0, clip.fadeOut)
  if (fi + fo > span && fi + fo > 0) {
    const scale = span / (fi + fo)
    fi *= scale
    fo *= scale
  }
  const g = Math.max(0, Math.min(1, clip.gain))
  const pts: EnvelopePoint[] = []
  pts.push({ t: clip.start, g: fi > 0 ? 0 : g })
  if (fi > 0) pts.push({ t: clip.start + fi, g })
  if (fo > 0 && end - fo > clip.start + fi) pts.push({ t: end - fo, g })
  pts.push({ t: end, g: fo > 0 ? 0 : g })
  // Dedupe collapsed points (zero-span or zero-fade edge cases).
  return pts.filter((p, i) => i === 0 || p.t > pts[i - 1].t + 1e-9)
}

/** Envelope value at output time `t` (linear interpolation; 0 outside the clip). */
export function envelopeValueAt(env: EnvelopePoint[], t: number): number {
  if (!env.length || t < env[0].t || t > env[env.length - 1].t) return 0
  for (let i = 1; i < env.length; i++) {
    if (t <= env[i].t) {
      const a = env[i - 1]
      const b = env[i]
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1
      return a.g + (b.g - a.g) * f
    }
  }
  return env[env.length - 1].g
}
