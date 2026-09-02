/**
 * Worker finalize mux: video parts stream-copied with plan offsets
 * PLUS a pre-encoded audio part stream-copied alongside — all pure container
 * work, buildable and verifiable in Node with fabricated packets (the
 * concat.test.ts technique, extended to an Opus-flagged audio track).
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import { muxEncodedExport } from '../concat'

const FPS = 30

async function makeVideoChunk(frames: number, keyEvery = 10) {
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new EncodedVideoPacketSource('vp9')
  output.addVideoTrack(source, { frameRate: FPS })
  await output.start()
  for (let i = 0; i < frames; i++) {
    const packet = new EncodedPacket(
      new Uint8Array([0xde, 0xad, i % 256]),
      i % keyEvery === 0 ? 'key' : 'delta',
      i / FPS,
      1 / FPS,
    )
    await source.add(
      packet,
      i === 0
        ? {
            decoderConfig: {
              codec: 'vp09.00.10.08',
              codedWidth: 64,
              codedHeight: 64,
            },
          }
        : undefined,
    )
  }
  await output.finalize()
  return new Uint8Array(output.target.buffer!)
}

/** Audio-only WebM of `count` fake Opus packets — the audio mix page's shape. */
async function makeAudioPart(count: number) {
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new EncodedAudioPacketSource('opus')
  output.addAudioTrack(source)
  await output.start()
  const frameDur = 0.02 // 20ms Opus frames
  for (let i = 0; i < count; i++) {
    const packet = new EncodedPacket(
      new Uint8Array([0xa0, i % 256]),
      'key',
      i * frameDur,
      frameDur,
    )
    await source.add(
      packet,
      i === 0
        ? {
            decoderConfig: {
              codec: 'opus',
              sampleRate: 48000,
              numberOfChannels: 2,
            },
          }
        : undefined,
    )
  }
  await output.finalize()
  return new Uint8Array(output.target.buffer!)
}

async function* asStream(parts: { data: Uint8Array; duration: number }[]) {
  for (const part of parts) yield part
}

describe('muxEncodedExport', () => {
  it('muxes streamed video parts with a stream-copied audio track', async () => {
    const a = await makeVideoChunk(30)
    const b = await makeVideoChunk(30)
    const audio = await makeAudioPart(100) // 2s of fake Opus

    const result = await muxEncodedExport({
      video: asStream([
        { data: a, duration: 1 },
        { data: b, duration: 1 },
      ]),
      audio,
      format: 'webm',
      frameRate: FPS,
    })
    expect(result.packetCount).toBe(60) // VIDEO packets only — the parity contract
    expect(result.codec).toBe('vp9')

    const input = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(result.bytes),
    })
    const videoTrack = (await input.getPrimaryVideoTrack())!
    const audioTrack = (await input.getPrimaryAudioTrack())!
    expect(audioTrack.codec).toBe('opus')

    let videoPackets = 0
    let lastTs = -1
    for await (const p of new EncodedPacketSink(videoTrack).packets()) {
      if (videoPackets === 30) {
        // Second chunk offsets by the PLANNED duration.
        expect(p.timestamp).toBeCloseTo(1, 3)
        expect(p.type).toBe('key')
      }
      expect(p.timestamp).toBeGreaterThan(lastTs - 1e-6)
      lastTs = p.timestamp
      videoPackets++
    }
    expect(videoPackets).toBe(60)

    let audioPackets = 0
    for await (const p of new EncodedPacketSink(audioTrack).packets()) {
      void p
      audioPackets++
    }
    expect(audioPackets).toBe(100)
  })

  it('still muxes video-only when no audio is provided', async () => {
    const a = await makeVideoChunk(15)
    const result = await muxEncodedExport({
      video: asStream([{ data: a, duration: 0.5 }]),
      format: 'webm',
      frameRate: FPS,
    })
    expect(result.packetCount).toBe(15)
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BufferSource(result.bytes),
    })
    expect(await input.getPrimaryAudioTrack()).toBeNull()
  })

  it('rejects an audio part with no audio track', async () => {
    const a = await makeVideoChunk(15)
    await expect(
      muxEncodedExport({
        video: asStream([{ data: a, duration: 0.5 }]),
        audio: a, // a VIDEO file where audio belongs
        format: 'webm',
      }),
    ).rejects.toThrow(/no readable audio track/)
  })
})
