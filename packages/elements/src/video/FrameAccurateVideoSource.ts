/**
 * Frame-accurate video source: WebCodecs `VideoDecoder` + mp4box demux.
 *
 * `seekTo(t)` decodes the exact frame at presentation time `t` (deterministically,
 * including B-frames) and draws it to `canvas` — which the caller wraps in a
 * THREE.CanvasTexture. This replaces `HTMLVideoElement.currentTime` sync, which is
 * NOT frame-accurate (audio-clock-backed, keyframe-snaps, async).
 *
 * Validated by the S2 spike (deterministic + ~12ms/seek @1080p). mp4box is loaded
 * from esm.sh at runtime (consistent with vos's CDN addon strategy; keeps the
 * injectable elements bundle lean). Requires a secure context with WebCodecs.
 */
import {
  buildSyncIndices,
  gopBounds,
  targetDecodeIndex,
  type SampleMeta,
} from './sampleIndex'

const MP4BOX_URL = 'https://esm.sh/mp4box@0.5.2'

let mp4boxPromise: Promise<any> | null = null
function loadMp4Box(): Promise<any> {
  if (!mp4boxPromise) {
    mp4boxPromise = import(/* @vite-ignore */ MP4BOX_URL).then((m) => m.default ?? m)
  }
  return mp4boxPromise
}

interface DecodeSample extends SampleMeta {
  chunk: EncodedVideoChunk
}

export function isFrameAccurateSupported(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined'
}

export class FrameAccurateVideoSource {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private decoder!: VideoDecoder
  private samples: DecodeSample[] = [] // DECODE order (as delivered by mp4box)
  private syncIndices: number[] = []
  private onFrame: ((f: VideoFrame) => void) | null = null
  private lastError: unknown = null
  durationSec = 0
  fps = 30
  codedWidth = 0
  codedHeight = 0

  private constructor() {
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
  }

  static async create(src: string): Promise<FrameAccurateVideoSource> {
    const self = new FrameAccurateVideoSource()
    self.decoder = new VideoDecoder({
      output: (f) => self.onFrame?.(f),
      error: (e) => {
        self.lastError = e
        console.error('[vos] VideoDecoder error', e)
      },
    })
    const buf = await fetch(src).then((r) => {
      if (!r.ok) throw new Error(`[vos] failed to fetch video: ${src} (${r.status})`)
      return r.arrayBuffer()
    })
    await self.demux(buf)
    self.canvas.width = self.codedWidth
    self.canvas.height = self.codedHeight
    await self.seekTo(0)
    return self
  }

  private async demux(data: ArrayBuffer): Promise<void> {
    const MP4Box = await loadMp4Box()
    return new Promise<void>((resolve, reject) => {
      const file = MP4Box.createFile()
      file.onError = (e: unknown) => reject(new Error(String(e)))
      file.onReady = (info: any) => {
        const track = info.videoTracks?.[0]
        if (!track) return reject(new Error('[vos] no video track in mp4'))
        this.codedWidth = track.video.width
        this.codedHeight = track.video.height
        this.durationSec = info.duration / info.timescale
        this.fps = track.nb_samples / this.durationSec || 30
        this.decoder.configure({
          codec: track.codec,
          description: this.getDescription(MP4Box, file, track.id),
          codedWidth: this.codedWidth,
          codedHeight: this.codedHeight,
        })
        file.setExtractionOptions(track.id, null, { nbSamples: Infinity })
        file.start()
      }
      file.onSamples = (_id: number, _user: unknown, arr: any[]) => {
        for (const s of arr) {
          this.samples.push({
            cts: s.cts / s.timescale,
            isSync: !!s.is_sync,
            chunk: new EncodedVideoChunk({
              type: s.is_sync ? 'key' : 'delta',
              timestamp: Math.round((s.cts / s.timescale) * 1e6),
              duration: Math.round((s.duration / s.timescale) * 1e6),
              data: s.data,
            }),
          })
        }
      }
      ;(data as any).fileStart = 0
      file.appendBuffer(data)
      file.flush()
      // Keep DECODE order (do NOT sort by cts) — B-frames need decode order.
      queueMicrotask(() => {
        if (!this.samples.length) return reject(new Error('[vos] no samples extracted'))
        this.syncIndices = buildSyncIndices(this.samples)
        resolve()
      })
    })
  }

  private getDescription(MP4Box: any, file: any, trackId: number): Uint8Array {
    const trak = file.getTrackById(trackId)
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C
      if (box) {
        const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN)
        box.write(stream)
        return new Uint8Array(stream.buffer, 8) // strip 8-byte box header
      }
    }
    throw new Error('[vos] no codec description (avcC/hvcC/vpcC/av1C) found')
  }

  /**
   * Decode the exact frame at presentation time `t` and draw it to `canvas`.
   * Decodes the whole GOP (keyframe → next keyframe) in decode order, then
   * selects the output by PTS. Returns when the canvas is updated.
   */
  async seekTo(tSec: number): Promise<void> {
    if (!this.samples.length) return
    const targetDI = targetDecodeIndex(this.samples, tSec)
    const [ki, ni] = gopBounds(this.syncIndices, this.samples.length, targetDI)
    const targetTs = Math.round(this.samples[targetDI].cts * 1e6)

    this.lastError = null
    const collected: VideoFrame[] = []
    this.onFrame = (f) => collected.push(f)
    for (let i = ki; i < ni; i++) this.decoder.decode(this.samples[i].chunk)
    await this.decoder.flush()
    this.onFrame = null
    if (this.lastError) throw this.lastError

    let best: VideoFrame | undefined
    let bestD = Infinity
    for (const f of collected) {
      const d = Math.abs(f.timestamp - targetTs)
      if (d < bestD) {
        bestD = d
        best = f
      }
    }
    if (best) this.ctx.drawImage(best, 0, 0)
    for (const f of collected) f.close()
  }

  dispose(): void {
    try {
      this.decoder.close()
    } catch {
      // already closed
    }
  }
}
