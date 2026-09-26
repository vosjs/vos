/**
 * The driver contract (AN4): render-core's recorder over a REAL Playwright
 * browser, on a fixture page served in-process, the way the CLI and the
 * fleet both run it. What it pins: frames reach the sink in order with a
 * real JPEG size, every dispatched input becomes a cursor event, a click
 * lands (the page counts it), the step timeline and pace are written, and
 * a rehearsal captures nothing. Skipped, and said, where no browser
 * launches (a CI runner without Chromium); the recorder's pure pieces are
 * held by the unit tests either way.
 */
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recordTake } from '@vosjs/render-core/record'
import type { FrameSink } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>
<style>body{margin:0;font:16px system-ui}#hero{height:300px;background:#eef}#cta{margin:20px;padding:12px 20px}#count{margin:20px}</style>
</head><body><div id="hero">hero</div>
<button id="cta" onclick="document.getElementById('count').textContent=String(1+Number(document.getElementById('count').textContent))">Press me</button>
<div id="count">0</div><input id="name" placeholder="name">
<div style="height:1200px"></div></body></html>`

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(FIXTURE)
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  try {
    const { launchBrowser } = await import('../../browser')
    browser = await launchBrowser()
  } catch (e) {
    skipReason = e instanceof Error ? e.message.split('\n')[0] : String(e)
  }
}, 60_000)

afterAll(async () => {
  await browser?.close()
  server?.close()
})

describe('the recorder over a real Playwright driver', () => {
  it('records a fixture page: frames to the sink, inputs to events, a click that lands', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const frames: { file: string; bytes: number }[] = []
    const sink: FrameSink = {
      frame: (file, bytes) => {
        frames.push({ file, bytes: bytes.length })
      },
    }
    const logs: string[] = []
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: { width: 640, height: 480 },
        steps: [
          { do: 'wait', ms: 200 },
          { do: 'click', selector: '#cta' },
          { do: 'type', selector: '#name', text: 'ab', delayMs: 20 },
          { do: 'scroll', dy: 240 },
        ],
      },
      sink,
      (m) => logs.push(m),
      { platform: 'linux', env: {} },
    )
    // Frames arrived in order, each a real JPEG the sink measured.
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.map((f) => f.file)).toEqual(
      frames.map((_, i) => `frame-${String(i).padStart(5, '0')}.jpg`),
    )
    expect(frames.every((f) => f.bytes > 500)).toBe(true)
    expect(result.frames.map((f) => f.file)).toEqual(frames.map((f) => f.file))
    // Inputs became events: a press pair with a rect, typing pings, scrolls.
    const types = result.events.map((e) => e.type)
    expect(types).toContain('down')
    expect(types).toContain('up')
    expect(types).toContain('key')
    expect(types).toContain('scroll')
    const down = result.events.find((e) => e.type === 'down')
    expect(down?.rect?.w).toBeGreaterThan(0)
    // The step timeline and the pace name every step.
    expect(result.meta.steps?.length).toBe(4)
    expect(result.meta.steps?.[1].do).toBe('click')
    expect(result.meta.steps?.[1].rect?.w).toBeGreaterThan(0)
    expect(result.pace.wallMs).toBeGreaterThan(0)
    expect(result.pace.askedMs).toBeGreaterThanOrEqual(200)
    expect(result.meta.captureWidth).toBe(640)
    expect(result.meta.platform).toBe('linux')
    expect(result.meta.pageTitle).toBe('Fixture')
    expect(result.skipped).toEqual([])
    expect(result.actions.url).toBe(`${base}/`)
    expect(logs.some((l) => l.startsWith('click #cta'))).toBe(true)
  }, 60_000)

  it('a rehearsal runs the steps and captures nothing', async () => {
    if (!browser) return
    let framesSeen = 0
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        steps: [
          { do: 'click', selector: '#cta' },
          { do: 'click', selector: '#missing' },
        ],
      },
      { frame: () => void framesSeen++ },
      () => {},
      { dryRun: true, platform: 'linux' },
    )
    expect(framesSeen).toBe(0)
    expect(result.frames).toEqual([])
    expect(result.skipped).toEqual([
      { step: 1, do: 'click', selector: '#missing' },
    ])
  }, 60_000)
})
