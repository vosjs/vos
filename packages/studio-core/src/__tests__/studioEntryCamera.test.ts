import * as THREE from 'three'
import { lerpArray, sample } from '@vosjs/timeline'
import { describe, expect, it } from 'vitest'
import { STUDIO_ENTRY_ID, studioEntry } from '../lower/studioEntry'
import { CARD_FOV, CARD_Z } from '../stage'

// A prop sits on the ANCHOR's camera frustum plane at its depth, at the
// frame fraction it was placed at. The recording's camera (the origin, down
// -z, CARD_FOV) must reduce to the card program's constants; any other camera
// keeps the same screen fraction and depth.

const g = globalThis as Record<string, unknown>

function run(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null,
  prop: Record<string, unknown>,
  scene?: THREE.Scene,
) {
  const entry = studioEntry({})
  const onFrame = new Function(`return (${entry.onFrame})`)() as (
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
  g.__vosTimeline = { sample, lerpArray }
  const group = new THREE.Group()
  const pool = new Map()
  const c2d = new Proxy(
    {},
    { get: () => () => ({ width: 42 }), set: () => true },
  )
  const refs = {
    ov: {
      c2d,
      canvas: { width: 1920, height: 1080 },
      texture: { needsUpdate: false },
    },
    objects: { group, pool },
  }
  const ctx = {
    time: 1,
    data: { objects: [prop] },
    THREE,
    utils: {},
    loaders: {},
    renderer: undefined,
    camera,
    scene,
    resolution: {
      width: 1920,
      height: 1080,
      drawingBufferWidth: 1920,
      drawingBufferHeight: 1080,
    },
  }
  onFrame(ctx, { refs }, 1 / 30)
  onFrame(ctx, { refs }, 1 / 30)
  const mesh = (pool.get('p1') as { mesh: THREE.Object3D }).mesh
  return { mesh, group }
}

const prop = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  asset: { kind: 'primitive', shape: 'cube', color: '#e4e4e7' },
  x: 0.75,
  y: 0.25,
  z: 1,
  rx: 0,
  ry: 30,
  rz: 0,
  scale: 0.2,
  anim: null,
  ...over,
})

const tan = Math.tan((CARD_FOV * Math.PI) / 180 / 2)
const aspect = 1920 / 1080

describe('the studio entry places props on the anchor camera', () => {
  it("the recording's camera reduces to the card program's constants", () => {
    const cam = new THREE.PerspectiveCamera(CARD_FOV, aspect, 0.1, 100)
    const { mesh } = run(cam, prop())
    const dist = Math.abs(CARD_Z) - 1
    const planeH = 2 * dist * tan
    expect(mesh.position.x).toBeCloseTo((0.75 - 0.5) * planeH * aspect, 6)
    expect(mesh.position.y).toBeCloseTo(-(0.25 - 0.5) * planeH, 6)
    expect(mesh.position.z).toBeCloseTo(CARD_Z + 1, 6)
    const e = new THREE.Euler().setFromQuaternion(mesh.quaternion)
    expect((e.y * 180) / Math.PI).toBeCloseTo(30, 4)
    // The camera-less stub path (the stub harnesses) lands on the same numbers.
    const { mesh: bare } = run(null, prop())
    expect(bare.position.x).toBeCloseTo(mesh.position.x, 6)
    expect(bare.position.z).toBeCloseTo(mesh.position.z, 6)
  })

  it('a program camera anywhere keeps the screen fraction and the depth', () => {
    const cam = new THREE.PerspectiveCamera(60, aspect, 0.1, 100)
    cam.position.set(5, 2, 10)
    cam.lookAt(new THREE.Vector3(-3, 0, 0))
    cam.updateMatrixWorld()
    const { mesh } = run(cam, prop())
    // Projects back to the frame fraction it was placed at.
    const ndc = mesh.position.clone().project(cam)
    expect((ndc.x + 1) / 2).toBeCloseTo(0.75, 5)
    expect((1 - ndc.y) / 2).toBeCloseTo(0.25, 5)
    // At the reference depth minus z along the camera's own forward.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const along = mesh.position.clone().sub(cam.position).dot(forward)
    expect(along).toBeCloseTo(Math.abs(CARD_Z) - 1, 6)
    // Scale is a fraction of the frame height at the reference depth, whatever the fov.
    const refH = 2 * Math.abs(CARD_Z) * Math.tan((60 * Math.PI) / 180 / 2)
    expect(mesh.scale.x).toBeCloseTo(0.2 * refH, 6)
  })

  it('a fullscreen (orthographic) program camera keeps the prop in its box, lit', () => {
    // The engine's `fullscreen` preset: OrthographicCamera(-1, 1, 1, -1, 0, 1).
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    cam.updateMatrixWorld()
    const scene = new THREE.Scene()
    const { mesh, group } = run(cam, prop(), scene)
    group.updateMatrixWorld(true)
    // On the box, in WORLD space: x = (0.75 − 0.5) · 2, y = −(0.25 − 0.5) · 2,
    // mid-depth (the group carries the camera pose and the aspect squash).
    const world = mesh.getWorldPosition(new THREE.Vector3())
    expect(world.x).toBeCloseTo(0.5, 6)
    expect(world.y).toBeCloseTo(0.5, 6)
    expect(world.z).toBeCloseTo(-0.5, 6)
    const ndc = world.clone().project(cam)
    expect((ndc.x + 1) / 2).toBeCloseTo(0.75, 5)
    expect((1 - ndc.y) / 2).toBeCloseTo(0.25, 5)
    expect(Math.abs(ndc.z)).toBeLessThan(1)
    // Scale is a fraction of the box height; on the canvas the prop is ROUND:
    // the group squashes x by the pixel aspect (box 2×2 over 1920×1080).
    expect(mesh.scale.x).toBeCloseTo(0.2 * 2, 6)
    expect(group.scale.x).toBeCloseTo((2 * 1080) / (2 * 1920), 6)
    // A scene with no lights gets the entry's pair, in the prop group.
    expect(
      group.children.filter(
        (c) => (c as { isLight?: boolean }).isLight === true,
      ),
    ).toHaveLength(2)
  })

  it('leaves a lit scene alone', () => {
    const cam = new THREE.PerspectiveCamera(60, aspect, 0.1, 100)
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight())
    const { group } = run(cam, prop(), scene)
    expect(
      group.children.filter(
        (c) => (c as { isLight?: boolean }).isLight === true,
      ),
    ).toHaveLength(0)
  })

  it('is the same entry either anchor mounts', () => {
    expect(studioEntry({}).id).toBe(STUDIO_ENTRY_ID)
  })
})
