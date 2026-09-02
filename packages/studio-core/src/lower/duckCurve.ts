/**
 * Auto-ducking — lower music under speech. Pure math over a precomputed mic
 * loudness envelope, so both consumers apply identical values:
 *
 *   host (async):  decode mic → `micRms` (SOURCE-time loudness grid, cached)
 *   host (sync):   `duckCurve(rms, segments, duration)` → OUTPUT-time gain
 *                  points, merged into ctx.data as `duckEnv`
 *   preview:       per ducked clip, a second GainNode applies the points
 *   export:        same points in the OfflineAudioContext mix
 */
import { mapTime } from '@vosjs/timeline'
import type { Segment } from '@vosjs/timeline'
import type { EnvelopePoint } from './audioEnvelope'

/** SOURCE-time loudness grid (RMS per window). */
export interface MicRms {
  /** RMS value per window, linear 0..1. */
  values: Float32Array
  /** windows per second. */
  rate: number
}

export interface DuckOptions {
  /** RMS above this counts as speech. */
  threshold: number
  /** gain while ducked (≈ -12 dB). */
  duckTo: number
  /** seconds to reach the ducked level once speech starts. */
  attack: number
  /** seconds to recover after speech stops. */
  release: number
  /** output grid resolution, points per second. */
  gridHz: number
}

export const DEFAULT_DUCK: DuckOptions = {
  threshold: 0.02,
  duckTo: 0.25,
  attack: 0.2,
  release: 0.5,
  gridHz: 20,
}

/** RMS windows from raw PCM — the host runs this once per recording (cached). */
export function computeMicRms(
  channels: Float32Array[],
  sampleRate: number,
  windowSec = 0.05,
): MicRms {
  const rate = 1 / windowSec
  if (!channels.length || !channels[0].length)
    return { values: new Float32Array(0), rate }
  const length = channels[0].length
  const perWindow = Math.max(1, Math.round(sampleRate * windowSec))
  const windows = Math.ceil(length / perWindow)
  const values = new Float32Array(windows)
  for (let w = 0; w < windows; w++) {
    const from = w * perWindow
    const to = Math.min(length, from + perWindow)
    let sum = 0
    for (const ch of channels) {
      for (let i = from; i < to; i++) sum += ch[i] * ch[i]
    }
    values[w] = Math.sqrt(sum / Math.max(1, (to - from) * channels.length))
  }
  return { values, rate }
}

/**
 * The OUTPUT-time duck multiplier curve: walk an output grid, look up the mic
 * loudness at the mapped SOURCE moment, and smooth engage/recover with
 * attack/release one-poles. Points are thinned (emitted on ≥1% change).
 */
export function duckCurve(
  rms: MicRms,
  segments: Segment[],
  durationSec: number,
  opts: DuckOptions = DEFAULT_DUCK,
): EnvelopePoint[] {
  if (!rms.values.length || durationSec <= 0) return []
  const dt = 1 / opts.gridHz
  const points: EnvelopePoint[] = []
  let g = 1
  let lastEmitted = Number.NaN
  const steps = Math.ceil(durationSec * opts.gridHz)
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(durationSec, i * dt)
    const srcT = mapTime(segments, t)
    const w = Math.min(
      rms.values.length - 1,
      Math.max(0, Math.floor(srcT * rms.rate)),
    )
    const speech = rms.values[w] > opts.threshold
    const target = speech ? opts.duckTo : 1
    const tau = target < g ? opts.attack : opts.release
    g += (target - g) * Math.min(1, dt / Math.max(1e-3, tau))
    if (
      Number.isNaN(lastEmitted) ||
      Math.abs(g - lastEmitted) >= 0.01 ||
      i === steps
    ) {
      points.push({
        t: Math.round(t * 1000) / 1000,
        g: Math.round(g * 1000) / 1000,
      })
      lastEmitted = g
    }
  }
  return points
}
