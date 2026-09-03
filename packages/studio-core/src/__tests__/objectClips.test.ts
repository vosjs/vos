import { afterEach, describe, expect, it } from 'vitest'
import { lerpArray, mapTime, sample } from '@vosjs/timeline'
import {
  DEFAULT_BROWSER_BAR,
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  BASE_FRAME_STYLE,
} from '../types'
import { bothFrames, lowerMerged as lowerToComposition } from './helpers/studio'
import type { ObjectClip, ProjectDoc } from '../types'

// Object clips: mesh-pool reconciliation from ctx.data (the interpreter
// pattern in 3D) — create/update/dispose live, span fades, deterministic
// animation, byte-parity when absent.

function makeDoc(objects?: ObjectClip[]): ProjectDoc {
  return {
    source: {
      videoKey: 'blob:video',
      cursor: [{ t: 0, x: 100, y: 100, type: 'move' }],
      meta: {
        dpr: 2,
        zoom: 1,
        t0: 0,
        durationMs: 4000,
        width: 1600,
        height: 900,
        fps: 30,
      },
    },
    segments: [{ in: 0, out: 4 }],
    zoom: [],
    audio: [],
    cursor: DEFAULT_CURSOR_STYLE,
    cam: DEFAULT_CAM_STYLE,
    frame: { ...BASE_FRAME_STYLE, browserBar: DEFAULT_BROWSER_BAR },
    ...(objects !== undefined ? { objects } : {}),
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
}

const clip = (over: Partial<ObjectClip> = {}): ObjectClip => ({
  id: 'p0',
  asset: { kind: 'primitive', shape: 'knot' },
  span: { start: 0.5, duration: 2 },
  transform3d: { x: 0.8, y: 0.3, z: 0.5, rx: 0, ry: 0, rz: 0, scale: 0.18 },
  animation: null,
  ...over,
})

class Vec {
  x = 0
  y = 0
  z = 0
  set(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
  }
  setScalar(n: number) {
    this.x = this.y = this.z = n
  }
}
class MeshStub {
  position = new Vec()
  rotation = new Vec()
  scale = new Vec()
  visible = true
  renderOrder = 0
  constructor(
    public geometry: { dispose: () => void; disposed?: boolean },
    public material: {
      opacity: number
      dispose: () => void
      disposed?: boolean
    },
  ) {}
}
const THREE_STUB = {
  LinearFilter: 'linear',
  LinearMipmapLinearFilter: 'mipmap',
  BoxGeometry: class {
    disposed = false
    dispose() {
      this.disposed = true
    }
  },
  SphereGeometry: class {
    disposed = false
    dispose() {
      this.disposed = true
    }
  },
  TorusGeometry: class {
    disposed = false
    dispose() {
      this.disposed = true
    }
  },
  TorusKnotGeometry: class {
    disposed = false
    dispose() {
      this.disposed = true
    }
  },
  MeshStandardMaterial: class {
    opacity = 1
    disposed = false
    color: string
    params: Record<string, unknown>
    constructor(opts: { color: string }) {
      this.color = opts.color
      this.params = opts as unknown as Record<string, unknown>
    }
    dispose() {
      this.disposed = true
    }
  },
  MeshPhysicalMaterial: class {
    opacity = 1
    disposed = false
    params: Record<string, unknown>
    constructor(opts: Record<string, unknown>) {
      this.params = opts
    }
    dispose() {
      this.disposed = true
    }
  },
  Mesh: MeshStub,
}

/** ctx.utils.TextGeometry stub — records inputs, reports a 2×0.7×0.25 box. */
class TextGeometryStub {
  disposed = false
  text: string
  opts: Record<string, unknown>
  boundingBox: { min: Record<string, number>; max: Record<string, number> }
  constructor(text: string, opts: Record<string, unknown>) {
    this.text = text
    this.opts = opts
    // Mirror three r183: the extrusion option is `depth`; the legacy
    // `height` alias is IGNORED and the default is 50 — which is exactly
    // the drift that shipped 3D text as a sliver. Deriving z from opts
    // makes the norm assertion below catch a regression to `height`.
    const depth = typeof opts.depth === 'number' ? opts.depth : 50
    this.boundingBox = {
      min: { x: -1, y: -0.35, z: 0 },
      max: { x: 1, y: 0.35, z: depth },
    }
  }
  computeBoundingBox() {}
  center() {}
  dispose() {
    this.disposed = true
  }
}

const g = globalThis as Record<string, unknown>
afterEach(() => {
  delete g.window
  delete g.__vosTimeline
})

function harness(objects?: ObjectClip[]) {
  const { config, data } = lowerToComposition(makeDoc(objects))
  const onFrame = bothFrames(config)
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
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop: () => {} })
        return () => {}
      },
      set: () => true,
    },
  )
  const layer = () => ({
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
  const video = {
    videoWidth: 1600,
    videoHeight: 900,
    readyState: 2,
    paused: true,
    currentTime: 0,
    play: () => undefined,
    pause: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }
  const refs = {
    bg: layer(),
    card: layer(),
    ov: layer(),
    objects: { group, pool },
    video,
    cam: null,
  }
  const frame = (time: number, dataOverride?: Record<string, unknown>) =>
    onFrame(
      {
        time,
        data: dataOverride ?? data,
        THREE: THREE_STUB,
        utils: { TextGeometry: TextGeometryStub },
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
  return { frame, group, pool, data }
}

describe('object clips (V3)', () => {
  it('omits objects from data when absent (byte parity) and skips with no pool', () => {
    expect('objects' in lowerToComposition(makeDoc()).data).toBe(false)
  })

  it('creates the mesh once and poses it (frame-fraction → world)', () => {
    const h = harness([clip()])
    h.frame(1.5)
    h.frame(1.6)
    expect(h.pool.size).toBe(1)
    expect(h.group.children.length).toBe(1)
    const m = h.group.children[0] as MeshStub
    expect(m.renderOrder).toBe(1.5)
    // x = 0.8 → right of center; y = 0.3 → above center (world y up); z toward camera.
    expect(m.position.x).toBeGreaterThan(0)
    expect(m.position.y).toBeGreaterThan(0)
    expect(m.position.z).toBeCloseTo(-3.5, 6) // CARD_Z(-4) + 0.5
    expect(m.scale.x).toBeGreaterThan(0)
    expect(m.visible).toBe(true)
  })

  it('span gates visibility and fades edges', () => {
    const h = harness([clip()])
    h.frame(0.1) // before span
    const m = h.group.children[0] as MeshStub
    expect(m.visible).toBe(false)
    h.frame(0.6) // 0.1s into span → mid-fade
    expect(m.visible).toBe(true)
    expect(m.material.opacity).toBeGreaterThan(0)
    expect(m.material.opacity).toBeLessThan(1)
    h.frame(1.5) // hold
    expect(m.material.opacity).toBe(1)
  })

  it('spin is deterministic (same t → same pose)', () => {
    const h1 = harness([clip({ animation: 'spin' })])
    const h2 = harness([clip({ animation: 'spin' })])
    h1.frame(1.7)
    h2.frame(1.7)
    const a = (h1.group.children[0] as MeshStub).rotation.y
    const b = (h2.group.children[0] as MeshStub).rotation.y
    expect(a).toBeCloseTo(b, 12)
    h1.frame(2.4)
    expect((h1.group.children[0] as MeshStub).rotation.y).not.toBeCloseTo(a, 6)
  })

  it('asset change recreates; removal disposes (live SET_DATA)', () => {
    const h = harness([clip()])
    h.frame(1.5)
    const first = h.group.children[0] as MeshStub
    // Change the shape via a data override (what SET_DATA delivers).
    const changed = JSON.parse(JSON.stringify(h.data)) as Record<
      string,
      unknown
    >
    ;(changed.objects as Record<string, Record<string, unknown>>[])[0].asset = {
      kind: 'primitive',
      shape: 'cube',
      color: '#fff',
    }
    h.frame(1.5, changed)
    expect(first.geometry.disposed).toBe(true)
    expect(h.pool.size).toBe(1)
    const second = h.group.children[0] as MeshStub
    expect(second).not.toBe(first)
    // Remove entirely.
    const empty = { ...changed, objects: [] }
    h.frame(1.5, empty)
    expect(h.pool.size).toBe(0)
    expect(h.group.children.length).toBe(0)
    expect(second.geometry.disposed).toBe(true)
  })

  it('gltf: skipped while unloaded, cloned + normalized once cached (V3b)', () => {
    const h = harness([clip({ asset: { kind: 'gltf', key: '/m.glb' } })])
    h.frame(1.5)
    expect(h.pool.size).toBe(0) // not loaded yet → prop simply absent
    // Seed the SETUP cache (what the GLTFLoader preload produces).
    const child = {
      isMesh: true,
      renderOrder: 0,
      material: {
        opacity: 1,
        transparent: false,
        clone() {
          return this
        },
      },
    }
    const root = {
      position: new Vec(),
      rotation: new Vec(),
      scale: new Vec(),
      visible: true,
      clone: () => root,
      traverse: (fn: (n: unknown) => void) => fn(child),
    }
    const ns = (g.window as { __vos__: Record<string, unknown> }).__vos__
    ns.objCache = new Map([
      ['/m.glb', { scene: { clone: () => root }, norm: 0.5 }],
    ])
    h.frame(1.5)
    expect(h.pool.size).toBe(1)
    expect(child.renderOrder).toBe(1.5)
    expect(child.material.transparent).toBe(true)
    expect(child.material.opacity).toBe(1) // mid-span hold
    expect(root.scale.x).toBeGreaterThan(0) // norm factor applied
  })

  it('text3d: lowering resolves url/material/depth; unknown typeface falls back', () => {
    const h = harness([
      clip({
        asset: {
          kind: 'text3d',
          text: 'Launch',
          typeface: 'Playfair Display',
          material: 'neon',
          color: '#ff5148',
        },
      }),
      clip({
        id: 'o2',
        asset: { kind: 'text3d', text: 'X', typeface: 'Comic Serif Pro' },
      }),
    ])
    const objects = h.data.objects as Record<string, any>[]
    expect(objects[0].asset).toMatchObject({
      kind: 'text3d',
      text: 'Launch',
      url: 'https://assets.vos.so/typefaces/playfair-display.typeface.json',
      depth: 0.25,
      bevel: true,
      mat: {
        type: 'standard',
        params: { color: '#ff5148', emissive: '#ff5148' },
      },
    })
    // Unknown typeface → the house face, standard material, default ink.
    expect(objects[1].asset.url).toBe(
      'https://assets.vos.so/typefaces/lexend.typeface.json',
    )
    expect(objects[1].asset.mat.type).toBe('standard')
  })

  it('text3d: skipped while the typeface is unloaded, built once cached', () => {
    const h = harness([
      clip({ asset: { kind: 'text3d', text: 'Vos', material: 'glass' } }),
    ])
    h.frame(1.5)
    expect(h.pool.size).toBe(0) // typeface not cached → prop simply absent
    const ns = (g.window as { __vos__: Record<string, unknown> }).__vos__
    const url = (h.data.objects as any[])[0].asset.url
    ns.fontCache = new Map([[url, { isFont: true }]])
    h.frame(1.5)
    expect(h.pool.size).toBe(1)
    const entry = h.pool.get('p0') as {
      mesh: { geometry: TextGeometryStub; material: any; renderOrder: number }
      norm: number
    }
    expect(entry.mesh.geometry.text).toBe('Vos')
    expect(entry.mesh.geometry.opts.bevelEnabled).toBe(true)
    // glass = translucent MeshPhysicalMaterial — deliberately NO
    // transmission (its internal pass composites nothing in the layered
    // compositor: measured invisible on SwiftShader) and no side override
    // (single-sided is the SwiftShader constraint).
    expect(entry.mesh.material.params.opacity).toBe(0.55)
    expect('transmission' in entry.mesh.material.params).toBe(false)
    expect('side' in entry.mesh.material.params).toBe(false)
    expect(entry.mesh.material.transparent).toBe(true)
    // the span fade multiplies onto the preset's base opacity
    expect((entry as unknown as { baseA: number }).baseA).toBe(0.55)
    expect(entry.mesh.renderOrder).toBe(1.5)
    // bbox 2×0.7×0.25 → norm = 1/2, applied through the scale path
    expect(entry.norm).toBeCloseTo(0.5, 6)
    expect((entry.mesh as any).scale.x).toBeGreaterThan(0)
  })

  it('text3d: a text edit changes the sig — mesh rebuilt, old one disposed', () => {
    const h = harness([clip({ asset: { kind: 'text3d', text: 'One' } })])
    const ns = (g.window as { __vos__: Record<string, unknown> }).__vos__
    const url = (h.data.objects as any[])[0].asset.url
    ns.fontCache = new Map([[url, { isFont: true }]])
    h.frame(1.5)
    const first = h.pool.get('p0') as { mesh: { geometry: TextGeometryStub } }
    expect(first.mesh.geometry.text).toBe('One')

    // Live SET_DATA: same clip id, new text (re-lower like the studio would).
    const edited = structuredClone(h.data) as Record<string, any>
    edited.objects[0].asset.text = 'Two'
    h.frame(1.5, edited)
    const second = h.pool.get('p0') as { mesh: { geometry: TextGeometryStub } }
    expect(second.mesh.geometry.text).toBe('Two')
    expect(first.mesh.geometry.disposed).toBe(true)
    expect(h.group.children.length).toBe(1)
  })
})
