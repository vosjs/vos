import { describe, expect, it } from 'vitest'
import {
  collectConfigMediaUrls,
  collectDocMediaUrls,
  mediaProbeLints,
} from '../mediaProbe'

const ASSET = 'https://vos.so/api/assets/abc123/file'

describe('collectDocMediaUrls', () => {
  it('collects the backdrop loop, overlay keys and audio keys, deduped', () => {
    const doc = {
      frame: {
        backgroundMedia: { kind: 'video', key: ASSET, duration: 10 },
      },
      overlays: [
        { id: 'a', kind: 'image', key: 'https://assets.vos.so/x/pic.webp' },
        { id: 'b', kind: 'text', text: 'hi' },
        { id: 'c', kind: 'video', key: ASSET },
      ],
      audio: [{ id: 'm', key: 'https://assets.vos.so/music/calm.mp3' }],
    }
    expect(collectDocMediaUrls(doc)).toEqual([
      ASSET,
      'https://assets.vos.so/x/pic.webp',
      'https://assets.vos.so/music/calm.mp3',
    ])
  })

  it('ignores local take-dir keys, blob/data URLs and non-media pages', () => {
    const doc = {
      overlays: [
        { id: 'a', kind: 'image', key: '/bg.webm' },
        { id: 'b', kind: 'image', key: 'blob:http://x/y' },
        { id: 'c', kind: 'image', key: 'data:image/png;base64,xxxx' },
      ],
      audio: [{ id: 'm', key: '/music.mp3' }],
    }
    expect(collectDocMediaUrls(doc)).toEqual([])
    expect(collectDocMediaUrls(null)).toEqual([])
    expect(collectDocMediaUrls('nope')).toEqual([])
  })
})

describe('collectConfigMediaUrls', () => {
  it('collects element srcs, font files and media-shaped data values', () => {
    const config = {
      elements: [
        { type: 'image', src: ASSET },
        { type: 'text', content: 'hi' },
      ],
      fonts: [
        {
          family: 'Fraunces',
          url: 'https://assets.vos.so/fonts/fraunces/600.woff2',
        },
      ],
      data: {
        shotUrl: ASSET,
        headline: 'Flowcharts in seconds',
        docsLink: 'https://vos.so/docs',
        modelUrl: 'https://assets.vos.so/models/chair.glb',
      },
    }
    expect(collectConfigMediaUrls(config)).toEqual([
      ASSET,
      'https://assets.vos.so/fonts/fraunces/600.woff2',
      'https://assets.vos.so/models/chair.glb',
    ])
  })

  it('never mistakes prose or page links for media', () => {
    expect(
      collectConfigMediaUrls({ data: { a: 'https://vos.so/gallery', b: 3 } }),
    ).toEqual([])
  })
})

describe('mediaProbeLints', () => {
  it('a >=400 answer is a problem in words; a failed probe is a warning', () => {
    const { problems, warnings } = mediaProbeLints([
      { url: ASSET, ok: false, status: 404 },
      { url: 'https://x/y.png', ok: null, error: 'getaddrinfo ENOTFOUND' },
      { url: 'https://ok/z.png', ok: true, status: 200 },
    ])
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('404')
    expect(problems[0]).toContain(ASSET)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('could not probe')
  })
})
