import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { renderElements } from '../renderElements'

// Same minimal DOM/canvas stub as dataBinding.test.ts: 10 design px per
// character, fixed font metrics, so 'Yo' is a 40 px block and 'Hello!' 80.
function makeFakeCtx() {
  return {
    font: '',
    textBaseline: '',
    textAlign: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: (t: string) => ({
      width: t.length * 10,
      fontBoundingBoxAscent: 20,
      fontBoundingBoxDescent: 5,
    }),
    fillText() {},
    strokeText() {},
    clearRect() {},
  }
}

beforeAll(() => {
  ;(globalThis as any).document = {
    createElement: () => {
      const ctx = makeFakeCtx()
      return { width: 0, height: 0, getContext: () => ctx }
    },
  }
})
afterAll(() => {
  delete (globalThis as any).document
})

const RESOLUTION = {
  width: 1920,
  height: 1080,
  pixelRatio: 1,
  drawingBufferWidth: 1920,
  drawingBufferHeight: 1080,
}

const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0))
const width = (mesh: THREE.Mesh) =>
  (mesh.geometry as THREE.PlaneGeometry).parameters.width

async function one(config: Record<string, unknown>) {
  const elements = await renderElements(
    [{ id: 't', type: 'text', font: { size: 24 }, ...config }],
    { 100: new THREE.Scene() },
    RESOLUTION,
    THREE,
  )
  return elements.get('t')!
}

describe('a raster write lands in the frame that made it', () => {
  it('flushRaster applies a queued content write at once', async () => {
    const inst = await one({ content: 'Yo', position: 'center' })
    const mesh = inst.mesh as THREE.Mesh
    expect(width(mesh)).toBe(40)

    // What onFrame does: write, then the engine flushes before it draws.
    inst.props.content = 'Hello!'
    expect(width(mesh)).toBe(40) // queued, not yet drawn
    inst.flushRaster()
    expect(width(mesh)).toBe(80) // in this frame, no microtask needed
    expect(inst.config.content).toBe('Hello!')

    // The fallback microtask finds nothing left to do.
    const map = (mesh.material as THREE.MeshBasicMaterial).map
    await flushMicrotasks()
    expect((mesh.material as THREE.MeshBasicMaterial).map).toBe(map)
  })

  it('flushRaster is a no-op when nothing is queued', async () => {
    const inst = await one({ content: 'Yo', position: 'center' })
    const mesh = inst.mesh as THREE.Mesh
    const map = (mesh.material as THREE.MeshBasicMaterial).map
    inst.flushRaster()
    expect((mesh.material as THREE.MeshBasicMaterial).map).toBe(map)
  })
})

describe('a re-raster keeps the offset a tween added', () => {
  it('moves the element to its new layout plus the tweened offset', async () => {
    // top-left: the layout depends on the width, so the base moves too.
    const inst = await one({ content: 'Yo', position: 'top-left' })
    const baseX = inst.props.x
    const baseY = inst.props.y

    // A tween slid it 50 px right and 30 px down (props space, y down).
    inst.props.x = baseX + 50
    inst.props.y = baseY + 30

    // The text grows by 40 design px: the centre of a top-left block moves
    // 20 px right (resolution scale 1), and the slide is kept on top.
    inst.props.content = 'Hello!'
    inst.flushRaster()
    expect(inst.props.x).toBe(baseX + 20 + 50)
    expect(inst.props.y).toBe(baseY + 30)
  })

  it('an element nothing moved still lands on its layout', async () => {
    const inst = await one({ content: 'Yo', position: 'top-left' })
    const baseX = inst.props.x
    inst.props.content = 'Hello!'
    inst.flushRaster()
    expect(inst.props.x).toBe(baseX + 20)
  })
})
