/**
 * `vos audio measure`: every clip's file read by the BS.1770 meter and the
 * measurement written beside it, the fact a `normalize` target plays the
 * clip to. A tone of known level measures where the standard says.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import { cmdAudio, measureDocAudio } from '../audio'
import { lintDoc } from '../validateDoc'
import { writeFixtureWav } from './fixtureMedia'
import type { AudioClip, ProjectDoc } from '@vosjs/studio-core'

let root: string
let toneBytes: Buffer
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vos-audio-'))
  // A 997 Hz sine at 0.1 of full scale: -20 dBFS peak, and -23.0 LUFS (a
  // full-scale sine reads -3.01).
  const tone = join(root, 'tone.wav')
  await writeFixtureWav(
    tone,
    4,
    (t) => 0.1 * Math.sin(2 * Math.PI * 997 * t),
    48000,
  )
  toneBytes = await readFile(tone)
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterAll(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

const clip = (id: string, key: string, over: Partial<AudioClip> = {}) =>
  ({
    id,
    key,
    name: id,
    start: 0,
    in: 0,
    out: 4,
    duration: 4,
    gain: 0.5,
    fadeIn: 0,
    fadeOut: 0,
    ...over,
  }) as AudioClip

async function writeTake(name: string, audio: AudioClip[]): Promise<string> {
  const dir = join(root, name)
  await mkdir(join(dir, 'music'), { recursive: true })
  await writeFile(join(dir, 'music', 'tone.wav'), toneBytes)
  const meta = {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs: 4000,
    width: 1280,
    height: 720,
    fps: 30,
  }
  const doc: ProjectDoc = {
    source: { videoKey: 'recording.webm', cursor: [], meta },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio,
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
  }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta))
  await writeFile(join(dir, 'doc.json'), JSON.stringify(doc))
  return dir
}

const readDoc = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'doc.json'), 'utf8')) as ProjectDoc

describe('vos audio measure', () => {
  it('measures a tone where BS.1770 puts it, and plays its target', async () => {
    const dir = await writeTake('tone', [
      clip('score', 'music/tone.wav', { normalize: -16 }),
    ])
    // Unmeasured, the target is ignored and said.
    expect(lintDoc(await readDoc(dir)).warnings).toContainEqual(
      expect.stringMatching(
        /audio score: normalize -16 is ignored until the clip is measured.*vos audio measure <take>/,
      ),
    )
    expect(await cmdAudio(['measure', dir])).toBe(0)
    const [c] = (await readDoc(dir)).audio
    expect(c.loudness?.src).toBe('music/tone.wav')
    expect(c.loudness!.lufs).toBeGreaterThan(-23.3)
    expect(c.loudness!.lufs).toBeLessThan(-22.7)
    expect(c.loudness!.peakDb).toBeCloseTo(-20, 0)
    expect(Date.parse(c.loudness!.at)).not.toBeNaN()
    expect(lintDoc(await readDoc(dir)).warnings).not.toContainEqual(
      expect.stringMatching(/audio score: normalize/),
    )
  })

  it('reads a URL, says what is not on this disk, measures a key once', async () => {
    const dir = await writeTake('mixed', [])
    const audio = [
      clip('a', 'music/tone.wav'),
      clip('b', 'music/tone.wav', { start: 1 }),
      clip('c', 'https://assets.example/music/tone.wav'),
      clip('d', '/api/assets/0f8fad5b/file'),
      clip('e', '../outside.wav'),
    ]
    const measured: string[] = []
    const fetched: string[] = []
    const { clips, failed } = await measureDocAudio(dir, audio, {
      measure: async (path) => {
        measured.push(path)
        return { lufs: -18, peakDb: -4 }
      },
      fetchImpl: (async (url: string) => {
        fetched.push(String(url))
        return new Response(new Uint8Array(toneBytes))
      }) as unknown as typeof fetch,
    })
    expect(failed).toEqual([])
    expect(fetched).toEqual(['https://assets.example/music/tone.wav'])
    expect(measured).toHaveLength(2)
    expect(audio.map((a) => a.loudness?.src ?? null)).toEqual([
      'music/tone.wav',
      'music/tone.wav',
      'https://assets.example/music/tone.wav',
      null,
      null,
    ])
    expect(clips[3].skipped).toMatch(/not on this disk.*vos pull --media/)
    expect(clips[4].skipped).toMatch(/outside\.wav/)
  })

  it('names a stale measurement, and a target the peak holds back', async () => {
    const stale = await writeTake('stale', [
      clip('score', 'music/tone.wav', {
        normalize: -16,
        loudness: { lufs: -30, peakDb: -12, at: '2026-10-01', src: 'old.wav' },
      }),
    ])
    expect(lintDoc(await readDoc(stale)).warnings).toContainEqual(
      expect.stringMatching(
        /audio score: normalize -16 is ignored until the clip is measured \(its loudness was measured for old\.wav, not music\/tone\.wav\)/,
      ),
    )
    const held = await writeTake('held', [
      clip('score', 'music/tone.wav', {
        gain: 1,
        normalize: -6,
        loudness: {
          lufs: -23,
          peakDb: -10,
          at: '2026-10-01',
          src: 'music/tone.wav',
        },
      }),
    ])
    const lint = lintDoc(await readDoc(held))
    expect(lint.problems).toEqual([])
    expect(lint.warnings).toContainEqual(
      expect.stringMatching(
        /audio score: normalize -6 asks for gain 7\.08, held at 2\.82 so the file's peak stays under -1 dBFS; it plays 8\.0 dB under its target/,
      ),
    )
  })

  it('refuses a target out of range and a hand-written measurement', async () => {
    const dir = await writeTake('bad', [
      clip('a', 'music/tone.wav', { normalize: -3 }),
      clip('b', 'music/tone.wav', {
        loudness: { lufs: 'loud' } as unknown as AudioClip['loudness'],
      }),
    ])
    const { problems } = lintDoc(await readDoc(dir))
    expect(problems).toContainEqual(
      'audio a: normalize is a target loudness in LUFS, -30..-6 (e.g. -16; got -3)',
    )
    expect(problems).toContainEqual(
      expect.stringMatching(/audio b: loudness is a measurement/),
    )
  })
})
