import type { VosConfigJson } from '../types/vosConfigJson'
import { mixAudio } from './mix'
import { pcmFromAudioBuffer } from './pcm'
import type { PcmBuffer } from './pcm'
import { planAudio } from './plan'

export interface RenderAudioOptions {
  /** Output seconds (default: `config.duration`). */
  duration?: number
  /** Default 48000. */
  sampleRate?: number
  /** Default 2. */
  channels?: number
  /** Plan resolution in seconds (default 1/240). */
  step?: number
  /**
   * Decode one source URL to PCM. Defaults to `fetch` + Web Audio's
   * `decodeAudioData` where a Web Audio context exists; elsewhere (a Worker
   * without one, Node) pass your own. Return `null` to leave that source
   * silent.
   */
  decode?: (src: string) => Promise<PcmBuffer | null>
}

async function defaultDecode(
  src: string,
  sampleRate: number,
): Promise<PcmBuffer | null> {
  const g = globalThis as unknown as {
    fetch?: typeof fetch
    OfflineAudioContext?: new (
      channels: number,
      length: number,
      sampleRate: number,
    ) => { decodeAudioData(buf: ArrayBuffer): Promise<AudioBuffer> }
  }
  if (
    typeof g.fetch !== 'function' ||
    typeof g.OfflineAudioContext !== 'function'
  ) {
    throw new Error(
      'renderAudio: no audio decoder here (Web Audio is absent). Pass opts.decode.',
    )
  }
  const res = await g.fetch(src)
  if (!res.ok) throw new Error(`renderAudio: ${src} answered ${res.status}`)
  const bytes = await res.arrayBuffer()
  const ctx = new g.OfflineAudioContext(2, 1, sampleRate)
  return pcmFromAudioBuffer(await ctx.decodeAudioData(bytes))
}

/**
 * Render the sound a program plays, offline and deterministically: every
 * `AudioElement`, at the position and gain its timeline drives it to, through
 * `retime`, to `duration`. Plain PCM out; the consumer muxes it beside the
 * captured frames. No DOM, no pixels.
 */
export async function renderAudio(
  config: VosConfigJson,
  opts: RenderAudioOptions = {},
): Promise<PcmBuffer> {
  const sampleRate = opts.sampleRate ?? 48000
  const plan = planAudio(config, { duration: opts.duration, step: opts.step })
  const decode =
    opts.decode ?? ((src: string) => defaultDecode(src, sampleRate))
  const sources = new Map<string, PcmBuffer>()
  const urls = [...new Set(plan.tracks.map((t) => t.src))]
  await Promise.all(
    urls.map(async (src) => {
      const pcm = await decode(src)
      if (pcm) sources.set(src, pcm)
    }),
  )
  return mixAudio(plan, sources, { sampleRate, channels: opts.channels })
}
