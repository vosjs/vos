/**
 * Waveform peaks — pure downsampling for timeline clip rendering. The host
 * decodes the file (Web Audio) and hands channel data here; the result is one
 * max-|sample| value per bucket in [0..1], drawn as symmetric bars.
 */
export function computePeaks(
  channels: Float32Array[],
  buckets: number,
): Float32Array {
  const peaks = new Float32Array(Math.max(1, buckets))
  if (!channels.length || !channels[0].length) return peaks
  const length = channels[0].length
  const perBucket = length / peaks.length
  for (let b = 0; b < peaks.length; b++) {
    const from = Math.floor(b * perBucket)
    const to = Math.min(
      length,
      Math.max(from + 1, Math.floor((b + 1) * perBucket)),
    )
    let peak = 0
    for (const ch of channels) {
      for (let i = from; i < to; i++) {
        const v = Math.abs(ch[i])
        if (v > peak) peak = v
      }
    }
    peaks[b] = Math.min(1, peak)
  }
  return peaks
}
