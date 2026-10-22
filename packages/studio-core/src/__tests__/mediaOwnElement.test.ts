import { afterEach, describe, expect, it } from 'vitest'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import type { Media, ProjectDoc } from '../types'

/**
 * One file, two players. A take may name the same bytes as two media (the
 * shot as a teaser at the open and in full at the end) or as a media and the
 * footage. SETUP caches decoded elements by src so a warm LOAD never reloads,
 * and that cache used to hand both names ONE element; ON_FRAME's concat rule
 * (pause every media not under the playhead) then paused the playing clip
 * every frame under its other name, and the drift guard re-seeked it about
 * three times a second: a picture that held, then jumped. Every claim on the
 * same bytes now gets its own element, and the rest-the-others loop skips
 * the element under the playhead.
 */
const meta = (durationMs: number) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: 1280,
  height: 720,
  fps: 30,
})

const media = (id: string, videoKey: string): Media => ({
  id,
  videoKey,
  cursor: [],
  meta: meta(5000),
})

const doc: ProjectDoc = {
  source: { videoKey: 'blob:footage', cursor: [], meta: meta(10000) },
  segments: [
    { in: 0, out: 2, media: 'teaser' },
    { in: 0, out: 10 },
    { in: 0, out: 5, media: 'shot' },
    { in: 2, out: 4, media: 'again' },
  ],
  media: [
    media('teaser', 'blob:shot'),
    media('shot', 'blob:shot'),
    media('again', 'blob:footage'),
  ],
  zoom: [],
  audio: [],
  cursor: DEFAULT_CURSOR_STYLE,
  cam: DEFAULT_CAM_STYLE,
  frame: DEFAULT_FRAME_STYLE,
  export: { resolution: '1080p', fps: 30, format: 'mp4' },
}

interface VideoStub {
  src: string
  paused: boolean
  oncanplay: (() => void) | null
  onerror: (() => void) | null
  [key: string]: unknown
}

interface SetupResult {
  video: VideoStub
  media: Record<string, VideoStub>
}

describe('two media on one file get their own elements', () => {
  const g = globalThis as Record<string, unknown>
  const created: VideoStub[] = []

  afterEach(() => {
    delete g.window
    delete g.document
    delete g.__vosTimeline
    created.length = 0
  })

  function install(): void {
    g.window = { __vos__: {} }
    g.document = {
      createElement: () => {
        const v: VideoStub = {
          src: '',
          paused: true,
          oncanplay: null,
          onerror: null,
          readyState: 2,
          videoWidth: 1280,
          videoHeight: 720,
          load() {
            queueMicrotask(() => v.oncanplay?.())
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
        created.push(v)
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

  it('hands every media its own element, and a media never shares the footage', async () => {
    install()
    const r = await runSetup()
    expect(r.media.teaser).not.toBe(r.media.shot)
    expect(r.media.again).not.toBe(r.video)
    expect(r.media.teaser.src).toBe('blob:shot')
    expect(r.media.shot.src).toBe('blob:shot')
    expect(r.media.again.src).toBe('blob:footage')
    // Four players for two files: nothing cloned beyond the claims.
    expect(created).toHaveLength(4)
  })

  it('reuses the SAME elements on a warm LOAD (nothing reloads)', async () => {
    install()
    const first = await runSetup()
    expect(created).toHaveLength(4)
    const second = await runSetup()
    expect(created).toHaveLength(4)
    expect(second.video).toBe(first.video)
    expect(second.media.teaser).toBe(first.media.teaser)
    expect(second.media.shot).toBe(first.media.shot)
    expect(second.media.again).toBe(first.media.again)
  })

  it('the rest-the-others loop never pauses the element under the playhead', () => {
    const { config } = lowerToComposition(doc)
    expect(String(config.onFrame)).toContain(
      'amK !== amId && amE && amE !== video && amE.pause',
    )
  })
})
