import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { Media, ProjectDoc } from '../types'

/**
 * A media whose file cannot be read never borrows another clip's picture.
 *
 * SETUP used to warn and leave the media without an element, and ON_FRAME's
 * concat rule then fell back to the PRIMARY element for that media's whole
 * stretch: the first clip's footage, driven by the second clip's times,
 * zooms, captions and click marks. A film that looked edited wrong, with no
 * word anywhere that a file was missing.
 *
 * Now the media's own card stands in, empty, saying its footage did not
 * load (an editor's "media offline" frame), and the reason is kept at
 * window.__vos__.mediaErrors[id] for a host to read.
 */
const meta = (width: number, height: number, durationMs: number) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width,
  height,
  fps: 30,
})

const media = (id: string, videoKey: string): Media => ({
  id,
  videoKey,
  cursor: [
    { t: 0, x: 100, y: 100, type: 'move' },
    { t: 1000, x: 400, y: 300, type: 'move' },
  ],
  meta: meta(1280, 720, 4000),
})

/** Primary 0..3 s, then `gone` 0..4 s, then `fine` 0..4 s. */
const doc: ProjectDoc = {
  source: {
    videoKey: 'blob:primary',
    cursor: [],
    meta: meta(1920, 1080, 3000),
  },
  segments: [
    { in: 0, out: 3 },
    { in: 0, out: 4, media: 'gone' },
    { in: 0, out: 4, media: 'fine' },
  ],
  media: [media('gone', 'blob:gone'), media('fine', 'blob:fine')],
  zoom: [],
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

interface Stub {
  tag: string
  src: string
  [key: string]: unknown
}

interface SetupResult {
  video: Stub
  media: Record<string, Stub>
}

const g = globalThis as Record<string, unknown>

describe('a media that cannot load shows its own card, offline', () => {
  /** The srcs whose load fails. */
  const dead = new Set<string>()
  const words: string[] = []

  afterEach(() => {
    delete g.window
    delete g.document
    delete g.__vosTimeline
    dead.clear()
    words.length = 0
  })

  function install(): void {
    g.window = g.window ?? { __vos__: {} }
    g.document = {
      createElement: (tag: string) => {
        if (tag === 'canvas') {
          const cv: Stub = {
            tag,
            src: '',
            width: 0,
            height: 0,
            getContext: () => ({
              fillRect: () => undefined,
              fillText: (text: string) => {
                words.push(text)
              },
            }),
          }
          return cv
        }
        const v: Stub = {
          tag,
          src: '',
          paused: true,
          oncanplay: null,
          onerror: null,
          readyState: 2,
          videoWidth: 1280,
          videoHeight: 720,
          error: { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' },
          load() {
            queueMicrotask(() => {
              const fire = (dead.has(v.src) ? v.onerror : v.oncanplay) as
                | (() => void)
                | null
              fire?.()
            })
          },
          play() {
            v.paused = false
            return Promise.resolve()
          },
          pause() {
            v.paused = true
          },
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }
        return v
      },
    }
  }

  async function runSetup(): Promise<SetupResult> {
    const { config, data } = lowerToComposition(doc)
    const setup = new Function(
      `"use strict"; return (${config.setup as string})`,
    )() as (ctx: unknown) => Promise<SetupResult>
    return setup({
      data,
      renderer: undefined,
      resolution: { width: 1920, height: 1080 },
    })
  }

  const errors = () =>
    ((g.window as { __vos__: { mediaErrors?: Record<string, string> } }).__vos__
      .mediaErrors ?? {}) as Record<string, string>

  it('stands the media on its own offline card, sized as its footage was', async () => {
    dead.add('blob:gone')
    install()
    const r = await runSetup()
    const card = r.media.gone
    expect(card).toBeDefined()
    expect(card).not.toBe(r.video)
    expect(card.tag).toBe('canvas')
    expect(card.__vosMissing).toBe(true)
    // The media's own recorded space, so its crop, zooms and card geometry
    // land where they would have; the draw site reads it as a video's size.
    expect([card.width, card.height]).toEqual([1280, 720])
    expect([card.videoWidth, card.videoHeight]).toEqual([1280, 720])
    // A still: nothing to play or to keep on the clock.
    expect(card.play).toBeUndefined()
    expect(words).toEqual(["This clip's footage did not load"])
    // The media that loaded is untouched.
    expect(r.media.fine.tag).toBe('video')
    expect(r.media.fine.__vosMissing).toBeUndefined()
  })

  it('keeps the reason where a host can read it, for that media alone', async () => {
    dead.add('blob:gone')
    install()
    await runSetup()
    expect(Object.keys(errors())).toEqual(['gone'])
    expect(errors().gone).toContain('failed to load')
  })

  it('forgets it on the next LOAD once the file reads', async () => {
    dead.add('blob:gone')
    install()
    await runSetup()
    expect(errors().gone).toBeDefined()
    dead.clear()
    const again = await runSetup()
    expect(again.media.gone.tag).toBe('video')
    expect(errors().gone).toBeUndefined()
  })
})

describe('ON_FRAME draws the offline card, never the first clip', () => {
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  const videoStub = (w: number, h: number) => ({
    videoWidth: w,
    videoHeight: h,
    readyState: 2,
    paused: true,
    seeking: false,
    currentTime: 0,
    duration: 4,
    play: () => Promise.resolve(),
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })

  /** Every source handed to drawImage at output second `t`. */
  function drawnAt(t: number, refsMedia: Record<string, unknown>) {
    const { config, data } = lowerToComposition(doc)
    const onFrame = new Function(
      `"use strict"; return (${config.onFrame as string})`,
    )() as (ctx: unknown, content: unknown, dt: number) => void
    g.window = { __vos__: { isPaused: true } }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    const primary = videoStub(1920, 1080)
    const sources: unknown[] = []
    const strokes: string[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient' || key === 'createRadialGradient')
            return () => ({ addColorStop: () => {} })
          return (...a: unknown[]) => {
            if (key === 'drawImage') sources.push(a[0])
            if (key === 'arc' || key === 'lineTo') strokes.push(key)
          }
        },
        set: () => true,
      },
    )
    onFrame(
      {
        time: t,
        data,
        renderer: undefined,
        resolution: {
          width: 1920,
          height: 1080,
          drawingBufferWidth: 1920,
          drawingBufferHeight: 1080,
        },
      },
      {
        refs: {
          c2d,
          canvas: { width: 1920, height: 1080 },
          texture: { needsUpdate: false, dispose: () => undefined },
          video: primary,
          media: refsMedia,
          cam: null,
        },
      },
      1 / 30,
    )
    return { primary, sources, strokes }
  }

  const offline = () => ({
    width: 1280,
    height: 720,
    videoWidth: 1280,
    videoHeight: 720,
    __vosMissing: true,
  })

  it("draws the media's offline card in its stretch, and not the primary", () => {
    const card = offline()
    const fine = videoStub(1280, 720)
    // Output 3..7 s is `gone`.
    const { primary, sources } = drawnAt(4, { gone: card, fine })
    expect(sources).toContain(card)
    expect(sources).not.toContain(primary)
    expect(sources).not.toContain(fine)
  })

  it('draws no pointer over a card that has no footage', () => {
    const fine = videoStub(1280, 720)
    const loaded = drawnAt(4, { gone: videoStub(1280, 720), fine })
    const missing = drawnAt(4, { gone: offline(), fine })
    // The media carries a cursor track and the take shows its cursor: with
    // footage the arrow is drawn, over an offline card it is not.
    expect(loaded.strokes.length).toBeGreaterThan(0)
    expect(missing.strokes.length).toBeLessThan(loaded.strokes.length)
  })

  it('leaves every other stretch as it was', () => {
    const card = offline()
    const fine = videoStub(1280, 720)
    const first = drawnAt(1, { gone: card, fine })
    expect(first.sources).toContain(first.primary)
    expect(first.sources).not.toContain(card)
    const last = drawnAt(8, { gone: card, fine })
    expect(last.sources).toContain(fine)
    expect(last.sources).not.toContain(card)
  })
})
