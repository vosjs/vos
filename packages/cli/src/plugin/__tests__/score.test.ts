import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import {
  SCORE_ID,
  cmdScore,
  findSwell,
  levelCurve,
  measureTrack,
  planScore,
  resolveAt,
} from '../score'
import { writeFixtureWav } from './fixtureMedia'
import type { ProjectDoc } from '@vosjs/studio-core'

let root: string
let track: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vos-score-'))
  // Twenty seconds: a quiet bar, a build from 6 to 8 s, the swell held to
  // 14 s, quiet again. The swell ARRIVES at 8 s.
  track = join(root, 'track.wav')
  const amp = (t: number) =>
    t < 6 ? 0.03 : t < 8 ? 0.03 + ((t - 6) / 2) * 0.57 : t < 14 ? 0.6 : 0.03
  await writeFixtureWav(
    track,
    20,
    (t) => amp(t) * Math.sin(2 * Math.PI * 440 * t),
  )
})
afterAll(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

/** A take of 10 s footage trimmed to 6 s of film, with one step. */
async function writeTake(name: string): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const meta = {
    dpr: 1,
    zoom: 1,
    t0: 0,
    durationMs: 10000,
    width: 1280,
    height: 720,
    fps: 30,
    steps: [{ step: 0, id: 'payoff', do: 'click', tStart: 5, tEnd: 5.5 }],
  }
  const doc: ProjectDoc = {
    source: { videoKey: 'recording.webm', cursor: [], meta },
    segments: [
      { in: 0, out: 2 },
      { in: 4, out: 8 },
    ],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta))
  await writeFile(join(dir, 'doc.json'), JSON.stringify(doc))
  return dir
}

const readDoc = async (dir: string) =>
  JSON.parse(await readFile(join(dir, 'doc.json'), 'utf8')) as ProjectDoc

describe('the loudness envelope', () => {
  it('finds the swell where it arrives, K-weighted', async () => {
    const m = await measureTrack(track)
    expect(m.via).toBe('node')
    expect(m.unit).toBe('LUFS')
    expect(m.duration).toBeCloseTo(20, 2)
    const curve = levelCurve(m.blocks, m.unit)
    const swell = findSwell(curve)!
    expect(swell.at).toBeCloseTo(8, 0)
    expect(Math.abs(swell.at - 8)).toBeLessThanOrEqual(0.5)
    expect(swell.rise).toBeGreaterThan(20)
    expect(swell.from).toBeLessThan(6.5)
  })
})

describe('a track that fades in from silence', () => {
  it('is starting, not swelling: the later swell wins', async () => {
    // 0..4 s a fade in from silence, a steady bed to 20 s, a build to 22 s,
    // held to 30 s, the bed again to 40 s.
    const path = join(root, 'fade-in.wav')
    const amp = (t: number) =>
      t < 4
        ? (t / 4) * 0.15
        : t < 20
          ? 0.15
          : t < 22
            ? 0.15 + ((t - 20) / 2) * 0.45
            : t < 30
              ? 0.6
              : 0.15
    await writeFixtureWav(
      path,
      40,
      (t) => amp(t) * Math.sin(2 * Math.PI * 440 * t),
    )
    const m = await measureTrack(path)
    const swell = findSwell(levelCurve(m.blocks, m.unit))!
    expect(Math.abs(swell.at - 22)).toBeLessThanOrEqual(0.75)
    expect(swell.from).toBeGreaterThan(5)
    expect(swell.rise).toBeGreaterThan(8)
    expect(swell.rise).toBeLessThan(16)
  })
})

describe('planScore', () => {
  const curve = [
    { t: 0.5, level: -40 },
    { t: 1, level: -20 },
  ]
  const swell = { at: 8, from: 5, peak: 8.5, rise: 25, peakLevel: -8 }
  it('offsets the track so the swell lands where asked, and covers the film', () => {
    expect(
      planScore({ trackDuration: 20, film: 6, curve, swell, at: 2 }),
    ).toEqual({
      in: 6,
      out: 12,
      swellAt: 2,
      notes: [],
    })
  })
  it('says what it cannot have', () => {
    const early = planScore({
      trackDuration: 20,
      film: 6,
      curve,
      swell,
      at: 10,
    })
    expect(early.in).toBe(0)
    expect(early.notes[0]).toMatch(/comes before 10\.0s of film/)
    const late = planScore({ trackDuration: 10, film: 6, curve, swell, at: 1 })
    expect(late).toMatchObject({ in: 4, out: 10, swellAt: 4 })
    expect(late.notes[0]).toMatch(/ends before the film does/)
    const short = planScore({
      trackDuration: 4,
      film: 6,
      curve,
      swell: null,
      at: null,
    })
    expect(short).toMatchObject({ in: 0, out: 4 })
    expect(short.notes[0]).toMatch(/cannot cover it/)
  })
})

