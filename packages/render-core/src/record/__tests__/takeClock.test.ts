import { describe, expect, it } from 'vitest'
import { TakeClock } from '../takeClock'
import { recordTake } from '../recorder'
import type { RecorderBrowser, RecorderCdp, RecorderPage } from '../driver'

/**
 * One clock for the take: footage time leaves out every off-camera
 * stretch, a frame is placed by when it was captured, and frame times
 * only ever increase. The interleavings a real screencast produces under
 * load (a frame arriving after a later one, a frame captured before a
 * pause landing after the resume) are injected here deterministically.
 */
describe('the take clock', () => {
  it('leaves an off-camera stretch out of footage time', () => {
    const c = new TakeClock(1000)
    expect(c.footageMs(1500)).toBe(500)
    expect(c.pause(2000)).toBe(1000)
    // Inside the stretch the footage clock stands at the cut.
    expect(c.footageMs(2500)).toBe(1000)
    expect(c.resume(5000)).toBe(3000)
    expect(c.footageMs(5000)).toBe(1000)
    expect(c.footageMs(5250)).toBe(1250)
    // An instant before the stretch is unaffected by it.
    expect(c.footageMs(1900)).toBe(900)
  })

  it('places a frame captured before a pause before the cut, even when it lands after the resume', () => {
    const c = new TakeClock(0)
    expect(c.placeFrame(900)).toBe(900)
    c.pause(1000)
    c.resume(4000)
    // In flight across the pause: captured at 950, handed over after 4000.
    expect(c.placeFrame(950)).toBe(950)
    // The first frame of the resumed capture sits just after the cut.
    expect(c.placeFrame(4010)).toBe(1010)
  })

  it('drops a frame that is not later than the last one kept', () => {
    const c = new TakeClock(0)
    expect(c.placeFrame(2151)).toBe(2151)
    expect(c.placeFrame(2168)).toBe(2168)
    expect(c.placeFrame(2164)).toBeNull()
    expect(c.placeFrame(2168)).toBeNull()
    expect(c.placeFrame(2180)).toBe(2180)
  })
})

/** A driver whose screencast hands over frames in the order given. */
function fakeBrowser(offsetsMs: number[]): RecorderBrowser {
  let onFrame:
    | ((ev: {
        data: string
        sessionId: number
        metadata: { timestamp?: number }
      }) => void)
    | null = null
  const cdp: RecorderCdp = {
    on: (_event, cb) => {
      onFrame = cb
    },
    send: async (method) => {
      if (method !== 'Page.startScreencast') return
      // Stamped from the instant the capture starts, handed over out of order.
      const base = Date.now()
      setTimeout(() => {
        offsetsMs.forEach((off, i) =>
          onFrame?.({
            data: btoa(String.fromCharCode(0xff, 0xd8, i)),
            sessionId: i,
            metadata: { timestamp: (base + off) / 1000 },
          }),
        )
      }, 0)
    },
  }
  const locator = {
    first: () => ({
      waitFor: async () => {},
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => null,
      click: async () => {},
      fill: async () => {},
      isVisible: async () => false,
      isEnabled: async () => true,
      evaluate: async <R>() => '' as R,
    }),
  }
  const page: RecorderPage = {
    goto: async () => ({ status: () => 200 }),
    url: () => 'http://127.0.0.1/',
    title: async () => 'Fake',
    evaluate: async <T>() => null as T,
    on: () => {},
    locator: () => locator,
    mouse: {
      move: async () => {},
      down: async () => {},
      up: async () => {},
      wheel: async () => {},
    },
    keyboard: {
      type: async () => {},
      press: async () => {},
      down: async () => {},
      up: async () => {},
    },
  }
  return {
    newContext: async () => ({
      newPage: async () => page,
      addInitScript: async () => {},
      setExtraHTTPHeaders: async () => {},
      newCDPSession: async () => cdp,
      close: async () => {},
    }),
  }
}

describe('the recorder keeps frame times in order', () => {
  it('drops a frame handed over after a later one, and the sink never sees it', async () => {
    const seen: string[] = []
    const result = await recordTake(
      fakeBrowser([100, 150, 140, 150, 200]),
      'http://127.0.0.1/',
      { steps: [{ do: 'wait', ms: 300 }] },
      { frame: (file) => void seen.push(file) },
      () => {},
      { env: {} },
    )
    const t = result.frames.map((f) => f.tMs)
    expect(t).toHaveLength(3)
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1])
    // Kept frames are numbered without gaps, and only they reach the sink.
    expect(result.frames.map((f) => f.file)).toEqual([
      'frame-00000.jpg',
      'frame-00001.jpg',
      'frame-00002.jpg',
    ])
    expect(seen).toEqual(result.frames.map((f) => f.file))
  }, 20_000)
})
