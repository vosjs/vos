/**
 * The recorder's checks, waits, downloads and guards, over a REAL Playwright
 * browser on a fixture page served in-process (the driver contract's own
 * harness): an `expect` that never holds and a click on a disabled control
 * are reported, a guarded step is hovered in a rehearsal, refused unnamed
 * and pressed when confirmed, an `await` waits off camera so the footage
 * has no gap, and a `download` keeps a file by a download link and by a
 * media element's source. Skipped, and said, where no browser launches.
 */
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RecordRefusedError,
  planFreshTake,
  recordTake,
} from '@vosjs/render-core/record'
import type { FrameSink, OutputSink } from '@vosjs/render-core/record'
import type { Browser } from 'playwright'
import type { Server } from 'node:http'

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Steps</title>
<style>
body{margin:0;font:16px system-ui}button,a{display:inline-block;margin:12px;padding:10px 16px}
#spin{display:none;width:40px;height:40px;background:#c33;animation:spin .4s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>
<button id="gen" disabled>Generate video</button>
<button id="buy" onclick="var b=document.getElementById('bought');b.textContent=String(1+Number(b.textContent))">Buy</button>
<span id="bought">0</span>
<button id="start" onclick="document.getElementById('spin').style.display='block';setTimeout(function(){document.getElementById('spin').style.display='none';var r=document.createElement('div');r.id='result';r.textContent='Your video is ready';document.body.appendChild(r)},4000)">Start</button>
<div id="spin"></div>
<a id="dl" href="/report">Export CSV</a>
<video id="v" src="/clip.webm" preload="auto" muted></video>
</body></html>`

const CSV = 'name,count\nalpha,1\nbeta,2\n'
const CLIP = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8])

let server: Server | undefined
let base = ''
let browser: Browser | null = null
let skipReason = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/report') {
      res.writeHead(200, {
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="report.csv"',
      })
      res.end(CSV)
      return
    }
    if (req.url === '/clip.webm') {
      res.writeHead(200, { 'content-type': 'video/webm' })
      res.end(Buffer.from(CLIP))
      return
    }
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
}, 30_000)

function frameSink(): FrameSink & { count: number } {
  const sink = {
    count: 0,
    frame: () => {
      sink.count++
    },
  }
  return sink
}

const VIEWPORT = { width: 640, height: 480 }

describe('expect, and a click on a disabled control', () => {
  it('reports an expect that never held, with its reason, and the disabled click', async () => {
    if (!browser) {
      console.warn(`skipped: no browser (${skipReason})`)
      return
    }
    const logs: string[] = []
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: VIEWPORT,
        steps: [
          { do: 'expect', selector: '#buy' },
          { do: 'expect', text: 'Generate video' },
          { do: 'expect', selector: '#gen', enabled: true, timeout: 1 },
          { do: 'expect', gone: '#gen', timeout: 0.5 },
          { id: 'generate', do: 'click', selector: '#gen' },
        ],
      },
      frameSink(),
      (m) => logs.push(m),
      { dryRun: true, env: {} },
    )
    expect(result.skipped).toEqual([
      {
        step: 2,
        do: 'expect',
        selector: '#gen',
        reason: "'#gen' stayed disabled for 1 s",
      },
      {
        step: 3,
        do: 'expect',
        selector: '#gen',
        reason: "'#gen' was still there after 0.5 s",
      },
    ])
    expect(result.meta.steps?.[2].reason).toBe("'#gen' stayed disabled for 1 s")
    // The press happened, and is reported.
    expect(result.disabled).toEqual([
      { step: 4, id: 'generate', selector: '#gen' },
    ])
    expect(result.events.some((e) => e.type === 'down')).toBe(true)
    // An expect moves no cursor: the only events before the click are the
    // recorder's opening position.
    const firstDown = result.events.findIndex((e) => e.type === 'down')
    const clickStart = (result.meta.steps?.[4].tStart ?? 0) * 1000
    expect(
      result.events.filter((e) => e.t < clickStart && e.type === 'move'),
    ).toHaveLength(1)
    expect(firstDown).toBeGreaterThan(0)
  }, 60_000)
})

describe('a guarded step', () => {
  const script = {
    viewport: VIEWPORT,
    steps: [
      {
        id: 'buy',
        do: 'click' as const,
        selector: '#buy',
        guard: 'spend' as const,
        read: '#bought',
      },
    ],
  }

  it('is hovered in a rehearsal and never pressed', async () => {
    if (!browser) return
    const logs: string[] = []
    const result = await recordTake(
      browser,
      `${base}/`,
      script,
      frameSink(),
      (m) => logs.push(m),
      { dryRun: true, env: {} },
    )
    expect(result.meta.steps?.[0].text).toBe('0')
    expect(result.meta.steps?.[0].guard).toBe('spend')
    expect(result.meta.steps?.[0].confirmed).toBeUndefined()
    expect(result.meta.steps?.[0].rect?.w).toBeGreaterThan(0)
    expect(result.events.some((e) => e.type === 'down')).toBe(false)
    expect(result.confirmed).toEqual([])
    expect(logs).toContain('#0 buy: guarded (spend), hovered, not pressed')
  }, 60_000)

  it('refuses a recording that does not name it, before capturing anything', async () => {
    if (!browser) return
    const sink = frameSink()
    const run = recordTake(browser, `${base}/`, script, sink, () => {}, {
      env: {},
    })
    await expect(run).rejects.toBeInstanceOf(RecordRefusedError)
    await expect(run).rejects.toThrow(/--confirm buy/)
    expect(sink.count).toBe(0)
  }, 60_000)

  it('is pressed when the recording names it', async () => {
    if (!browser) return
    const result = await recordTake(
      browser,
      `${base}/`,
      script,
      frameSink(),
      () => {},
      { env: {}, confirm: ['buy'] },
    )
    expect(result.meta.steps?.[0].text).toBe('1')
    expect(result.meta.steps?.[0].confirmed).toBe(true)
    expect(result.confirmed).toEqual(['buy'])
  }, 60_000)
})

describe('await waits off camera', () => {
  it('cuts the wait out of the footage: no gap, the cut in meta.skips, a segment boundary', async () => {
    if (!browser) return
    const frames: number[] = []
    const started = Date.now()
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: VIEWPORT,
        steps: [
          { do: 'click', selector: '#start', ms: 300 },
          {
            id: 'ready',
            do: 'await',
            until: { selector: '#result' },
            poll: 0.25,
          },
          { do: 'wait', ms: 300 },
        ],
      },
      { frame: () => void frames.push(0) },
      () => {},
      { env: {} },
    )
    const wallMs = Date.now() - started
    const skips = result.meta.skips ?? []
    expect(skips).toHaveLength(1)
    const skip = skips[0]
    expect(skip.step).toBe(1)
    expect(skip.id).toBe('ready')
    // The page took 4 s from the press (the press and its settle took some
    // of that on camera); the poll found it within a beat.
    expect(skip.ms).toBeGreaterThanOrEqual(2000)
    expect(skip.ms).toBeLessThan(6000)
    expect(result.meta.steps?.[1].offCameraMs).toBe(skip.ms)
    // The footage clock stood still: the take is shorter than the wall by
    // the wait, and the await's own span is a moment, not three seconds.
    expect(result.meta.durationMs).toBeLessThan(wallMs - skip.ms + 500)
    const span = result.meta.steps![1]
    expect(span.tEnd - span.tStart).toBeLessThan(1)
    expect(span.tStart).toBeCloseTo(skip.at, 1)
    // No gap in the footage: the spinner kept frames coming up to the cut,
    // and frames resume at the cut, never three seconds after it.
    const t = result.frames.map((f) => f.tMs)
    expect(t).toEqual([...t].sort((a, b) => a - b))
    const gaps = t.slice(1).map((v, i) => v - t[i])
    expect(Math.max(...gaps)).toBeLessThan(1500)
    expect(t.some((v) => v >= skip.at * 1000)).toBe(true)
    expect(t[t.length - 1]).toBeLessThanOrEqual(result.meta.durationMs + 400)
    // A fresh plan starts a segment at the cut.
    const doc = planFreshTake(
      { videoKey: 'recording.webm', cursor: result.events, meta: result.meta },
      'recording.webm',
    )
    expect(doc.segments.map((s) => s.in)).toEqual([0, skip.at])
    expect(doc.segments[0].out).toBe(skip.at)
  }, 60_000)

  it('stops the take when it times out, and goes on when told to', async () => {
    if (!browser) return
    const run = (onTimeout: 'fail' | 'continue') =>
      recordTake(
        browser!,
        `${base}/`,
        {
          viewport: VIEWPORT,
          steps: [
            {
              id: 'never',
              do: 'await',
              until: { text: 'never on this page' },
              timeout: 0.6,
              poll: 0.2,
              onTimeout,
            },
            { do: 'click', selector: '#buy', read: '#bought' },
          ],
        },
        frameSink(),
        () => {},
        { dryRun: true, env: {} },
      )
    const failed = await run('fail')
    expect(failed.stopped?.step).toBe(0)
    expect(failed.stopped?.reason).toMatch(
      /^#0 never await: no visible text contained "never on this page" for 0\.6 s, so the take stopped there/,
    )
    expect(failed.meta.steps).toHaveLength(1)
    expect(failed.meta.steps?.[0].timedOut).toBe(true)
    const went = await run('continue')
    expect(went.stopped).toBeNull()
    expect(went.meta.steps).toHaveLength(2)
    expect(went.meta.steps?.[1].text).toBe('1')
  }, 60_000)
})

describe('download keeps what the page makes', () => {
  it('saves a Content-Disposition download and a media element’s source into outputs', async () => {
    if (!browser) return
    const saved: { name: string; bytes: Uint8Array; type?: string }[] = []
    const outputs: OutputSink = {
      save: (name, bytes, type) => {
        saved.push({ name, bytes, type })
      },
    }
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: VIEWPORT,
        steps: [
          { id: 'export', do: 'download', selector: '#dl' },
          { do: 'download', src: '#v', as: 'clip.webm' },
          { do: 'download', src: '#v' },
        ],
      },
      frameSink(),
      () => {},
      { env: {}, outputs },
    )
    expect(result.skipped).toEqual([])
    expect(saved.map((s) => s.name)).toEqual([
      'report.csv',
      'clip.webm',
      'clip-2.webm',
    ])
    expect(new TextDecoder().decode(saved[0].bytes)).toBe(CSV)
    expect([...saved[1].bytes]).toEqual([...CLIP])
    expect(saved[1].type).toBe('video/webm')
    expect(result.meta.outputs).toEqual([
      { step: 0, id: 'export', name: 'report.csv', bytes: CSV.length },
      {
        step: 1,
        name: 'clip.webm',
        bytes: CLIP.length,
        contentType: 'video/webm',
      },
      {
        step: 2,
        name: 'clip-2.webm',
        bytes: CLIP.length,
        contentType: 'video/webm',
      },
    ])
    // The download's click is on camera like any click.
    expect(result.events.some((e) => e.type === 'down')).toBe(true)
  }, 60_000)

  it('is a skip with its reason when nothing comes, and a recorder with nowhere to keep a file refuses', async () => {
    if (!browser) return
    const result = await recordTake(
      browser,
      `${base}/`,
      {
        viewport: VIEWPORT,
        steps: [{ do: 'download', src: '#nothing-here' }],
      },
      frameSink(),
      () => {},
      { dryRun: true, env: {} },
    )
    expect(result.skipped).toEqual([
      {
        step: 0,
        do: 'download',
        selector: '#nothing-here',
        reason: "no element matches '#nothing-here'",
      },
    ])
    await expect(
      recordTake(
        browser,
        `${base}/`,
        { viewport: VIEWPORT, steps: [{ do: 'download', selector: '#dl' }] },
        frameSink(),
        () => {},
        { env: {} },
      ),
    ).rejects.toThrow(/nowhere to keep a file/)
  }, 60_000)
})
