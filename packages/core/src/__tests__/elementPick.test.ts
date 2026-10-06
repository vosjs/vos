import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { editorExtension } from '../runtime/renderTemplate'

/**
 * The editor bridge's picking, run for real: the template's editor API built
 * over a three.js scene through an orthographic overlay camera (200x100 px
 * viewport, one world unit per px, origin at the centre).
 */

type Inst = {
  config: { zIndex?: number }
  mesh: THREE.Mesh
  meshes?: () => THREE.Mesh[]
  refreshRaster?: () => boolean
}

const plane = (
  w: number,
  h: number,
  x: number,
  y: number,
  opacity = 1,
  parent?: THREE.Object3D,
) => {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ transparent: true, opacity }),
  )
  m.position.set(x, y, 0)
  parent?.add(m)
  return m
}

function editorApi(
  elements: Map<string, Inst>,
  scene: THREE.Scene,
  page: { FontFace?: unknown; fonts?: unknown } = {},
) {
  for (const inst of elements.values())
    for (const m of inst.meshes?.() ?? [inst.mesh]) if (!m.parent) scene.add(m)
  scene.updateMatrixWorld(true)
  const overlayCamera = new THREE.OrthographicCamera(
    -100,
    100,
    50,
    -50,
    0.1,
    100,
  )
  overlayCamera.position.z = 10
  const win = {
    innerWidth: 200,
    innerHeight: 100,
    addEventListener() {},
    FontFace: page.FontFace,
  }
  const doc = { querySelector: () => null, fonts: page.fonts }
  const build = new Function(
    'THREE',
    '__current',
    'window',
    'document',
    '__post',
    `${editorExtension(true)}\nreturn __editorApi;`,
  )
  return build(THREE, { elements, overlayCamera }, win, doc, () => {}) as {
    hitTest: (x: number, y: number) => string | null
    getRects: () => {
      id: string
      x: number
      y: number
      width: number
      height: number
      visible: boolean
      quad?: [number, number][]
    }[]
    registerFonts: (fonts: unknown) => void
  }
}

/** Viewport px → world: x - 100, 50 - y. */
const at = (x: number, y: number): [number, number] => [x + 100, 50 - y]

