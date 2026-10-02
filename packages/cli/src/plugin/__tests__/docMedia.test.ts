import { describe, expect, it } from 'vitest'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
import {
  assetIdOf,
  docAudioRefs,
  docLayerRefs,
  docMediaRefs,
  docObjectRefs,
  extensionFor,
  isTakeRelativeKey,
  mediaContentType,
  sourceSidecarRefs,
  takeRelativeFile,
} from '../media'
import type { ProjectDoc } from '@vosjs/studio-core'

function doc(): ProjectDoc {
  return {
    source: {
      videoKey: 'recording.webm',
      cursor: [],
      meta: {
        dpr: 1,
        zoom: 1,
        t0: 0,
        durationMs: 5000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 5 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: {
      background: '#fff',
      backgroundMedia: { kind: 'image', key: 'grounds/paper.png', dim: 0 },
      padding: 48,
      radius: 12,
      shadow: 0.4,
      border: 0,
      aspectRatio: 'native',
      browserBar: {
        kind: 'none',
        url: '',
        showUrl: true,
        showControls: true,
        height: 44,
      },
    },
    endCard: {
      headline: 'Ship it',
      mark: { key: '/brand/mark.svg', aspect: 1 },
    },
    overlays: [
      {
        id: 'stage-mark',
        kind: 'image',
        key: '/brand/mark.svg',
        width: 0.1,
        radius: 0,
        shadow: 'none',
        start: 0,
        duration: 5,
        transform: { x: 0.1, y: 0.9, scale: 1, rotation: 0 },
      },
      {
        id: 'hosted',
        kind: 'video',
        key: '/api/assets/abc/file',
        width: 0.3,
        radius: 0,
        shadow: 'none',
        start: 0,
        duration: 5,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      },
      {
        id: 'title',
        kind: 'text',
        text: 'words',
        preset: 'title',
        start: 0,
        duration: 5,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      },
    ],
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('the document’s media beside the recording', () => {
  it('tells a take-relative key from a URL, a blob and a hosted asset', () => {
    expect(isTakeRelativeKey('/brand/mark.svg')).toBe(true)
    expect(isTakeRelativeKey('brand/mark.svg')).toBe(true)
    expect(isTakeRelativeKey('https://assets.vos.so/x.webm')).toBe(false)
    expect(isTakeRelativeKey('//cdn/x.png')).toBe(false)
    expect(isTakeRelativeKey('blob:abc')).toBe(false)
    expect(isTakeRelativeKey('/api/assets/abc/file')).toBe(false)
    expect(isTakeRelativeKey(undefined)).toBe(false)
    expect(takeRelativeFile('/brand/mark.svg')).toBe('brand/mark.svg')
  })

  it('lists the take-relative refs and rewrites them in place; hosted keys are left alone', () => {
    const d = doc()
    const refs = docMediaRefs(d)
    expect(refs.map((r) => `${r.where}=${r.key}`)).toEqual([
      'overlay stage-mark=/brand/mark.svg',
      'end card mark=/brand/mark.svg',
      'background=grounds/paper.png',
    ])
    refs[0].set('/api/assets/m1/file')
    refs[1].set('/api/assets/m1/file')
    refs[2].set('/api/assets/g1/file')
    expect(d.overlays?.[0].kind === 'image' && d.overlays[0].key).toBe(
      '/api/assets/m1/file',
    )
    expect(d.endCard?.mark?.key).toBe('/api/assets/m1/file')
    expect(d.frame.backgroundMedia?.key).toBe('/api/assets/g1/file')
    // the hosted refs, for a pull
    const hosted = docMediaRefs(d, (k) => assetIdOf(k) !== null)
    expect(hosted.map((r) => r.where)).toEqual([
      'overlay stage-mark',
      'overlay hosted',
      'end card mark',
      'background',
    ])
  })

  it('names content types and extensions by the file', () => {
    expect(mediaContentType('brand/mark.svg')).toBe('image/svg+xml')
    expect(mediaContentType('x.PNG')).toBe('image/png')
    expect(mediaContentType('loop.webm')).toBe('video/webm')
    expect(mediaContentType('what.bin')).toBe('application/octet-stream')
    expect(extensionFor('image/svg+xml; charset=utf-8')).toBe('.svg')
    expect(extensionFor('video/mp4')).toBe('.mp4')
    expect(extensionFor('application/x-unknown')).toBe('')
  })
})

describe('docMediaRefs: the take’s other media', () => {
  it('lists every media’s recording and sidecars beside the clips', () => {
    const d = doc()
    d.media = [
      {
        id: 'm1',
        videoKey: 'media/second.webm',
        micKey: 'media/second-mic.webm',
        cursor: [],
        meta: d.source.meta,
      },
      {
        id: 'm2',
        videoKey: 'https://assets.vos.so/x.webm',
        cursor: [],
        meta: d.source.meta,
      },
    ]
    const refs = docMediaRefs(d)
    const mine = refs.filter((r) => r.where.startsWith('media '))
    expect(mine.map((r) => [r.where, r.key])).toEqual([
      ['media m1', 'media/second.webm'],
      ['media m1 mic', 'media/second-mic.webm'],
    ])
    mine[0].set('/api/assets/abc/file')
    expect(d.media[0].videoKey).toBe('/api/assets/abc/file')
  })
})

describe('docMediaRefs: a media reference is not a file', () => {
  it('skips an html layer: it has no key, and is never an upload', () => {
    const d = doc()
    d.overlays = [
      {
        id: 'h0',
        kind: 'html',
        start: 0,
        duration: 2,
        html: '<div>x</div>',
        box: { width: 100, height: 40 },
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      },
    ]
    const before = JSON.stringify(d)
    expect(docMediaRefs(d).map((r) => r.where)).not.toContain('overlay h0')
    expect(JSON.stringify(d)).toBe(before)
  })

  it('skips a media:<id> overlay key', () => {
    const d = doc()
    d.overlays = [
      {
        id: 'l1',
        kind: 'video',
        key: 'media:m1',
        start: 0,
        duration: 2,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
      },
    ]
    expect(docMediaRefs(d).some((r) => r.key === 'media:m1')).toBe(false)
  })
})

describe('docAudioRefs: the sound a document adds', () => {
  const clip = (id: string, key: string) => ({
    id,
    key,
    name: id,
    start: 0,
    in: 0,
    out: 5,
    duration: 5,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
  })

  it('lists a local score and rewrites it in place; catalog and hosted keys are left alone', () => {
    const d = {
      audio: [
        clip('score', 'score.ogg'),
        clip('bed', 'https://assets.vos.so/music/bed.mp3'),
        clip('vo', '/api/assets/a1/file'),
      ],
    }
    const refs = docAudioRefs(d)
    expect(refs.map((r) => r.key)).toEqual(['score.ogg'])
    refs[0].set('/api/assets/new/file')
    expect(d.audio[0].key).toBe('/api/assets/new/file')
  })

  it('rides a take push too: docMediaRefs includes the added sound', () => {
    const d = doc()
    d.audio = [clip('score', 'score.ogg')]
    expect(docMediaRefs(d).map((r) => r.where)).toContain('audio score')
  })

  it('reads a program document, which has no recording or frame', () => {
    expect(docAudioRefs({ audio: [clip('s', 'sound/hit.wav')] })).toHaveLength(
      1,
    )
    expect(docAudioRefs({})).toEqual([])
  })
})

// A take's voice and webcam, and a document's 3D props: files a push used to
// leave on the pusher's disk. `vos fetch --media` writes mic.webm and
// cam.webm beside the take, so fetch-then-push lost both without a word.
describe('sourceSidecarRefs: the voice and the webcam', () => {
  it('lists a local mic and cam and rewrites them in place', () => {
    const d = doc()
    d.source.micKey = 'mic.webm'
    d.source.camKey = 'cam.webm'
    const refs = sourceSidecarRefs(d)
    expect(refs.map((r) => r.where)).toEqual(['mic track', 'cam track'])
    refs[0].set('/api/assets/m1/file')
    refs[1].set('/api/assets/c1/file')
    expect(d.source.micKey).toBe('/api/assets/m1/file')
    expect(d.source.camKey).toBe('/api/assets/c1/file')
  })

  it('leaves a hosted sidecar alone, and a take that has none', () => {
    const d = doc()
    expect(sourceSidecarRefs(d)).toEqual([])
    d.source.micKey = '/api/assets/m1/file'
    expect(sourceSidecarRefs(d)).toEqual([])
  })
})

describe('docObjectRefs: a prop’s model is a file too', () => {
  const prop = (id: string, key: string) =>
    ({
      id,
      asset: { kind: 'gltf', key },
      transform3d: { x: 0.5, y: 0.5, z: 0, rx: 0, ry: 0, rz: 0, scale: 0.3 },
    }) as never

  it('lists a local GLB and rewrites it; a hosted one is left alone', () => {
    const d = {
      objects: [
        prop('chair', 'models/chair.glb'),
        prop('lamp', '/api/assets/g1/file'),
      ],
    }
    const refs = docObjectRefs(d)
    expect(refs.map((r) => r.where)).toEqual(['object chair'])
    refs[0].set('/api/assets/new/file')
    expect((d.objects[0] as { asset: { key: string } }).asset.key).toBe(
      '/api/assets/new/file',
    )
  })

  it('rides a take push: docMediaRefs includes the prop', () => {
    const d = doc()
    d.objects = [prop('chair', 'models/chair.glb')]
    expect(docMediaRefs(d).map((r) => r.where)).toContain('object chair')
  })
})

describe('docLayerRefs: what a program document can name', () => {
  it('lists its overlays, its props and its sound, in that order', () => {
    const refs = docLayerRefs({
      overlays: [
        { id: 'mark', kind: 'image', key: 'brand/logo.png' } as never,
        { id: 'title', kind: 'text', text: 'Hi' } as never,
      ],
      objects: [
        {
          id: 'chair',
          asset: { kind: 'gltf', key: 'models/chair.glb' },
        } as never,
      ],
      audio: [{ id: 'score', key: 'score.ogg' } as never],
    })
    expect(refs.map((r) => r.where)).toEqual([
      'overlay mark',
      'object chair',
      'audio score',
    ])
  })

  it('answers empty for a document with no layers', () => {
    expect(docLayerRefs({})).toEqual([])
  })
})
