/**
 * Concat round-trip test with synthetic packets: mediabunny's demux/mux is
 * pure JS (no WebCodecs), so we can build real WebM chunk files in Node from
 * fabricated VP9-flagged packets, concat them, and demux the result to
 * verify packet counts, ordering, keyframe preservation, and timestamp
 * offsetting — the exact seams a chunked render depends on.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  EncodedPacket,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Output,
  WebMOutputFormat,
} from 'mediabunny'
import { concatEncodedVideo, countVideoPackets } from '../concat'

const FPS = 30

/** Build a WebM chunk of `frames` fake VP9 packets with chunk-local timestamps. */
async function makeChunk(frames: number, keyEvery = 10): Promise<Uint8Array> {
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const source = new EncodedVideoPacketSource('vp9')
  output.addVideoTrack(source, { frameRate: FPS })
  await output.start()

  for (let i = 0; i < frames; i++) {
    const type = i % keyEvery === 0 ? 'key' : 'delta'
    const packet = new EncodedPacket(
      new Uint8Array([0xde, 0xad, i % 256]),
      type,
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

async function readPackets(data: Uint8Array) {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BufferSource(data),
  })
  const track = (await input.getPrimaryVideoTrack())!
  const sink = new EncodedPacketSink(track)
  const packets: { timestamp: number; type: string }[] = []
  for await (const p of sink.packets()) {
    packets.push({ timestamp: p.timestamp, type: p.type })
  }
  return packets
}

describe('concatEncodedVideo', () => {
  it('stream-copies chunks with global timestamps and preserved keyframes', async () => {
    const a = await makeChunk(30)
    const b = await makeChunk(31)
    const c = await makeChunk(29)

    const result = await concatEncodedVideo(
      [
        { data: a, duration: 30 / FPS },
        { data: b, duration: 31 / FPS },
        { data: c, duration: 29 / FPS },
      ],
      { format: 'webm', frameRate: FPS },
    )

    expect(result.codec).toBe('vp9')
    expect(result.packetCount).toBe(90)
    expect(await countVideoPackets(result.bytes)).toBe(90)

    const packets = await readPackets(result.bytes)
    expect(packets).toHaveLength(90)

    // Chunk boundaries land exactly at the planned offsets (WebM stores ms;
    // allow its rounding), and each chunk's first packet stays a keyframe.
    expect(packets[0].type).toBe('key')
    expect(packets[30].type).toBe('key')
    expect(packets[30].timestamp).toBeCloseTo(30 / FPS, 3)
    expect(packets[61].type).toBe('key')
    expect(packets[61].timestamp).toBeCloseTo(61 / FPS, 3)

    // Monotonic presentation order across the whole file.
    for (let i = 1; i < packets.length; i++) {
      expect(packets[i].timestamp).toBeGreaterThan(packets[i - 1].timestamp)
    }
    // Last frame sits where the plan says the video ends, minus one frame.
    expect(packets[89].timestamp).toBeCloseTo(89 / FPS, 3)
  })

  it('handles a minimal key+delta chunk (single-chunk passthrough)', async () => {
    // The keyframe guard in concat is defensive — a valid container cannot
    // start with a delta frame (the muxer refuses to write one) — so the
    // reachable behavior to pin is clean passthrough of a tiny chunk.
    const output = new Output({
      format: new WebMOutputFormat(),
      target: new BufferTarget(),
    })
    const source = new EncodedVideoPacketSource('vp9')
    output.addVideoTrack(source)
    await output.start()
    await source.add(
      new EncodedPacket(new Uint8Array([1]), 'key', 0, 1 / FPS),
      {
        decoderConfig: {
          codec: 'vp09.00.10.08',
          codedWidth: 64,
          codedHeight: 64,
        },
      },
    )
    await source.add(
      new EncodedPacket(new Uint8Array([2]), 'delta', 1 / FPS, 1 / FPS),
    )
    await output.finalize()
    const chunk = new Uint8Array(output.target.buffer!)

    const ok = await concatEncodedVideo([{ data: chunk, duration: 2 / FPS }], {
      format: 'webm',
    })
    expect(ok.packetCount).toBe(2)
    const packets = await readPackets(ok.bytes)
    expect(packets.map((p) => p.type)).toEqual(['key', 'delta'])
  })

  it('rejects mixed codecs', async () => {
    const vp9 = await makeChunk(30)

    const output = new Output({
      format: new WebMOutputFormat(),
      target: new BufferTarget(),
    })
    const source = new EncodedVideoPacketSource('vp8')
    output.addVideoTrack(source)
    await output.start()
    await source.add(
      new EncodedPacket(new Uint8Array([9]), 'key', 0, 1 / FPS),
      { decoderConfig: { codec: 'vp8', codedWidth: 64, codedHeight: 64 } },
    )
    await output.finalize()
    const vp8 = new Uint8Array(output.target.buffer!)

    await expect(
      concatEncodedVideo(
        [
          { data: vp9, duration: 1 },
          { data: vp8, duration: 1 / FPS },
        ],
        { format: 'webm' },
      ),
    ).rejects.toThrow(/codec/)
  })

  it('throws on empty input', async () => {
    await expect(concatEncodedVideo([], { format: 'webm' })).rejects.toThrow()
  })
})
