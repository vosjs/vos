/**
 * The sound a program document adds, for a LOCAL render of the program.
 *
 * A composed program carries its `doc.audio` clips on the studio stack entry,
 * exactly as a take does, and the capture page mixes them through the same
 * producer a take render uses. The one difference is WHERE the bytes are: a
 * capture page has no origin of its own, so a clip keyed by a file beside the
 * document (`score.ogg`) or by a hosted asset path (`/api/assets/…`) cannot be
 * fetched from inside it. Each is inlined as a `data:` URI here: a local file
 * read from disk, a hosted asset downloaded with the caller's credential.
 * A clip that cannot be reached is left out and said, never a silent track.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { audioProducerCode, studioEntryData } from '@vosjs/render-core'
import { studioAudioPlan } from '@vosjs/studio-core'
import { MEDIA_HEAD_BYTES, resolveMediaType } from './plugin/container'
import type { EnvelopePoint, LoweredAudioClip } from '@vosjs/studio-core'

export interface ProgramAudioOptions {
  /** The directory the document's relative keys are read against. */
  baseDir: string
  /** The output length the mix is cut to, seconds. */
  duration: number
  /** For a clip keyed by a hosted asset: where it lives and who may read it. */
  origin?: string
  key?: string | null
  log: (line: string) => void
}

export interface ProgramAudio {
  producerCode: string
  clips: number
}

function dataUri(bytes: Uint8Array, filename: string): string {
  const { type } = resolveMediaType({
    head: bytes.subarray(0, MEDIA_HEAD_BYTES),
    filename,
  })
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
}

async function reach(
  clipKey: string,
  opts: ProgramAudioOptions,
): Promise<string | null> {
  if (/^(data:|https?:)/.test(clipKey)) return clipKey
  if (clipKey.startsWith('/api/')) {
    if (!opts.origin || !opts.key) {
      opts.log(
        `note: sound ${clipKey} is a hosted asset and no credential is set, so the render leaves it out (vos login, or keep the file beside the document)`,
      )
      return null
    }
    const res = await fetch(`${opts.origin}${clipKey}`, {
      headers: { authorization: `Bearer ${opts.key}` },
    })
    if (!res.ok) {
      opts.log(
        `note: sound ${clipKey} could not be read (${res.status}), so the render leaves it out`,
      )
      return null
    }
    return dataUri(new Uint8Array(await res.arrayBuffer()), clipKey)
  }
  const file = join(opts.baseDir, clipKey.replace(/^\/+/, ''))
  if (!existsSync(file)) {
    opts.log(
      `note: sound ${clipKey} is not beside the document, so the render leaves it out`,
    )
    return null
  }
  return dataUri(new Uint8Array(await readFile(file)), file)
}

/** The producer for a composed program's sound, or null when it adds none. */
export async function programAudio(
  config: Record<string, unknown>,
  opts: ProgramAudioOptions,
): Promise<ProgramAudio | null> {
  const entry = studioEntryData(config.stack)
  const clips = Array.isArray(entry?.audio)
    ? (entry.audio as LoweredAudioClip[])
    : []
  if (!clips.length) return null
  const reached: LoweredAudioClip[] = []
  for (const clip of clips) {
    const key = await reach(clip.key, opts)
    if (key) reached.push({ ...clip, key })
  }
  if (!reached.length) return null
  const duckEnv = Array.isArray(entry?.duckEnv)
    ? (entry.duckEnv as EnvelopePoint[])
    : []
  const plan = studioAudioPlan(reached, duckEnv, opts.duration)
  return {
    producerCode: audioProducerCode({ plan }),
    clips: reached.length,
  }
}
