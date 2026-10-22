/**
 * Tiny media files for tests, made in Node with no encoder: an MP4 whose
 * video track is a run of placeholder packets (enough for a demuxer to read
 * its size, length and rate, which is all a probe asks), and a PCM WAV
 * whose samples a test writes itself.
 */
import { writeFile } from 'node:fs/promises'
import {
  BufferTarget,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'

/** An MP4 of `seconds` at `fps`, `width`×`height`, its frames placeholders. */
export async function writeFixtureMp4(
  path: string,
  { seconds = 2, fps = 30, width = 640, height = 360 } = {},
): Promise<void> {
  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  })
  const source = new EncodedVideoPacketSource('vp9')
  output.addVideoTrack(source, { frameRate: fps })
  await output.start()
  const frames = Math.round(seconds * fps)
  for (let i = 0; i < frames; i++) {
    const packet = new EncodedPacket(
      new Uint8Array([0x82, 0x49, 0x83, 0x42, 0x00, i & 0xff]),
      i === 0 ? 'key' : 'delta',
      i / fps,
      1 / fps,
    )
    await source.add(
      packet,
      i === 0
        ? {
            decoderConfig: {
              codec: 'vp09.00.10.08',
              codedWidth: width,
              codedHeight: height,
            },
          }
        : undefined,
    )
  }
  await output.finalize()
  await writeFile(path, new Uint8Array(target.buffer!))
}

/** A mono 16-bit PCM WAV of the samples `at(t)` gives, in [-1, 1]. */
export async function writeFixtureWav(
  path: string,
  seconds: number,
  at: (t: number) => number,
  sampleRate = 16000,
): Promise<void> {
  const n = Math.round(seconds * sampleRate)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, at(i / sampleRate)))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  await writeFile(path, buf)
}