describe('vos score', () => {
  beforeAll(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  it('--dry-run picks the offset and leaves doc.json alone', async () => {
    const dir = await writeTake('dry')
    const out: string[] = []
    ;(
      process.stdout.write as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation((s: string) => {
      out.push(String(s))
      return true
    })
    expect(
      await cmdScore([
        dir,
        '--track',
        track,
        '--at',
        '2',
        '--dry-run',
        '--json',
      ]),
    ).toBe(0)
    const done = out
      .flatMap((l) => l.split('\n'))
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((e) => e.event === 'done') as {
      clip: { in: number; out: number; key: string }
      film: number
    }
    expect(done.film).toBe(6)
    expect(Math.abs(done.clip.in - 6)).toBeLessThanOrEqual(0.5)
    expect(done.clip.out - done.clip.in).toBeCloseTo(6, 6)
    expect((await readDoc(dir)).audio).toEqual([])
  })

  it('writes one score clip, landing the swell on a step', async () => {
    const dir = await writeTake('wet')
    // Step `payoff` at source 5 plays at 2 + 1 = 3 s of film.
    expect(resolveAt(await readDoc(dir), 'payoff')).toEqual({
      at: 3,
      via: 'step payoff (3.00s)',
    })
    expect(
      await cmdScore([
        dir,
        '--track',
        track,
        '--at',
        'payoff',
        '--gain',
        '0.4',
      ]),
    ).toBe(0)
    const clips = (await readDoc(dir)).audio
    expect(clips).toHaveLength(1)
    const c = clips[0]
    expect(c).toMatchObject({
      id: SCORE_ID,
      key: 'music/track.wav',
      start: 0,
      gain: 0.4,
      fadeIn: 0.8,
      fadeOut: 1.5,
    })
    expect(Math.abs(c.in - 5)).toBeLessThanOrEqual(0.5)
    expect(c.out - c.in).toBeCloseTo(6, 6)
    // `--fade-in` sets the opening fade, 0 for a cut.
    expect(
      await cmdScore([
        dir,
        '--track',
        track,
        '--at',
        'payoff',
        '--fade-in',
        '0',
      ]),
    ).toBe(0)
    expect((await readDoc(dir)).audio[0].fadeIn).toBe(0)
    // A second run replaces it.
    expect(await cmdScore([dir, '--track', track])).toBe(0)
    const again = (await readDoc(dir)).audio
    expect(again).toHaveLength(1)
    // Without --at: from its first rise above the median level.
    expect(again[0].in).toBeGreaterThan(5)
    expect(again[0].in).toBeLessThan(8)
  })

  it('carries the track’s loudness and a -16 LUFS target, unless --normalize says', async () => {
    const dir = await writeTake('level')
    expect(await cmdScore([dir, '--track', track])).toBe(0)
    const [c] = (await readDoc(dir)).audio
    expect(c.normalize).toBe(-16)
    expect(c.gain).toBe(0.5)
    expect(c.loudness?.src).toBe(c.key)
    expect(c.loudness!.lufs).toBeLessThan(-6)
    expect(c.loudness!.lufs).toBeGreaterThan(-30)
    // The swell peaks at 0.6 of full scale.
    expect(c.loudness!.peakDb).toBeCloseTo(20 * Math.log10(0.6), 0)
    expect(await cmdScore([dir, '--track', track, '--normalize', '-20'])).toBe(
      0,
    )
    expect((await readDoc(dir)).audio[0].normalize).toBe(-20)
    expect(await cmdScore([dir, '--track', track, '--normalize', 'off'])).toBe(
      0,
    )
    const off = (await readDoc(dir)).audio[0]
    expect(off).not.toHaveProperty('normalize')
    expect(off.loudness?.src).toBe(off.key)
    await expect(
      cmdScore([dir, '--track', track, '--normalize', '-3']),
    ).rejects.toThrow(/--normalize expects LUFS from -30 to -6/)
  })
})