describe('editor bridge picking', () => {
  it('presses THROUGH an element faded out at this moment', () => {
    const scene = new THREE.Scene()
    const elements = new Map<string, Inst>([
      ['title', { config: { zIndex: 100 }, mesh: plane(160, 40, 0, 0) }],
      ['ghost', { config: { zIndex: 200 }, mesh: plane(40, 20, 0, 0, 0) }],
    ])
    const api = editorApi(elements, scene)
    expect(api.hitTest(...at(0, 0))).toBe('title')
    const ghost = api.getRects().find((r) => r.id === 'ghost')!
    expect(ghost.visible).toBe(false)
    expect(ghost.width).toBeCloseTo(40)
    // Faded back in, it is on top again.
    ;(elements.get('ghost')!.mesh.material as THREE.MeshBasicMaterial).opacity =
      0.6
    expect(api.hitTest(...at(0, 0))).toBe('ghost')
  })

  it('picks a split word by ANY of its units and boxes the whole word', () => {
    const scene = new THREE.Scene()
    const a = plane(20, 10, -60, 30)
    const b = plane(20, 10, 60, 30)
    const elements = new Map<string, Inst>([
      ['word', { config: {}, mesh: a, meshes: () => [a, b] }],
    ])
    const api = editorApi(elements, scene)
    expect(api.hitTest(...at(60, 30))).toBe('word')
    const r = api.getRects()[0]
    expect(r.x).toBeCloseTo(30) // left edge of the first unit
    expect(r.width).toBeCloseTo(140) // to the right edge of the last
    expect(r.visible).toBe(true)
  })

  it('a typewriter word whose units are all at 0 is not there yet', () => {
    const scene = new THREE.Scene()
    const a = plane(20, 10, -60, 30, 0)
    const b = plane(20, 10, 60, 30, 0)
    const api = editorApi(
      new Map([['word', { config: {}, mesh: a, meshes: () => [a, b] }]]),
      scene,
    )
    expect(api.hitTest(...at(60, 30))).toBeNull()
    expect(api.getRects()[0].visible).toBe(false)
  })

  it('says where one plane’s corners are, through its rotation and scale', () => {
    const scene = new THREE.Scene()
    const m = plane(80, 20, 20, 10)
    const api = editorApi(new Map([['cap', { config: {}, mesh: m }]]), scene)
    // Unposed: the corners are the box's, top-left first and clockwise.
    // (World (20, 10) is viewport (120, 40); y runs down on screen.)
    const flat = api.getRects()[0].quad!
    expect(flat.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual([
      [80, 30],
      [160, 30],
      [160, 50],
      [80, 50],
    ])
    // Turned a quarter and doubled: the box grows to bound it, and the
    // corners say which way it faces and how large it is.
    m.rotation.z = Math.PI / 2
    m.scale.set(2, 2, 1)
    const r = api.getRects()[0]
    expect([r.width, r.height].map(Math.round)).toEqual([40, 160])
    const [tl, tr, , bl] = r.quad!
    expect(Math.hypot(tr[0] - tl[0], tr[1] - tl[1])).toBeCloseTo(160)
    expect(Math.hypot(bl[0] - tl[0], bl[1] - tl[1])).toBeCloseTo(40)
    // Counter-clockwise in the world is counter-clockwise on screen: the
    // top edge now runs straight up.
    expect(tr[0] - tl[0]).toBeCloseTo(0)
    expect(tr[1] - tl[1]).toBeCloseTo(-160)
  })

  it('a split word is many planes and has no corners of its own', () => {
    const scene = new THREE.Scene()
    const a = plane(20, 10, -60, 30)
    const b = plane(20, 10, 60, 30)
    const api = editorApi(
      new Map([['word', { config: {}, mesh: a, meshes: () => [a, b] }]]),
      scene,
    )
    expect(api.getRects()[0].quad).toBeUndefined()
  })

  it('puts a face on the page once, and redraws the text when it lands', async () => {
    const added: { family: string; src: string; weight: string }[] = []
    let redrawn = 0
    class Face {
      constructor(
        public family: string,
        public src: string,
        public desc: { weight: string; style: string },
      ) {}
      load() {
        return Promise.resolve(this)
      }
    }
    const scene = new THREE.Scene()
    const elements = new Map<string, Inst>([
      [
        'cap',
        {
          config: {},
          mesh: plane(40, 20, 0, 0),
          refreshRaster: () => {
            redrawn++
            return true
          },
        } as Inst,
      ],
    ])
    const api = editorApi(elements, scene, {
      FontFace: Face,
      fonts: {
        add: (f: Face) =>
          added.push({ family: f.family, src: f.src, weight: f.desc.weight }),
      },
    })
    const bold = { family: 'Lexend', weight: 700, url: 'https://x/700.woff2' }
    api.registerFonts([bold, bold, { family: '', url: 'nope' }, null])
    api.registerFonts([bold])
    expect(added).toEqual([
      { family: 'Lexend', src: 'url(https://x/700.woff2)', weight: '700' },
    ])
    await Promise.resolve()
    await Promise.resolve()
    expect(redrawn).toBe(1)
    // Nothing to register, or a page with no font API: nothing happens.
    api.registerFonts(undefined)
    expect(added).toHaveLength(1)
  })

  it('an instance without meshes() still picks by its mesh', () => {
    const scene = new THREE.Scene()
    const api = editorApi(
      new Map([['old', { config: {}, mesh: plane(40, 20, 0, 0) }]]),
      scene,
    )
    expect(api.hitTest(...at(0, 0))).toBe('old')
  })

  it('a mesh under a hidden parent is not there', () => {
    const scene = new THREE.Scene()
    const group = new THREE.Group()
    group.visible = false
    scene.add(group)
    const m = plane(40, 20, 0, 0, 1, group)
    const api = editorApi(new Map([['hid', { config: {}, mesh: m }]]), scene)
    expect(api.hitTest(...at(0, 0))).toBeNull()
    expect(api.getRects()[0].visible).toBe(false)
  })

  it('an opaque material is seen whatever its opacity field says', () => {
    const scene = new THREE.Scene()
    const m = plane(40, 20, 0, 0, 0)
    ;(m.material as THREE.MeshBasicMaterial).transparent = false
    const api = editorApi(new Map([['solid', { config: {}, mesh: m }]]), scene)
    expect(api.hitTest(...at(0, 0))).toBe('solid')
  })
})
