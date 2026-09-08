import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import { STUDIO_ENTRY_ID } from '../lower/studioEntry'
import { bothFrames, lowerMerged } from './helpers/studio'
import { layerMedia, mediaRef, mediaRefId } from '../media'
import { CARD_Z } from '../stage'
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  LAYER_CARD_SHADOW,
} from '../types'
import type { Media, MediaOverlayClip, ProjectDoc } from '../types'

// Many cards: a media overlay may show a DOCUMENT media (`media:<id>`,
// with its facts) and wear a card (`frame`), drawn by the card painter on
// its own plane. Without a frame the layer stays the flat picture.

const meta = (durationMs: number, w = 1600, h = 900) => ({
  dpr: 1,
  zoom: 1,
  t0: 0,
  durationMs,
  width: w,
  height: h,
  fps: 30,
  pageUrl: 'https://www.vos.so/gallery?x=1',
})

const m1: Media = {
  id: 'm1',
  videoKey: 'blob:b',
  cursor: [
    { t: 200, x: 100, y: 100, type: 'move' },
    { t: 1000, x: 300, y: 200, type: 'down', button: 0 },
    { t: 1100, x: 300, y: 200, type: 'up', button: 0 },
    { t: 3000, x: 800, y: 400, type: 'move' },
  ],
  meta: meta(6000, 1280, 720),
}

function doc(over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    source: { videoKey: 'blob:a', cursor: [], meta: meta(10000) },
    segments: [{ in: 0, out: 10 }],
    media: [m1],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: DEFAULT_FRAME_STYLE,
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
    ...over,
  }
}

const layer = (over: Partial<MediaOverlayClip> = {}): MediaOverlayClip => ({
  id: 'l1',
  kind: 'video',
  key: mediaRef('m1'),
  start: 1,
  duration: 4,
  width: 0.4,
  transform: { x: 0.7, y: 0.5, scale: 1, rotation: 0 },
  ...over,
})

describe('a layer that shows a document media', () => {
  it('names it by key, and the lowering resolves it with its facts', () => {
    expect(mediaRefId('media:m1')).toBe('m1')
    expect(mediaRefId('media:')).toBe('')
    expect(mediaRefId('/logo.png')).toBeNull()
    const d = doc()
    expect(layerMedia(d, 'media:m1')).toBe(m1)
    expect(layerMedia(d, 'media:')).toBe(d.source)
    expect(layerMedia(d, 'media:zzz')).toBeNull()
    const data = lowerToComposition(
      doc({
        overlays: [layer({ frame: { browserBar: { kind: 'mac-light' } } })],
      }),
    ).stack[STUDIO_ENTRY_ID]
    const ol = (data.overlays as Record<string, unknown>[])[0]
    expect(ol.key).toBe('blob:b')
    expect(ol.kind).toBe('video')
    const card = ol.card as {
      bar: { kind: string; url: string }
      lean: number[]
      shadow: number
    }
    expect(card.bar.kind).toBe('mac-light')
    expect(card.bar.url).toBe('vos.so/gallery')
    expect(card.lean).toEqual([0, 0])
    expect(card.shadow).toBe(LAYER_CARD_SHADOW)
    const cur = ol.cur as {
      pts: unknown[]
      space: { w: number }
      clicks: { t: number }[]
    }
    expect(cur.pts.length).toBeGreaterThan(0)
    expect(cur.space.w).toBe(1280)
    expect(cur.clicks).toEqual([{ t: 1, x: 300, y: 200 }])
  })

  it('without a frame it is the flat picture, with no card and no facts', () => {
    const data = lowerToComposition(doc({ overlays: [layer()] })).stack[
      STUDIO_ENTRY_ID
    ]
    const ol = (data.overlays as Record<string, unknown>[])[0]
    expect(ol.key).toBe('blob:b')
    expect('card' in ol).toBe(false)
    expect('cur' in ol).toBe(false)
    // a plain key is untouched
    const plain = lowerToComposition(
      doc({ overlays: [layer({ key: '/logo.png', kind: 'image' })] }),
    ).stack[STUDIO_ENTRY_ID]
    expect((plain.overlays as Record<string, unknown>[])[0].key).toBe(
      '/logo.png',
    )
  })
})

