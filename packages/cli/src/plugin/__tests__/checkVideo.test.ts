/**
 * `vos check-video` over files made here: two hard cuts inside 5 s, a
 * silent sound track, a fade-in from black, and a clean control. Skipped,
 * and said, where no browser launches; the decisions themselves are held
 * by videoChecks.test.ts either way.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeBrowser } from './closeBrowser'
import { checkVideo } from '../checkVideo'
import { makeFixtureVideo } from './videoFixture'
import type { FixtureSpec } from './videoFixture'
import type { Browser } from 'playwright'

let browser: Browser | null = null
let skipReason = ''
let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vos-check-video-'))
  try {
    const { launchBrowser } = await import('../../browser')
    browser = await launchBrowser()
  } catch (e) {
    skipReason = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
}, 60_000)

afterAll(async () => {
  await closeBrowser(browser)
  if (dir) await rm(dir, { recursive: true, force: true })
}, 30_000)

const base = (over: Partial<FixtureSpec>): FixtureSpec => ({
  width: 160,
  height: 90,
  fps: 15,
  seconds: 6,
  scenes: [{ at: 0, kind: 'busy', color: '#3a7bd5' }],
  tone: { amplitude: 0.1 },
  ...over,
})

async function check(name: string, spec: FixtureSpec) {
  const file = join(dir, `${name}.webm`)
  await writeFile(file, await makeFixtureVideo(browser!, spec))
  return checkVideo(browser!, file, join(dir, `${name}-check`))
}

describe('vos check-video', () => {
  it('reads a clean file: its facts, no cut, a measured loudness, two posters', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const r = await check('clean', base({}))
    expect(r.width).toBe(160)
    expect(r.height).toBe(90)
    expect(r.duration).toBeGreaterThan(5.5)
    expect(r.duration).toBeLessThan(6.5)
    expect(r.fps).toBeGreaterThan(14)
    expect(r.fps).toBeLessThan(16)
    expect(r.video.codec).toBe('vp9')
    expect(r.audio?.codec).toBe('opus')
    expect(r.scenes.changes).toEqual([])
    // A sine of amplitude 0.1 on both channels: about -20 LUFS.
    expect(r.loudness?.integrated).toBeGreaterThan(-21.5)
    expect(r.loudness?.integrated).toBeLessThan(-18.5)
    expect(r.loudness?.shortTerm.length).toBe(2)
    expect(r.posters.first.uniform).toBe(false)
    expect(r.posters.last.uniform).toBe(false)
    expect(existsSync(r.posters.first.file)).toBe(true)
    expect(existsSync(r.posters.last.file)).toBe(true)
    expect(existsSync(join(r.outDir, 'check.json'))).toBe(true)
    expect(r.warnings).toEqual([])
  }, 120_000)

  it('warns on two hard cuts inside one 5 s window', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const r = await check(
      'cuts',
      base({
        scenes: [
          { at: 0, kind: 'busy', color: '#3a7bd5' },
          { at: 1.5, kind: 'solid', color: '#f5d742' },
          { at: 3, kind: 'busy', color: '#d53a3a' },
        ],
      }),
    )
    expect(r.scenes.changes.map((c) => c.time)).toEqual([1.53, 3])
    expect(r.scenes.perWindow).toEqual([
      { start: 0, count: 2 },
      { start: 5, count: 0 },
    ])
    expect(
      r.warnings.some((w) => /2 full-frame changes within 5 s/.test(w)),
    ).toBe(true)
  }, 120_000)

  it('counts no cut in a pan, where every frame moves the whole picture', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const r = await check(
      'pan',
      base({ scenes: [{ at: 0, kind: 'busy', color: '#3a7bd5', pan: 90 }] }),
    )
    expect(r.scenes.changes).toEqual([])
    expect(r.warnings).toEqual([])
  }, 120_000)

  it('counts no cut in a fast zoom easing in on a still page', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const r = await check(
      'zoom-ramp',
      base({
        width: 320,
        height: 180,
        fps: 60,
        tone: undefined,
        scenes: [
          { at: 0, kind: 'page', color: '#f7f7f5' },
          {
            at: 2,
            kind: 'page',
            color: '#f7f7f5',
            zoom: { to: 1.5, over: 0.4 },
          },
        ],
      }),
    )
    expect(r.scenes.changes).toEqual([])
    expect(r.warnings).toEqual([])
  }, 120_000)

  it('counts one cut where the camera jumps in one frame between two views of a sparse picture', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const r = await check(
      'scale-jump',
      base({
        width: 320,
        height: 180,
        fps: 60,
        tone: undefined,
        scenes: [
          { at: 0, kind: 'sparse', color: '#101114', scale: 2.5 },
          { at: 3, kind: 'sparse', color: '#101114' },
        ],
      }),
    )
    // Little of a dark picture changes on average, and it is a cut.
    expect(r.scenes.changes).toHaveLength(1)
    expect(r.scenes.changes[0].time).toBeCloseTo(3, 1)
    expect(r.scenes.changes[0].change).toBeLessThan(0.12)
    expect(r.warnings).toEqual([])
  }, 120_000)

  it('warns on a silent sound track', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const r = await check('silent', base({ tone: { amplitude: 0 } }))
    expect(r.audio).not.toBeNull()
    expect(r.loudness?.integrated).toBeNull()
    expect(r.warnings.some((w) => /silent/.test(w))).toBe(true)
  }, 120_000)

  it('warns on a quiet one, and says nothing of sound for a file without any', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const quiet = await check('quiet', base({ tone: { amplitude: 0.01 } }))
    expect(quiet.loudness?.integrated).toBeLessThan(-23)
    expect(quiet.warnings.some((w) => /too quiet/.test(w))).toBe(true)
    const mute = await check('mute', base({ tone: undefined }))
    expect(mute.audio).toBeNull()
    expect(mute.loudness).toBeNull()
    expect(mute.warnings).toEqual([])
  }, 120_000)

  it('warns when the first frame is near-uniform', async () => {
    if (!browser) return console.warn(`skipped: no browser (${skipReason})`)
    const r = await check(
      'black-open',
      base({
        scenes: [
          { at: 0, kind: 'solid', color: '#000' },
          { at: 0.2, kind: 'busy', color: '#3a7bd5' },
        ],
      }),
    )
    expect(r.posters.first.uniform).toBe(true)
    expect(r.posters.first.deviation).toBeLessThan(2)
    expect(r.posters.last.uniform).toBe(false)
    expect(r.warnings.some((w) => /first frame is near-uniform/.test(w))).toBe(
      true,
    )
  }, 120_000)
})
