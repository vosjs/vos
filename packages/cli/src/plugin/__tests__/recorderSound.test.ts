/**
 * The sound a page plays during a take: a media element heard mid-take is
 * noted with its footage stretch, its file is fetched into the take, and a
 * fresh plan places it as an audio clip under the footage it was heard
 * over; a muted video adds nothing. Over a REAL Playwright browser on a
 * fixture page served in-process. Skipped, and said, where no browser
 * launches.
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { planFreshTake, recordTake } from '@vosjs/render-core/record'
import type { FrameSink } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'
import { pageSoundSink } from '../recorder'
import { writeFixtureWav } from './fixtureMedia'
import { makeFixtureVideo } from './videoFixture'

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Voices</title>
<style>body{margin:0;font:16px system-ui}button{margin:24px;padding:12px 18px}</style>
</head><body>
<button id="play" onclick="var a = new Audio('/tone.wav?sig=abc'); a.play(); setTimeout(function(){ a.pause() }, 1500)">Preview voice</button>
<video id="bg" src="/loop.webm" muted autoplay loop width="160" height="90"></video>
</body></html>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''
let tone: Buffer = Buffer.alloc(0)
let loop: Buffer = Buffer.alloc(0)

beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vos-sound-'))
  await writeFixtureWav(
    join(dir, 'tone.wav'),
    3,
    (t) => 0.3 * Math.sin(2 * Math.PI * 440 * t),
  )
  tone = await readFile(join(dir, 'tone.wav'))
  try {
    const { launchBrowser } = await import('../../browser')
    browser = await launchBrowser()
    loop = await makeFixtureVideo(browser, {
      width: 160,
      height: 90,
      fps: 10,
      seconds: 2,
      scenes: [{ at: 0, kind: 'solid', color: '#3a6' }],
      tone: { amplitude: 0.3 },
    })
  } catch (e) {
    skipReason = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
  server = createServer((req, res) => {
    if (req.url?.startsWith('/tone.wav')) {
      res.writeHead(200, {
        'content-type': 'audio/wav',
        'accept-ranges': 'none',
      })
      res.end(tone)
      return
    }
    if (req.url === '/loop.webm') {
      res.writeHead(200, { 'content-type': 'video/webm' })
      res.end(loop)
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
}, 120_000)

afterAll(async () => {
  await browser?.close()
  server?.close()
}, 30_000)

const sink: FrameSink = { frame: () => {} }

describe('sound the page plays', () => {
  it('is noted, kept in the take, and placed as a clip; a muted video adds nothing', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const dir = await mkdtemp(join(tmpdir(), 'vos-sound-take-'))
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: { width: 640, height: 360 },
        steps: [
          { do: 'wait', ms: 800 },
          { id: 'voice', do: 'click', selector: '#play' },
          { do: 'wait', ms: 2500 },
        ],
      },
      sink,
      () => {},
      { env: {}, sounds: pageSoundSink(dir) },
    )
    const media = result.meta.media ?? []
    const voice = media.find((m) => m.tag === 'audio')
    expect(voice).toBeDefined()
    // Origin and path only: the query a signed URL rides on is not kept.
    expect(voice!.src).toBe(`${base}/tone.wav`)
    expect(voice!.step).toBe(1)
    expect(voice!.intervals).toHaveLength(1)
    const iv = voice!.intervals[0]
    const click = result.meta.steps!.find((s) => s.id === 'voice')!
    // Heard from the press, from the file's start, for about 1.5 s.
    expect(iv.at).toBeGreaterThanOrEqual(click.tStart)
    expect(iv.at).toBeLessThan(click.tEnd + 0.5)
    expect(iv.from).toBeLessThan(0.2)
    expect(iv.to - iv.from).toBeGreaterThan(1.2)
    expect(iv.to - iv.from).toBeLessThan(1.8)
    // The file the page fetched, in the take.
    expect(voice!.file).toBe('page-sound/tone.wav')
    expect(existsSync(join(dir, 'page-sound', 'tone.wav'))).toBe(true)
    expect(await readFile(join(dir, 'page-sound', 'tone.wav'))).toEqual(tone)
    // The muted background video played and was never heard.
    const bg = media.find((m) => m.tag === 'video')
    expect(bg?.muted).toBe(true)
    expect(bg?.intervals).toEqual([])

    const doc = planFreshTake(
      { videoKey: 'recording.webm', cursor: result.events, meta: result.meta },
      'recording.webm',
    )
    const clips = doc.audio.filter((a) => a.source === 'page')
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({
      key: 'page-sound/tone.wav',
      in: iv.from,
      out: iv.to,
      source: 'page',
    })
    // No auto speed runs over what the page was saying, and with nothing
    // sped up before it the clip sits at the footage moment itself.
    const over = (doc.speed ?? []).filter(
      (s) => s.in < iv.at + (iv.to - iv.from) && iv.at < s.out,
    )
    expect(over).toEqual([])
    if (!(doc.speed ?? []).some((s) => s.in < iv.at))
      expect(clips[0].start).toBeCloseTo(iv.at, 2)
    else expect(clips[0].start).toBeLessThan(iv.at)
  }, 60_000)

  it('is noted on a recorder with nowhere to keep a file, and placed as nothing', async () => {
    if (!browser) return
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: { width: 640, height: 360 },
        steps: [
          { do: 'click', selector: '#play' },
          { do: 'wait', ms: 1800 },
        ],
      },
      sink,
      () => {},
      { env: {} },
    )
    const voice = (result.meta.media ?? []).find((m) => m.tag === 'audio')
    expect(voice?.intervals).toHaveLength(1)
    expect(voice?.file).toBeUndefined()
    const doc = planFreshTake(
      { videoKey: 'recording.webm', cursor: result.events, meta: result.meta },
      'recording.webm',
    )
    expect(doc.audio).toEqual([])
  }, 60_000)
})
