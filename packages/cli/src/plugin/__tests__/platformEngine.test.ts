/**
 * Reading the platform's studio-core release, and the check a take push
 * makes with it, against a fake client: an answer it can read, every way
 * it cannot (each a warning, never a block), and the refusal's words.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '@vosjs/studio-core'
import {
  PlatformBehindError,
  checkPlatformPlays,
  readPlatformEngine,
} from '../platformEngine'
import type { ProjectDoc } from '@vosjs/studio-core'

const answer =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

const hang: typeof fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    )
  })

function doc(): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 6000,
        width: 1280,
        height: 720,
        fps: 30,
        steps: [{ step: 0, id: 'go', do: 'click', tStart: 2, tEnd: 2.2 }],
      },
    },
    segments: [{ in: 0, out: 6 }],
    zoom: [],
    audio: [
      {
        id: 'score',
        key: 'music/a.mp3',
        name: 'a',
        start: 0,
        in: 0,
        out: 6,
        duration: 6,
        gain: 0.5,
        fadeIn: 0,
        fadeOut: 0,
        normalize: -16,
        loudness: {
          lufs: -16,
          peakDb: -2,
          at: '2026-10-22',
          src: 'music/a.mp3',
        },
      },
    ],
    overlays: [
      {
        id: 'c',
        kind: 'text',
        text: 'Go',
        preset: 'caption',
        start: 0,
        duration: 1,
        transform: { x: 0.5, y: 0.8, scale: 1, rotation: 0 },
        anchor: { step: 'go' },
      },
    ],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '720p', fps: 30, format: 'mp4' },
  }
}

describe('readPlatformEngine', () => {
  it('reads the release the platform names', async () => {
    let asked = ''
    const got = await readPlatformEngine(
      'https://vos.example/',
      async (url) => {
        asked = String(url)
        return new Response(
          JSON.stringify({ studioCore: '0.42.4', core: '0.31.0' }),
        )
      },
    )
    expect(asked).toBe('https://vos.example/api/engine')
    expect(got).toEqual({ engine: { studioCore: '0.42.4', core: '0.31.0' } })
  })

  it('says why it cannot read one', async () => {
    const o = 'https://vos.example'
    expect(await readPlatformEngine(o, answer(404, {}))).toEqual({
      unknown: 'GET https://vos.example/api/engine answered 404',
    })
    expect(
      await readPlatformEngine(o, answer(200, { studioCore: 'latest' })),
    ).toEqual({
      unknown:
        'GET https://vos.example/api/engine named no studio-core release',
    })
    expect(await readPlatformEngine(o, hang, 20)).toEqual({
      unknown:
        'GET https://vos.example/api/engine did not answer within 0.02 s',
    })
    const down = await readPlatformEngine(o, async () => {
      throw new TypeError('fetch failed')
    })
    expect(down).toEqual({
      unknown: 'GET https://vos.example/api/engine failed (fetch failed)',
    })
  })
})

describe('checkPlatformPlays', () => {
  const origin = 'https://vos.example'

  it('refuses, naming each field, what an older platform would draw wrong', async () => {
    const err = await checkPlatformPlays(doc(), {
      origin,
      fetchImpl: answer(200, { studioCore: '0.42.4' }),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PlatformBehindError)
    expect((err as Error).message).toBe(
      'this take uses fields vos.example cannot play yet; it renders with 0.42.4, and its studio, and every version saved there, would get them wrong: caption anchors (studio-core 0.43.0) would show them at their fallback start; loudness targets on sound (studio-core 0.44.0) would play those clips at their gain alone. Push again when vos.example updates, or bake them: vos push --bake',
    )
  })

  it('says one field in one sentence', async () => {
    const d = doc()
    d.audio = []
    const err = await checkPlatformPlays(d, {
      origin,
      fetchImpl: answer(200, { studioCore: '0.42.4' }),
    }).catch((e: unknown) => e)
    expect((err as Error).message).toBe(
      'this take uses caption anchors (studio-core 0.43.0); vos.example renders with 0.42.4, and its studio would show them at their fallback start, as would every version saved there. Push again when vos.example updates, or bake them: vos push --bake',
    )
  })

  it('bakes the copy it sends, never the take', async () => {
    const d = doc()
    const before = structuredClone(d)
    const got = await checkPlatformPlays(d, {
      origin,
      bake: true,
      fetchImpl: answer(200, { studioCore: '0.42.4' }),
    })
    expect(d).toEqual(before)
    expect(got.baked).toEqual(['overlay-anchor', 'audio-normalize'])
    const sent = got.doc as ProjectDoc
    expect(sent.overlays![0]).not.toHaveProperty('anchor')
    expect(sent.overlays![0].start).toBe(2)
    expect(sent.audio[0]).not.toHaveProperty('normalize')
    expect(sent.audio[0].gain).toBe(0.5)
  })

  it('passes a take the platform reads whole, and warns when it cannot tell', async () => {
    const d = doc()
    const current = await checkPlatformPlays(d, {
      origin,
      fetchImpl: answer(200, { studioCore: '0.44.0' }),
    })
    expect(current).toEqual({ doc: d, lines: [], baked: [] })
    const unknown = await checkPlatformPlays(d, {
      origin,
      fetchImpl: hang,
    })
    expect(unknown.doc).toBe(d)
    expect(unknown.lines[0]).toMatch(
      /^could not read which studio-core vos\.example renders with \(GET https:\/\/vos\.example\/api\/engine did not answer within 2 s\); pushing without checking/,
    )
  }, 10_000)
})
