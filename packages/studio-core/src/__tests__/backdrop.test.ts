import { describe, expect, it } from 'vitest'
import { backdropMedia, withBackdrop } from '../backdrop'
import { projectFromArtifact } from '../ingest'
import {
  BASE_FRAME_STYLE,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
} from '../types'
import { lowerToComposition } from '../lower/lowerToComposition'
import type { Backdrop } from '../backdrop'
import type { ProjectDoc, RecordingArtifact } from '../types'

// The backdrop is a MECHANISM here: a frame opens on a loop and its ground
// in one write, the ingest takes the frame a host hands it, and the
// package's own default is a frame with no backdrop. Which loop a product
// opens on is that product's constant, never this package's.

const LOOP: Backdrop = {
  key: 'https://example.test/loops/mesh/1080p.webm',
  poster: 'https://example.test/loops/mesh/poster.webp',
  duration: 12,
  ground: '#bab8dc',
}

const meta = {
  dpr: 2,
  zoom: 1,
  t0: 0,
  durationMs: 3000,
  width: 1600,
  height: 900,
  fps: 30,
}

function makeDoc(): ProjectDoc {
  return {
    source: { videoKey: 'blob:video', cursor: [], meta },
    segments: [{ in: 0, out: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: withBackdrop(BASE_FRAME_STYLE, LOOP),
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

describe('withBackdrop', () => {
  it('writes the loop and its ground, nothing else', () => {
    const frame = withBackdrop(BASE_FRAME_STYLE, LOOP)
    expect(frame.background).toBe(LOOP.ground)
    expect(frame.backgroundMedia).toEqual(backdropMedia(LOOP))
    expect(frame.backgroundMedia).toEqual({
      kind: 'video',
      key: LOOP.key,
      duration: 12,
      poster: LOOP.poster,
      dim: 0,
    })
    expect(frame.padding).toBe(BASE_FRAME_STYLE.padding)
    expect(frame.browserBar).toBe(BASE_FRAME_STYLE.browserBar)
  })

  it("a backdrop without a ground keeps the frame's own fill under it", () => {
    const frame = withBackdrop(BASE_FRAME_STYLE, {
      key: '/bg.webm',
      duration: 10,
    })
    expect(frame.background).toBe(BASE_FRAME_STYLE.background)
    expect(frame.backgroundMedia).toEqual({
      kind: 'video',
      key: '/bg.webm',
      duration: 10,
      dim: 0,
    })
  })

  it('an image backdrop carries no period', () => {
    expect(backdropMedia({ key: '/bg.png', kind: 'image' })).toEqual({
      kind: 'image',
      key: '/bg.png',
      dim: 0,
    })
  })

  it('lowers a backdrop doc with the loop in ctx.data (no bake, no recompile)', () => {
    const { data } = lowerToComposition(makeDoc())
    const frame = data.frame as {
      background: string
      backgroundMedia: { key: string; duration: number }
    }
    expect(frame.background).toBe(LOOP.ground)
    expect(frame.backgroundMedia.key).toBe(LOOP.key)
    expect(frame.backgroundMedia.duration).toBe(LOOP.duration)
  })
})

describe('the package default', () => {
  it('is the bare frame: no loop, no host in it', () => {
    expect(DEFAULT_FRAME_STYLE).toBe(BASE_FRAME_STYLE)
    expect(DEFAULT_FRAME_STYLE.backgroundMedia).toBeUndefined()
  })
})

describe('projectFromArtifact frame option', () => {
  const artifact: RecordingArtifact = {
    videoKey: 'recording.webm',
    cursor: [],
    meta: {
      ...meta,
      captureSurface: 'tab',
      platform: 'mac',
      pageUrl: 'https://example.test/app',
    },
  }

  it('opens on the frame it is handed, with the bar still derived from the footage', () => {
    const house = withBackdrop(BASE_FRAME_STYLE, LOOP)
    const { doc } = projectFromArtifact(artifact, 'recording.webm', {
      frame: house,
    })
    expect(doc.frame.background).toBe(LOOP.ground)
    expect(doc.frame.backgroundMedia).toEqual(backdropMedia(LOOP))
    // The tab take's OS-matched bar and the recorded page's address ride on top.
    expect(doc.frame.browserBar.kind).toBe('mac-light')
    expect(doc.frame.browserBar.url).toBe('example.test/app')
  })

  it('falls back to the bare frame when none is handed', () => {
    const { doc } = projectFromArtifact(artifact, 'recording.webm')
    expect(doc.frame.backgroundMedia).toBeUndefined()
    expect(doc.frame.background).toBe(BASE_FRAME_STYLE.background)
  })
})
