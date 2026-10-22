/**
 * What `vos check-video` concludes from a rendered file, as pure functions
 * over what the decode page measured: the frame-to-frame change of a small
 * picture, the K-weighted energy of the sound in 100 ms pieces, and how
 * flat the first and last frames are. The page decodes; this decides.
 *
 * Loudness follows ITU-R BS.1770-4: the K-weighting pre-filter (a high
 * shelf, then the RLB high-pass) designed for the file's own sample rate,
 * 400 ms blocks every 100 ms, the absolute gate at -70 LUFS and the
 * relative gate 10 LU under the absolutely gated mean. Short-term loudness
 * is the same measure over 3 s. The peak is the SAMPLE peak: no
 * oversampling, so a true peak can sit a little above it.
 */

/** A full-frame change: the mean absolute difference (0..1) at or above this. */
export const SCENE_CHANGE_AT = 0.12

/** A 4 px cell of the small frame has changed when its own mean difference reaches this. */
export const CELL_CHANGED_AT = 0.03

/** The window a cut is counted in, seconds. */
export const SCENE_WINDOW = 5

/** A frame whose colours deviate less than this (0..255, per channel) is near-uniform. */
export const UNIFORM_BELOW = 2

/** Integrated loudness below this is too quiet for a social feed. */
export const QUIET_BELOW_LUFS = -23

/** Integrated loudness above this is too loud: it will be turned down and may clip. */
export const LOUD_ABOVE_LUFS = -9

/** The piece of sound the page sums energy over, seconds. */
export const SUB_BLOCK_SECONDS = 0.1

/** Short-term loudness is reported every this many seconds, over as many. */
export const SHORT_TERM_SECONDS = 3

/**
 * A cut stands out from the frames around it: at least this many times the
 * median change of its two neighbours on either side. Motion (a zoom, a
 * pan, a scroll) changes every frame of its stretch by about as much, so it
 * never stands out, however much of the picture it moves.
 */
export const SCENE_SPIKE = 2.5

/**
 * A smaller change is still a cut when it stands ALONE: the picture held
 * still on both sides of it (each of the two frames either side changed by
 * under 1/ISOLATED_SPIKE of it) and it reached ISOLATED_CHANGE_AT over at
 * least ISOLATED_COVERAGE of the frame. Two views of one dark or sparse
 * picture differ by little on average, and a camera that jumps between
 * them in one frame is a cut all the same. A fade's first step has the
 * fade's next steps beside it, so it never stands alone.
 */
export const ISOLATED_CHANGE_AT = 0.03
export const ISOLATED_SPIKE = 8
export const ISOLATED_COVERAGE = 0.25

export interface SceneChange {
  /** Output seconds of the first frame after the change. */
  time: number
  /** Mean absolute difference from the frame before, 0..1. */
  change: number
  /** The share of the frame that changed, 0..1, when it was measured. */
  coverage?: number
}

/**
 * The full-frame changes in a series of sampled frames, from each frame's
 * change from the one before (and, when measured, the share of the frame
 * that changed). A frame is a cut when it is the peak of its run, so a cut
 * that spreads over two decoded frames counts once, and either a large
 * change that stands out from its neighbours (SCENE_CHANGE_AT,
 * SCENE_SPIKE), or a smaller one that stands alone (ISOLATED_*). A camera
 * move is neither.
 */
export function sceneChanges(
  times: readonly number[],
  changes: readonly number[],
  coverage?: readonly number[],
): SceneChange[] {
  const out: SceneChange[] = []
  for (let i = 1; i < changes.length; i++) {
    const c = changes[i]
    if (c < Math.min(SCENE_CHANGE_AT, ISOLATED_CHANGE_AT)) continue
    if (i > 1 && changes[i - 1] > c) continue
    if (i + 1 < changes.length && changes[i + 1] >= c) continue
    const around = [i - 2, i - 1, i + 1, i + 2]
      .filter((k) => k >= 1 && k < changes.length)
      .map((k) => changes[k])
      .sort((a, b) => a - b)
    const mid = around.length
      ? around.length % 2
        ? around[(around.length - 1) / 2]
        : (around[around.length / 2 - 1] + around[around.length / 2]) / 2
      : 0
    const most = around.length ? around[around.length - 1] : 0
    const share = coverage ? coverage[i] : 1
    const standsOut = c >= SCENE_CHANGE_AT && c >= SCENE_SPIKE * mid
    const standsAlone =
      c >= ISOLATED_CHANGE_AT &&
      share >= ISOLATED_COVERAGE &&
      c >= ISOLATED_SPIKE * most
    if (!standsOut && !standsAlone) continue
    out.push({
      time: times[i],
      change: Math.round(c * 1e4) / 1e4,
      ...(coverage ? { coverage: Math.round(share * 1000) / 1000 } : {}),
    })
  }
  return out
}

