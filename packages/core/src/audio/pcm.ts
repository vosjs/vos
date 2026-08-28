/**
 * Plain PCM: the audio renderer's currency. No `AudioBuffer` (that is a DOM
 * type), so the renderer runs wherever JavaScript does and a consumer that has
 * a Web Audio context converts with `toAudioBuffer`.
 */
export interface PcmBuffer {
  sampleRate: number
  /** Frames per channel. */
  length: number
  /** One Float32Array per channel, all `length` long. */
  channels: Float32Array[]
}

export function createPcm(
  sampleRate: number,
  length: number,
  channelCount: number,
): PcmBuffer {
  const channels: Float32Array[] = []
  for (let c = 0; c < channelCount; c++) channels.push(new Float32Array(length))
  return { sampleRate, length, channels }
}

/** Seconds of audio in the buffer. */
export function pcmDuration(pcm: PcmBuffer): number {
  return pcm.sampleRate > 0 ? pcm.length / pcm.sampleRate : 0
}

/** Copy a Web Audio `AudioBuffer` into plain PCM. */
export function pcmFromAudioBuffer(buffer: {
  sampleRate: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}): PcmBuffer {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(Float32Array.from(buffer.getChannelData(c)))
  }
  return { sampleRate: buffer.sampleRate, length: buffer.length, channels }
}

/**
 * Wrap plain PCM in an `AudioBuffer` from the given context (an
 * `AudioContext`, `OfflineAudioContext`, or anything with `createBuffer`).
 */
export function toAudioBuffer<
  T extends { copyToChannel(src: Float32Array, channel: number): void },
>(
  pcm: PcmBuffer,
  ctx: {
    createBuffer(channels: number, length: number, sampleRate: number): T
  },
): T {
  const out = ctx.createBuffer(pcm.channels.length, pcm.length, pcm.sampleRate)
  pcm.channels.forEach((data, c) => out.copyToChannel(data, c))
  return out
}
