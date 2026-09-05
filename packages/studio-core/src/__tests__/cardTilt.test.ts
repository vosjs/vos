import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import { lowerToComposition } from '../lower/lowerToComposition'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  BASE_FRAME_STYLE,
} from '../types'
import type { ProjectDoc, TiltSpan } from '../types'
import { CARD_FOV, CARD_Z, cardOverscanFor, planeSizeAtDepth } from '../stage'

// Stub-context run of the compiled ON_FRAME string with a real card MESH stub,
// asserting the compositor-v2 card transform: the TILT TRACK → mesh
// rotation as pure f(t), and identity (pre-v2 quad parity) for a doc with no
// tilt spans. There is no static card pose any more (decided 2026-08-03) — a
// lean is a timeline clip. Mirrors the backgroundMedia.test harness but wires
// the three-layer refs so `card.mesh` exists.

function makeDoc(tilt?: TiltSpan[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 3000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 3 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    ...(tilt !== undefined ? { tilt } : {}),
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

interface MeshStub {
  rotation: { x: number; y: number; z: number }
  position: { x: number; y: number; z: number }
  scale: { v: number; setScalar: (n: number) => void }
  material: { opacity: number }
  geometry: { dispose: () => void }
  texture: {
    generateMipmaps: boolean
    minFilter: unknown
    anisotropy: number
    needsUpdate: boolean
    dispose: () => void
  }
}

function meshStub(): MeshStub {
  const m: MeshStub = {
    rotation: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: -4 },
    scale: { v: 1, setScalar: (n: number) => (m.scale.v = n) },
    material: { opacity: 1 },
    geometry: { dispose: () => undefined },
    texture: {
      generateMipmaps: false,
      minFilter: 'linear',
      anisotropy: 1,
      needsUpdate: false,
      dispose: () => undefined,
    },
  }
  return m
}

describe('card tilt track (compositor v2 V0)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.window
    delete g.__vosTimeline
  })

  function runFrame(
    time: number,
    opts: { tilt?: TiltSpan[]; dataPatch?: Record<string, unknown> } = {},
  ): {
    mesh: MeshStub
    canvas: { width: number; height: number }
    planes: number[][]
    data: Record<string, unknown>
  } {
    const planes: number[][] = []
    const lowered = lowerToComposition(makeDoc(opts.tilt))
    const config = lowered.config
    const data = opts.dataPatch
      ? { ...lowered.data, ...opts.dataPatch }
      : lowered.data
    const onFrame = new Function(`return (${config.onFrame as string})`)() as (
      ctx: unknown,
      content: unknown,
      dt: number,
    ) => void
    g.window = {
      __vos__: {
        isPaused: true,
        videoCache: new Map(),
        pendingDecodes: new Set(),
      },
    }
    g.__vosTimeline = { mapTime, sample, lerpArray }

    const c2d = new Proxy(
      {},
      {
        get: (_t, key: string) => {
          if (key === 'measureText') return () => ({ width: 42 })
          if (key === 'createLinearGradient')
            return () => ({ addColorStop: () => {} })
          return () => {}
        },
        set: () => true,
      },
    )
    const mesh = meshStub()
    const cardCanvas = { width: 1920, height: 1080 }
    const layer = (m?: MeshStub) => ({
      c2d,
      canvas: m ? cardCanvas : { width: 1920, height: 1080 },
      texture: m ? m.texture : { needsUpdate: false, dispose: () => undefined },
      mesh: m,
    })
    const video = {
      videoWidth: 1600,
      videoHeight: 900,
      readyState: 2,
      paused: true,
      currentTime: 0,
      duration: 3,
      play: () => undefined,
      pause: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const ctx = {
      time,
      data,
      // no renderer capabilities → anisotropy path is skipped; THREE minimal
      THREE: {
        LinearFilter: 'linear',
        LinearMipmapLinearFilter: 'mipmap',
        PlaneGeometry: class {
          parameters: { width: number; height: number }
          constructor(width: number, height: number) {
            this.parameters = { width, height }
            planes.push([width, height])
          }
          dispose() {}
        },
      },
      renderer: undefined,
      resolution: {
        width: 1920,
        height: 1080,
        drawingBufferWidth: 1920,
        drawingBufferHeight: 1080,
      },
    }
    const content = {
      refs: { bg: layer(), card: layer(mesh), ov: layer(), video, cam: null },
    }
    onFrame(ctx, content, 1 / 30)
    return { mesh, canvas: cardCanvas, planes, data }
  }

  it('lowers no `card` key at all (the field is gone)', () => {
    const { data } = lowerToComposition(makeDoc())
    expect('card' in data).toBe(false)
  })

  it('leaves the card mesh at identity with no tilt spans (pre-v2 parity)', () => {
    const { mesh } = runFrame(1.0)
    expect(mesh.rotation.x).toBe(0)
    expect(mesh.rotation.y).toBe(0)
    expect(mesh.position.y).toBe(0)
    expect(mesh.scale.v).toBe(1)
    expect(mesh.material.opacity).toBe(1)
    expect(mesh.texture.generateMipmaps).toBe(false)
  })

  // --- tilt spans: the OUTPUT-time [rx, ry] degree track is the card's
  // ONLY pose. Between spans it rests flat; suppression flattens it.

  it('applies the sampled track pose inside a span (degrees → radians)', () => {
    const { mesh } = runFrame(1.5, {
      tilt: [{ id: 't0', in: 1, out: 2, rx: 10, ry: -8 }],
    })
    expect(mesh.rotation.x).toBeCloseTo((10 * Math.PI) / 180, 9)
    expect(mesh.rotation.y).toBeCloseTo((-8 * Math.PI) / 180, 9)
  })

  it('rests FLAT outside spans', () => {
    const { mesh } = runFrame(0.1, {
      tilt: [{ id: 't0', in: 2.2, out: 2.9, rx: 12, ry: 0 }],
    })
    expect(mesh.rotation.x).toBe(0)
    expect(mesh.rotation.y).toBe(0)
  })

  it('tiltSuppressed flattens the card (edit views mirror untilted geometry)', () => {
    const { mesh } = runFrame(1.5, {
      tilt: [{ id: 't0', in: 1, out: 2, rx: 15, ry: -15 }],
      dataPatch: { tiltSuppressed: true },
    })
    expect(mesh.rotation.x).toBe(0)
    expect(mesh.rotation.y).toBe(0)
  })

  it('switches mipmaps + mip filter on while a span tilts the card', () => {
    const { mesh } = runFrame(1.5, {
      tilt: [{ id: 't0', in: 1, out: 2, rx: 10, ry: 0 }],
    })
    expect(mesh.texture.generateMipmaps).toBe(true)
    expect(mesh.texture.minFilter).toBe('mipmap')
  })

  it('keeps linear filtering while the track rests at zero', () => {
    const { mesh } = runFrame(0.05, {
      tilt: [{ id: 't0', in: 2.2, out: 2.9, rx: 10, ry: 0 }],
    })
    expect(mesh.rotation.x).toBe(0)
    expect(mesh.texture.generateMipmaps).toBe(false)
  })

  // --- card OVERSCAN: a leaning card shows the frame more plane than the
  // frame is wide on its receding side, and a zoomed (or bled) card's
  // content runs past the frame, so the card layer's canvas and plane grow
  // by the extent the tracks can reach (stage.ts cardOverscanFor is the
  // twin ON_FRAME must agree with).

  it('keeps the card canvas and plane at the frame with no tilt spans', () => {
    const { canvas, planes } = runFrame(1.0)
    expect(canvas).toEqual({ width: 1920, height: 1080 })
    expect(planes).toEqual([])
  })

  it("grows the card canvas and plane by the twin's budget when the card leans", () => {
    const { canvas, planes, data } = runFrame(0.1, {
      tilt: [{ id: 't0', in: 1, out: 2, rx: 6, ry: -9 }],
    })
    const [kx, ky] = cardOverscanFor(
      data.tiltTrack as { keyframes: { value: number[] }[] },
      data.cardPoseTrack as { keyframes: { value: number[] }[] } | undefined,
      1920 / 1080,
    )
    expect(kx).toBeGreaterThan(1)
    const cW = 1920 + 2 * Math.round((1920 * (kx - 1)) / 2)
    const cH = 1080 + 2 * Math.round((1080 * (ky - 1)) / 2)
    expect(canvas).toEqual({ width: cW, height: cH })
    // The plane grows by exactly the canvas's ratio: a texel stays a pixel.
    const frame = planeSizeAtDepth(CARD_Z, CARD_FOV, 1920 / 1080)
    expect(planes).toHaveLength(1)
    expect(planes[0][0]).toBeCloseTo((frame.width * cW) / 1920, 9)
    expect(planes[0][1]).toBeCloseTo((frame.height * cH) / 1080, 9)
  })

  it('sizes the budget at the LIVE aspect (a wider frame recedes farther)', () => {
    const a = runFrame(0.1, {
      tilt: [{ id: 't0', in: 1, out: 2, rx: 0, ry: -20 }],
    })
    const wide = cardOverscanFor(
      a.data.tiltTrack as { keyframes: { value: number[] }[] },
      undefined,
      1920 / 1080,
    )
    const square = cardOverscanFor(
      a.data.tiltTrack as { keyframes: { value: number[] }[] },
      undefined,
      1,
    )
    expect(wide[0]).toBeGreaterThan(square[0])
    expect(a.canvas.width).toBe(
      1920 + 2 * Math.round((1920 * (wide[0] - 1)) / 2),
    )
  })
})