/** How many changes fall in each consecutive window from 0. */
export function windowCounts(
  cuts: readonly SceneChange[],
  duration: number,
  window = SCENE_WINDOW,
): { start: number; count: number }[] {
  const n = Math.max(1, Math.ceil(duration / window - 1e-9))
  const out = Array.from({ length: n }, (_, k) => ({
    start: k * window,
    count: 0,
  }))
  for (const c of cuts) {
    const k = Math.min(n - 1, Math.max(0, Math.floor(c.time / window)))
    out[k].count++
  }
  return out
}

/**
 * Runs of changes that any one window of `window` seconds holds more than
 * one of: two cuts closer than the window, wherever the window starts.
 */
export function crowdedRuns(
  cuts: readonly SceneChange[],
  window = SCENE_WINDOW,
): SceneChange[][] {
  const runs: SceneChange[][] = []
  let run: SceneChange[] = []
  for (const c of cuts) {
    if (run.length && c.time - run[run.length - 1].time < window) run.push(c)
    else {
      if (run.length > 1) runs.push(run)
      run = [c]
    }
  }
  if (run.length > 1) runs.push(run)
  return runs
}

/**
 * A streaming K-weighted energy meter, SELF-CONTAINED on purpose: the decode
 * page runs it from its source text (`String(createLoudnessMeter)`), so it
 * references nothing outside its own body. `push` takes each decoded
 * buffer's channels in order; `finish` hands back, per channel, the mean
 * square of the K-weighted signal over every `subBlockSeconds` piece, and
 * the sample peak.
 */
export function createLoudnessMeter(
  sampleRate: number,
  channelCount: number,
  subBlockSeconds: number,
): {
  push: (channels: Float32Array[]) => void
  finish: () => { energies: number[][]; peak: number; samples: number }
} {
  // BS.1770's two biquads, designed for this rate (the design libebur128
  // uses; at 48 kHz it lands on the standard's own coefficients).
  const shelf = (() => {
    const f0 = 1681.974450955533
    const G = 3.999843853973347
    const Q = 0.7071752369554196
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const Vh = Math.pow(10, G / 20)
    const Vb = Math.pow(Vh, 0.4996667741545416)
    const a0 = 1 + K / Q + K * K
    return {
      b0: (Vh + (Vb * K) / Q + K * K) / a0,
      b1: (2 * (K * K - Vh)) / a0,
      b2: (Vh - (Vb * K) / Q + K * K) / a0,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    }
  })()
  const highpass = (() => {
    const f0 = 38.13547087602444
    const Q = 0.5003270373238773
    const K = Math.tan((Math.PI * f0) / sampleRate)
    const a0 = 1 + K / Q + K * K
    return {
      b0: 1,
      b1: -2,
      b2: 1,
      a1: (2 * (K * K - 1)) / a0,
      a2: (1 - K / Q + K * K) / a0,
    }
  })()
  const per = Math.max(1, Math.round(sampleRate * subBlockSeconds))
  const state = Array.from({ length: channelCount }, () => ({
    // Direct form I history for each stage.
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
    u1: 0,
    u2: 0,
    w1: 0,
    w2: 0,
    sum: 0,
    count: 0,
    energies: [] as number[],
  }))
  let peak = 0
  let samples = 0
  return {
    push(channels) {
      for (let c = 0; c < channelCount; c++) {
        const data = channels[c]
        const s = state[c]
        if (!data) continue
        for (let i = 0; i < data.length; i++) {
          const x = data[i]
          const ax = x < 0 ? -x : x
          if (ax > peak) peak = ax
          const y =
            shelf.b0 * x +
            shelf.b1 * s.x1 +
            shelf.b2 * s.x2 -
            shelf.a1 * s.y1 -
            shelf.a2 * s.y2
          s.x2 = s.x1
          s.x1 = x
          s.y2 = s.y1
          s.y1 = y
          const w =
            highpass.b0 * y +
            highpass.b1 * s.u1 +
            highpass.b2 * s.u2 -
            highpass.a1 * s.w1 -
            highpass.a2 * s.w2
          s.u2 = s.u1
          s.u1 = y
          s.w2 = s.w1
          s.w1 = w
          s.sum += w * w
          s.count++
          if (s.count === per) {
            s.energies.push(s.sum / per)
            s.sum = 0
            s.count = 0
          }
        }
        if (c === 0) samples += data.length
      }
    },
    finish() {
      return {
        energies: state.map((s) =>
          s.count > 0 ? [...s.energies, s.sum / s.count] : s.energies,
        ),
        peak,
        samples,
      }
    },
  }
}

/** BS.1770's channel weights: 1 for left, right and centre, 0 for the LFE of 5.1, 1.41 for the surrounds. */
export function channelWeights(count: number): number[] {
  if (count === 6) return [1, 1, 1, 0, 1.41, 1.41]
  return Array.from({ length: count }, (_, i) => (i < 3 ? 1 : 1.41))
}

const LOUDNESS_OFFSET = -0.691
const toLufs = (power: number): number | null =>
  power > 0 ? LOUDNESS_OFFSET + 10 * Math.log10(power) : null

