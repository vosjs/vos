/**
 * Finalize concat — stream-copy chunk videos into one file, no re-encode.
 *
 * Each chunk is an independently encoded file whose timestamps start at 0
 * (chunk-local). Concat demuxes every chunk's video packets and re-muxes
 * them into one output, offsetting timestamps by the chunk's global start
 * time. Because chunks were encoded with identical codec/params (the caller's
 * responsibility — one encoder config per render) and every independently
 * encoded file begins with a keyframe, packet-level concatenation is valid
 * with zero quality loss and near-zero CPU: pure container work, runs in
 * plain Node (mediabunny demux/mux is pure JS; no WebCodecs needed).
 *
 * Audio is deliberately absent here: per the rendering plan, audio renders
 * ONCE centrally and gets muxed against the concatenated video, so encoder
 * priming seams never exist.
 */

import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import type { EncodedPacket, InputVideoTrack, VideoCodec } from 'mediabunny'

export interface ConcatChunk {
  /** Encoded chunk file bytes (WebM or MP4, matching `format`). */
  data: Uint8Array
  /**
   * The chunk's exact intended duration in seconds (frameCount / fps, from
   * the chunk plan). Used as the timestamp offset for the NEXT chunk —
   * derived from the plan, not from packet rounding, so drift can't
   * accumulate across chunks.
   */
  duration: number
}

export interface ConcatOptions {
  format: 'webm' | 'mp4'
  /** Stamped into the output track metadata (players use it as a hint). */
  frameRate?: number
}

export interface ConcatResult {
  bytes: Uint8Array
  /** Total video packets written. */
  packetCount: number
  /** Codec copied through (from the first chunk). */
  codec: VideoCodec
}

async function openVideoTrack(
  data: Uint8Array,
  chunkIndex: number,
): Promise<{ input: Input; track: InputVideoTrack }> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(data),
  })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error(`Chunk ${chunkIndex} has no video track`)
  return { input, track }
}

export interface MuxExportOptions extends ConcatOptions {
  /**
   * Video parts in plan order. An async iterable lets the caller feed parts
   * ONE at a time from storage instead of materializing all of them first
   * (the worker finalize's memory shape).
   */
  video: AsyncIterable<ConcatChunk> | Iterable<ConcatChunk>
  /**
   * Optional encoded audio file (any container mediabunny reads — the audio
   * mix page produces Opus in WebM). Its packets are STREAM-COPIED into the
   * output's audio track: no decode, no WebCodecs, pure container work, so
   * this runs in a Worker isolate exactly like the video concat.
   */
  audio?: Uint8Array
}

/**
 * Mux a chunked export's final artifact: stream-copy the video parts with
 * plan-derived timestamp offsets, and stream-copy the pre-encoded audio
 * track when one is provided. `packetCount` counts VIDEO packets only —
 * that is the frame-parity contract callers assert against the plan.
 */
export async function muxEncodedExport(
  options: MuxExportOptions,
): Promise<ConcatResult> {
  const output = new Output({
    format:
      options.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  })

  // Audio track first (mirrors the finalize page: audio is small and fully
  // known up front; the muxer interleaves at finalize).
  let audioTrack: {
    source: EncodedAudioPacketSource
    sink: EncodedPacketSink
    decoderConfig: AudioDecoderConfig
  } | null = null
  if (options.audio) {
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(options.audio),
    })
    const track = await input.getPrimaryAudioTrack()
    if (!track || !track.codec) {
      throw new Error('Audio part has no readable audio track')
    }
    const decoderConfig = await track.getDecoderConfig()
    if (!decoderConfig) throw new Error('Audio part has no decoder config')
    const source = new EncodedAudioPacketSource(track.codec)
    output.addAudioTrack(source)
    audioTrack = { source, sink: new EncodedPacketSink(track), decoderConfig }
  }

  let videoSource: EncodedVideoPacketSource | null = null
  let codec: VideoCodec | null = null
  let decoderConfig: VideoDecoderConfig | null = null
  let started = false
  let offset = 0
  let packetCount = 0
  let index = 0

  for await (const chunk of options.video) {
    const i = index++
    const { track } = await openVideoTrack(chunk.data, i)
    if (i === 0) {
      codec = track.codec
      if (!codec) throw new Error('Chunk 0 video codec could not be determined')
      decoderConfig = await track.getDecoderConfig()
      if (!decoderConfig) throw new Error('Chunk 0 has no decoder config')
      videoSource = new EncodedVideoPacketSource(codec)
      output.addVideoTrack(
        videoSource,
        options.frameRate ? { frameRate: options.frameRate } : undefined,
      )
      await output.start()
      started = true

      if (audioTrack) {
        let firstAudio = true
        for await (const packet of audioTrack.sink.packets()) {
          await audioTrack.source.add(
            packet,
            firstAudio
              ? { decoderConfig: audioTrack.decoderConfig }
              : undefined,
          )
          firstAudio = false
        }
        audioTrack.source.close()
      }
    } else if (track.codec !== codec) {
      throw new Error(
        `Chunk ${i} codec ${String(track.codec)} != chunk 0 codec ${String(codec)} — chunks must share one encoder config`,
      )
    }

    const sink = new EncodedPacketSink(track)
    let firstOfChunk = true
    for await (const packet of sink.packets()) {
      if (firstOfChunk && packet.type !== 'key') {
        throw new Error(
          `Chunk ${i} does not start on a keyframe — was it encoded as an independent chunk?`,
        )
      }
      const shifted: EncodedPacket = packet.clone({
        timestamp: packet.timestamp + offset,
      })
      await videoSource!.add(
        shifted,
        firstOfChunk && i === 0 && decoderConfig
          ? { decoderConfig }
          : undefined,
      )
      firstOfChunk = false
      packetCount++
    }

    // Advance by the PLANNED duration (frames/fps), not the demuxed one —
    // container timestamp rounding must not accumulate across chunks.
    offset += chunk.duration
  }

  if (!started || !videoSource || !codec) {
    throw new Error('muxEncodedExport: no video parts')
  }

  await output.finalize()
  const bytes = output.target.buffer
  if (!bytes) throw new Error('Concat produced no output buffer')
  return { bytes: new Uint8Array(bytes), packetCount, codec }
}

/**
 * Concatenate independently encoded chunk videos into one stream-copied file.
 * Chunks must share codec and encoder params; the first packet of every
 * chunk must be a keyframe (violations throw — better a loud failure at
 * finalize than a corrupt artifact). Thin wrapper over muxEncodedExport,
 * kept as the CLI's finalize entry point.
 */
export async function concatEncodedVideo(
  chunks: ConcatChunk[],
  options: ConcatOptions,
): Promise<ConcatResult> {
  if (chunks.length === 0) throw new Error('concatEncodedVideo: no chunks')
  return muxEncodedExport({ ...options, video: chunks })
}

/**
 * Count video packets in an encoded file — cheap integrity check used by
 * parity verification (chunked and single-flight renders of the same
 * composition must contain the same number of frames).
 */
export async function countVideoPackets(data: Uint8Array): Promise<number> {
  const { track } = await openVideoTrack(data, 0)
  const sink = new EncodedPacketSink(track)
  let count = 0
  for await (const packet of sink.packets()) {
    void packet
    count++
  }
  return count
}
