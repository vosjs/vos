import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  extractTextBindings,
  isDataRef,
  resolveTextElement,
} from '../dataBinding'
import { renderElements } from '../renderElements'

// Same minimal DOM/canvas stub as textLiveEdit.test.ts: 10 design px per
// character, fixed font metrics. THREE objects are pure math until a
// renderer uploads them, so real three works.
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

describe('data refs', () => {
  it('isDataRef accepts {$data: key} and rejects everything else', () => {
    expect(isDataRef({ $data: 'headline' })).toBe(true)
    expect(isDataRef('headline')).toBe(false)
    expect(isDataRef({ $data: '' })).toBe(false)
    expect(isDataRef({ $data: 7 })).toBe(false)
    expect(isDataRef(null)).toBe(false)
  })

  it('extractTextBindings maps bound props to data keys', () => {
    expect(
      extractTextBindings({
        type: 'text',
        content: { $data: 'headline' },
        font: { family: { $data: 'font' }, color: { $data: 'ink' }, size: 24 },
      }),
    ).toEqual({ content: 'headline', family: 'font', color: 'ink' })
    expect(extractTextBindings({ type: 'text', content: 'static' })).toBeNull()
    expect(
      extractTextBindings({ type: 'image', src: { $data: 'x' } }),
    ).toBeNull()
  })

  it('resolveTextElement substitutes values and falls back on bad data', () => {
    const config = {
      type: 'text',
      content: { $data: 'headline' },
      font: { family: { $data: 'font' }, size: 24 },
    }
    const bindings = extractTextBindings(config)!
    const resolved = resolveTextElement(config, bindings, {
      headline: 'Yo',
      font: 'Playfair Display',
    })
    expect(resolved.content).toBe('Yo')
    expect(resolved.font.family).toBe('Playfair Display')
    expect(resolved.font.size).toBe(24)
    // raw config untouched
    expect(config.content).toEqual({ $data: 'headline' })

    // missing key: content empties, family falls back to renderer default
    const fallback = resolveTextElement(config, bindings, {})
    expect(fallback.content).toBe('')
    expect(fallback.font.family).toBeUndefined()
  })
})

describe('bound elements through renderElements', () => {
  const scenes = () => ({ 100: new THREE.Scene() })

  it('resolves bindings at boot and re-resolves on updateData', async () => {
    const elements = await renderElements(
      [
        {
          id: 't',
          type: 'text',
          content: { $data: 'headline' },
          position: 'center',
          font: { size: 24, color: { $data: 'ink' } },
        },
      ],
      scenes(),
      RESOLUTION,
      THREE,
      { headline: 'Yo', ink: '#ff0000' },
    )
    const inst = elements.get('t')!
    // 'Yo' = 20 design px + 2×10 padding
    expect(inst.config.content).toBe('Yo')
    expect(inst.config.font.color).toBe('#ff0000')
    const mesh = inst.mesh as THREE.Mesh
    expect((mesh.geometry as THREE.PlaneGeometry).parameters.width).toBe(40)

    // fresh data re-rasters in place (microtask-coalesced)
    expect(inst.updateData({ headline: 'Hello!', ink: '#ff0000' })).toBe(true)
    await flushMicrotasks()
    expect(inst.config.content).toBe('Hello!')
    expect(inst.mesh).toBe(mesh) // identity persists
    expect((mesh.geometry as THREE.PlaneGeometry).parameters.width).toBe(80)

    // unchanged data is a no-op
    expect(inst.updateData({ headline: 'Hello!', ink: '#ff0000' })).toBe(false)
  })

  it('refreshRaster re-draws with unchanged values (the late-webfont hook)', async () => {
    const elements = await renderElements(
      [{ id: 't', type: 'text', content: 'Hi', position: 'center' }],
      scenes(),
      RESOLUTION,
      THREE,
    )
    const inst = elements.get('t')!
    const mesh = inst.mesh as THREE.Mesh
    const mapBefore = (mesh.material as THREE.MeshBasicMaterial).map
    expect(inst.refreshRaster()).toBe(true)
    await flushMicrotasks()
    // same values, fresh raster: texture swapped, mesh identity stable
    expect(inst.mesh).toBe(mesh)
    expect((mesh.material as THREE.MeshBasicMaterial).map).not.toBe(mapBefore)
    expect(inst.config.content).toBe('Hi')
  })

  it('unbound elements ignore updateData', async () => {
    const elements = await renderElements(
      [{ id: 't', type: 'text', content: 'Static', position: 'center' }],
      scenes(),
      RESOLUTION,
      THREE,
      { headline: 'ignored' },
    )
    const inst = elements.get('t')!
    expect(inst.config.content).toBe('Static')
    expect(inst.updateData({ headline: 'still ignored' })).toBe(false)
  })

  it('bound split text rebuilds its units on updateData and says so', async () => {
    const scene = scenes()
    const elements = await renderElements(
      [
        {
          id: 't',
          type: 'text',
          content: { $data: 'headline' },
          position: 'center',
          split: { type: 'chars' },
          font: { color: { $data: 'ink' } },
        },
      ],
      scene,
      RESOLUTION,
      THREE,
      { headline: 'Abc', ink: '#ff0000' },
    )
    const inst = elements.get('t')!
    expect(inst.config.content).toBe('Abc')
    expect(inst.segments).toHaveLength(3)
    const oldSegments = inst.segments
    const oldProps = inst.props
    expect(scene[100].children).toHaveLength(3)

    // The words are structure: new units, new props, the old meshes gone.
    expect(inst.updateData({ headline: 'Abcdef', ink: '#ff0000' })).toBe(true)
    expect(inst.config.content).toBe('Abcdef')
    expect(inst.segments).toHaveLength(6)
    expect(inst.segments).not.toBe(oldSegments)
    expect(inst.props).not.toBe(oldProps)
    expect(scene[100].children).toHaveLength(6)
    expect(inst.structural).toBe(true)

    // A colour edit rebuilds too; unchanged data does nothing.
    inst.structural = false
    expect(inst.updateData({ headline: 'Abcdef', ink: '#00ff00' })).toBe(true)
    expect(inst.config.font.color).toBe('#00ff00')
    expect(scene[100].children).toHaveLength(6)
    inst.structural = false
    expect(inst.updateData({ headline: 'Abcdef', ink: '#00ff00' })).toBe(false)
    expect(inst.structural).toBe(false)
  })

  it('takeStructural reports a rebuild once, then clears it', async () => {
    const { createVosElements } = await import('../index')
    const api = createVosElements(THREE)
    const elements = await renderElements(
      [
        {
          id: 't',
          type: 'text',
          content: { $data: 'w' },
          position: 'center',
          split: { type: 'chars' },
        },
        { id: 'u', type: 'text', content: { $data: 'x' }, position: 'center' },
      ],
      scenes(),
      RESOLUTION,
      THREE,
      { w: 'Go', x: 'Hi' },
    )
    // A plain bound text re-rasters in place: not structural.
    expect(api.updateData(elements, { w: 'Go', x: 'Hello' })).toBe(true)
    expect(api.takeStructural(elements)).toBe(false)
    expect(api.updateData(elements, { w: 'Gone', x: 'Hello' })).toBe(true)
    expect(api.takeStructural(elements)).toBe(true)
    expect(api.takeStructural(elements)).toBe(false)
  })
})