/** The weighted power of `count` sub-blocks from `from`, averaged. */
function windowPower(
  energies: readonly (readonly number[])[],
  weights: readonly number[],
  from: number,
  count: number,
): number {
  let total = 0
  for (let c = 0; c < energies.length; c++) {
    const e = energies[c]
    let sum = 0
    let n = 0
    for (let k = from; k < from + count && k < e.length; k++) {
      sum += e[k]
      n++
    }
    if (n) total += (weights[c] ?? 1) * (sum / n)
  }
  return total
}

export interface LoudnessReport {
  unit: 'LUFS'
  /** Integrated loudness; null when no block passes the absolute gate (silence). */
  integrated: number | null
  /** Short-term loudness of each 3 s from 0; null for a silent stretch. */
  shortTerm: { time: number; loudness: number | null }[]
  /** The loudest short-term value. */
  maxShortTerm: number | null
  /** Sample peak in dBFS (not oversampled); null for digital silence. */
  samplePeakDb: number | null
}

const round1 = (n: number | null) =>
  n === null ? null : Math.round(n * 10) / 10

/**
 * BS.1770 integrated and short-term loudness from per-channel K-weighted
 * energies in `subBlock`-second pieces (what `createLoudnessMeter` hands
 * back), plus the sample peak.
 */
export function loudnessFromEnergies(
  energies: readonly (readonly number[])[],
  peak: number,
  subBlock = SUB_BLOCK_SECONDS,
): LoudnessReport {
  const weights = channelWeights(energies.length)
  const pieces = Math.max(0, ...energies.map((e) => e.length))
  const blockLen = Math.max(1, Math.round(0.4 / subBlock))
  const blocks: number[] = []
  for (let k = 0; k + blockLen <= pieces; k++)
    blocks.push(windowPower(energies, weights, k, blockLen))
  // A file shorter than one block is measured as the one block it has.
  if (!blocks.length && pieces > 0)
    blocks.push(windowPower(energies, weights, 0, pieces))
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
  const loud = (p: number) => toLufs(p) ?? -Infinity
  const absolute = blocks.filter((p) => loud(p) > -70)
  let integrated: number | null = null
  if (absolute.length) {
    const gate = loud(mean(absolute)) - 10
    const relative = absolute.filter((p) => loud(p) > gate)
    integrated = toLufs(mean(relative))
  }
  const stLen = Math.max(1, Math.round(SHORT_TERM_SECONDS / subBlock))
  const shortTerm: LoudnessReport['shortTerm'] = []
  for (let k = 0; k < pieces; k += stLen) {
    // A last stretch under one block says nothing a listener would hear.
    if (pieces - k < blockLen && k > 0) break
    shortTerm.push({
      time: Math.round(k * subBlock * 100) / 100,
      loudness: round1(toLufs(windowPower(energies, weights, k, stLen))),
    })
  }
  const st = shortTerm
    .map((s) => s.loudness)
    .filter((l): l is number => l !== null)
  return {
    unit: 'LUFS',
    integrated: round1(integrated),
    shortTerm,
    maxShortTerm: st.length ? Math.max(...st) : null,
    samplePeakDb: peak > 0 ? round1(20 * Math.log10(peak)) : null,
  }
}

/** The loudness warnings, in words. */
export function loudnessWarnings(l: LoudnessReport): string[] {
  if (l.integrated === null)
    return [
      'the sound is silent: no 400 ms block reaches -70 LUFS, the floor loudness is measured from',
    ]
  if (l.integrated < QUIET_BELOW_LUFS)
    return [
      `integrated loudness ${l.integrated} LUFS is below ${QUIET_BELOW_LUFS}: too quiet for a social feed, where a viewer turns sound up once and keeps it`,
    ]
  if (l.integrated > LOUD_ABOVE_LUFS)
    return [
      `integrated loudness ${l.integrated} LUFS is above ${LOUD_ABOVE_LUFS}: too loud, a platform turns it down and a peak may clip`,
    ]
  return []
}

/** The scene warnings, in words. */
export function sceneWarnings(cuts: readonly SceneChange[]): string[] {
  return crowdedRuns(cuts).map(
    (run) =>
      `${run.length} full-frame changes within ${SCENE_WINDOW} s (at ${run.map((c) => `${c.time.toFixed(2)}s`).join(', ')}): more than one cut in ${SCENE_WINDOW} s is hard to follow`,
  )
}

/** The poster warning for the first or last frame, in words, or null. */
export function posterWarning(
  which: 'first' | 'last',
  deviation: number,
): string | null {
  if (deviation >= UNIFORM_BELOW) return null
  return which === 'first'
    ? `the first frame is near-uniform (deviation ${deviation.toFixed(2)} of 255): the video opens on an empty or faded frame, which is what a feed shows before it plays`
    : `the last frame is near-uniform (deviation ${deviation.toFixed(2)} of 255): the video ends on an empty or faded frame, which is what a player rests on`
}
