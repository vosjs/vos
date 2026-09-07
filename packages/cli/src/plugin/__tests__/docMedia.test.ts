import { describe, expect, it } from 'vitest'
import { DEFAULT_CAM_STYLE, DEFAULT_CURSOR_STYLE } from '@vosjs/studio-core'
import {
  assetIdOf,
  docMediaRefs,
  extensionFor,
  isTakeRelativeKey,
  mediaContentType,
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