describe('the card painter on its own plane', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
    delete g.document
  })

  class MeshStub {
    position = {
      x: 0,
      y: 0,
      z: 0,
      set(x: number, y: number, z: number) {
        this.x = x
        this.y = y
        this.z = z
      },
    }
    rotation = {
      x: 0,
      y: 0,
      z: 0,
      set(x: number, y: number, z: number) {
        this.x = x
        this.y = y
        this.z = z
      },
    }
    scale = {
      x: 1,
      y: 1,
      z: 1,
      set(x: number, y: number, z: number) {
        this.x = x
        this.y = y
        this.z = z
      },
      setScalar(v: number) {
        this.x = v
        this.y = v
        this.z = v
      },
    }
    visible = true
    renderOrder = 0
    frustumCulled = true
    geometry: { dispose(): void }
    material: { opacity: number; dispose(): void }
    constructor(
      geometry: { dispose(): void },
      material: { opacity: number; dispose(): void },
    ) {
      this.geometry = geometry
      this.material = material
    }
  }
  const THREE = {
    Mesh: MeshStub,
    PlaneGeometry: class {
      dispose() {}
    },
    MeshBasicMaterial: class {
      opacity = 1
      dispose() {}
    },
    CanvasTexture: class {
      needsUpdate = false
      dispose() {}
    },
    LinearFilter: 1,
    SRGBColorSpace: 'srgb',
  }

  function harness(d: ProjectDoc) {
    const { config, data } = lowerMerged(d)
    const onFrame = bothFrames(config)
    const calls: string[] = []
    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient' || key === 'createRadialGradient')
            return () => ({ addColorStop: () => {} })
          return (...args: unknown[]) => {
            calls.push(key + (key === 'drawImage' ? ':' + args.length : ''))
          }
        },
        set: () => true,
      },
    )
    const el = {
      videoWidth: 1280,
      videoHeight: 720,
      readyState: 2,
      paused: true,
      currentTime: 0,
      duration: 6,
      playbackRate: 1,
      play: () => Promise.resolve(),
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map([
          ['blob:b', el],
          ['blob:a', el],
        ]),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }
    g.document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => c2d }),
    }
    const layerRefs = () => ({
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false, dispose: () => undefined },
      mesh: null,
    })
    const group = {
      children: [] as unknown[],
      add(m: unknown) {
        this.children.push(m)
      },
      remove(m: unknown) {
        this.children = this.children.filter((x) => x !== m)
      },
    }
    const pool = new Map()
    const refs = {
      bg: layerRefs(),
      card: layerRefs(),
      ov: layerRefs(),
      objects: { group, pool },
      video: el,
      cam: null,
      media: { m1: el },
    }
    const frame = (time: number) =>
      onFrame(
        {
          time,
          data,
          THREE,
          utils: {},
          loaders: {},
          renderer: undefined,
          resolution: {
            width: 1920,
            height: 1080,
            drawingBufferWidth: 1920,
            drawingBufferHeight: 1080,
          },
        },
        { refs },
        1 / 30,
      )
    return {
      frame,
      group,
      calls,
      objects: refs.objects as {
        group: typeof group
        cards?: Map<string, { mesh: MeshStub }>
      },
    }
  }

  it('paints the card into its own plane, leaned, above the primary card', () => {
    const h = harness(
      doc({
        overlays: [
          layer({
            frame: {
              browserBar: { kind: 'mac-light' },
              lean: { rx: 2, ry: 8 },
            },
          }),
        ],
      }),
    )
    h.frame(2)
    expect(h.group.children).toHaveLength(1)
    const m = h.group.children[0] as MeshStub
    expect(m.renderOrder).toBe(1.25)
    expect(m.visible).toBe(true)
    expect(m.rotation.y).toBeCloseTo((8 * Math.PI) / 180, 6)
    expect(m.rotation.x).toBeCloseTo((2 * Math.PI) / 180, 6)
    // to the right of centre, on the card's depth
    expect(m.position.x).toBeGreaterThan(0)
    expect(m.position.z).toBeCloseTo(CARD_Z + 0.01, 6)
    // the painter drew the media (the primary card's own draw is the other)
    expect(h.calls.filter((c) => c === 'drawImage:5')).toHaveLength(2)
    expect(h.calls.filter((c) => c === 'arc').length).toBeGreaterThanOrEqual(4)
    // off its clip the plane rests
    h.frame(7)
    expect((h.group.children[0] as MeshStub).visible).toBe(false)
  })

  it('a flat layer never makes a plane', () => {
    const h = harness(doc({ overlays: [layer()] }))
    h.frame(2)
    expect(h.group.children).toHaveLength(0)
  })
})
