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

function editorApi(elements: Map<string, Inst>, scene: THREE.Scene) {
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
  const win = { innerWidth: 200, innerHeight: 100, addEventListener() {} }
  const doc = { querySelector: () => null }
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
    }[]
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
