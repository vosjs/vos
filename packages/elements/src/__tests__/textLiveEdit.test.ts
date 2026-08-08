import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  mergeQueuedPatches,
  mergeTextPatch,
  rasterPropPatch,
  renderTextElement,
} from '../renderers/text'

// Minimal DOM/canvas stub: 10 design px per character, fixed font metrics.
// (No `letterSpacing` property → exercises the manual fallback path; THREE
// objects are pure math until a renderer uploads them, so real three works.)
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

const element = (): any => ({
  id: 't',
  type: 'text',
  content: 'Hi',
  position: 'center',
  font: { size: 24 },
})

describe('live text re-render', () => {
  it('rerender(content) resizes geometry in place, mesh identity stable', () => {
    const el = element()
    const r = renderTextElement(el, RESOLUTION, THREE)
    // 'Hi' = 20 design px + 2×10 padding.
    expect(r.width).toBe(40)
    const mesh = r.mesh
    const mapBefore = (mesh.material as THREE.MeshBasicMaterial).map

    const dims = r.rerender({ content: 'Hello!' })
    expect(dims.width).toBe(80) // 60 + padding
    expect(r.mesh).toBe(mesh) // identity persists: bindings stay valid
    expect((mesh.geometry as THREE.PlaneGeometry).parameters.width).toBe(80)
    // Texture swapped (resized canvas needs fresh GPU storage).
    expect((mesh.material as THREE.MeshBasicMaterial).map).not.toBe(mapBefore)
    // The element config was merged in place (the session's live truth).
    expect(el.content).toBe('Hello!')
  })

  it('rerender(font.size) rescales the block height', () => {
    const r = renderTextElement(element(), RESOLUTION, THREE)
    const before = r.mesh.geometry as THREE.PlaneGeometry
    expect(before.parameters.height).toBe(45) // 20+5 metrics + 2×10 padding
    r.rerender({ font: { size: 48 } })
    const after = r.mesh.geometry as THREE.PlaneGeometry
    // Stubbed metrics are size-independent; the geometry still rebuilt.
    expect(after).not.toBe(before)
  })

  it('rerender(stroke) grows padding; stroke null removes it', () => {
    const el = element()
    const r = renderTextElement(el, RESOLUTION, THREE)
    const grown = r.rerender({ stroke: { color: '#000', width: 4 } })
    expect(grown.width).toBe(20 + 2 * (4 * 2 + 10)) // stroke doubles into padding
    const back = r.rerender({ stroke: null })
    expect(back.width).toBe(40)
    expect(el.stroke).toBeUndefined()
  })
})

describe('raster prop mapping', () => {
  it('maps proxy props to config patches', () => {
    expect(rasterPropPatch('content', 'Yo', {})).toEqual({ content: 'Yo' })
    expect(rasterPropPatch('fontSize', 32, {})).toEqual({
      font: { size: 32 },
    })
    expect(rasterPropPatch('color', '#fff', {})).toEqual({
      font: { color: '#fff' },
    })
    expect(rasterPropPatch('x', 5, {})).toBeNull()
  })

  it('stroke props keep the other half of the pair', () => {
    expect(
      rasterPropPatch('strokeWidth', 3, {
        stroke: { color: '#123', width: 1 },
      }),
    ).toEqual({ stroke: { color: '#123', width: 3 } })
    expect(rasterPropPatch('strokeWidth', 0, {})).toEqual({ stroke: null })
    expect(rasterPropPatch('strokeColor', '#abc', {})).toEqual({
      stroke: { color: '#abc', width: 2 },
    })
  })

  it('queued patches coalesce with font/stroke sub-merges', () => {
    const merged = mergeQueuedPatches(
      { content: 'a', font: { size: 10 } },
      { font: { color: '#fff' }, stroke: { color: '#000', width: 1 } },
    )
    expect(merged).toEqual({
      content: 'a',
      font: { size: 10, color: '#fff' },
      stroke: { color: '#000', width: 1 },
    })
  })

  it('mergeTextPatch merges font and clears stroke on null', () => {
    const el: any = { content: 'x', font: { size: 24, color: '#fff' } }
    mergeTextPatch(el, {
      font: { size: 48 },
      stroke: { color: '#0f0', width: 2 },
    })
    expect(el.font).toEqual({ size: 48, color: '#fff' })
    expect(el.stroke).toEqual({ color: '#0f0', width: 2 })
    mergeTextPatch(el, { stroke: null })
    expect(el.stroke).toBeUndefined()
  })
})
