import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import { generateRenderTemplate } from '../runtime/renderTemplate'
import type { VosConfigJson } from '../types/vosConfigJson'

// Declarative world-space objects: schema acceptance, codegen, GLTFLoader
// auto-detection, context/result exposure, and the protocol-3 bridge surface.

const base: VosConfigJson = {
  version: 2,
  duration: 4,
  camera: { preset: 'perspective', fov: 30 },
  createContent: '(ctx) => ({ objects: [], refs: {} })',
  createTimeline:
    "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); tl.to({}, { duration, ease: 'none' }); return tl; }",
}

const withObjects = (objects: Record<string, unknown>[]): VosConfigJson => ({
  ...base,
  objects,
})

describe('objects[] codegen', () => {
  it('compiles without objects — empty map + no-op sync (back-compat)', () => {
    const code = compileVosConfig(base)
    expect(code).toContain('const objects = new Map()')
    expect(code).toContain('const __syncObjects = () => {}')
    expect(code).not.toContain('objectsConfig')
  })

  it('builds primitives from config and exposes objects on the context', () => {
    const code = compileVosConfig(
      withObjects([
        {
          id: 'p0',
          asset: { kind: 'primitive', shape: 'knot', color: '#ffb03a' },
          transform: { x: 1, y: 0.5, z: -2, ry: 40, scale: 0.6 },
        },
      ]),
    )
    expect(code).toContain('objectsConfig')
    expect(code).toContain('TorusKnotGeometry')
    expect(code).toContain('MeshStandardMaterial')
    expect(code).toContain('__syncObjects()')
    // exposed to createContent/onFrame and on the result for the bridge
    expect(code).toMatch(/objects,\s*\n\s*get data\(\)/)
    expect(code).toContain('__syncObjects,')
    // the MAIN camera must ride the result — OBJECT_HIT_TEST raycasts with it
    // (caught by real-browser verification: without this every hit was null)
    expect(code).toMatch(/__syncObjects,\s*\n\s*camera,/)
  })

  it('unlit primitives use a basic material (no lights required)', () => {
    const code = compileVosConfig(
      withObjects([
        { id: 'p0', asset: { kind: 'primitive', shape: 'cube', unlit: true } },
      ]),
    )
    expect(code).toContain('MeshBasicMaterial')
  })

  it('a gltf object auto-detects the GLTFLoader addon (objects are data, not code)', () => {
    const code = compileVosConfig(
      withObjects([{ id: 'm0', asset: { kind: 'gltf', key: 'https://x/m.glb' } }]),
    )
    expect(code).toContain('GLTFLoader')
    expect(code).toMatch(/import .*GLTFLoader.* from/)
    // bbox normalization so scale is asset-independent
    expect(code).toContain('__objNorm')
  })

  it('primitive-only configs do not import GLTFLoader', () => {
    const code = compileVosConfig(
      withObjects([{ id: 'p0', asset: { kind: 'primitive', shape: 'sphere' } }]),
    )
    expect(code).not.toMatch(/import .*GLTFLoader.* from/)
  })

  it('a text3d object auto-detects FontLoader + TextGeometry and normalizes', () => {
    const code = compileVosConfig(
      withObjects([
        {
          id: 't0',
          asset: {
            kind: 'text3d',
            text: 'Vos',
            typeface: 'https://x/lexend.typeface.json',
          },
        },
      ]),
    )
    expect(code).toMatch(/import .*FontLoader.* from/)
    expect(code).toMatch(/import .*TextGeometry.* from/)
    // centered + bbox-normalized like GLB, so scale is asset-independent
    expect(code).toContain('geo.center()')
    expect(code).toContain('__objNorm')
    // defaults resolve in the generated builder
    expect(code).toContain('a.depth == null ? 0.25 : a.depth')
    expect(code).toContain('bevelEnabled: a.bevel !== false')
  })

  it('primitive-only configs do not import FontLoader', () => {
    const code = compileVosConfig(
      withObjects([{ id: 'p0', asset: { kind: 'primitive', shape: 'sphere' } }]),
    )
    expect(code).not.toMatch(/import .*FontLoader.* from/)
  })
})

describe('objects bridge (protocol 3)', () => {
  it('editor template handles SET_OBJECT_PROPS and OBJECT_HIT_TEST', () => {
    const html = generateRenderTemplate('', { mode: 'playback', editor: true })
    expect(html).toContain("case 'SET_OBJECT_PROPS'")
    expect(html).toContain("case 'OBJECT_HIT_TEST'")
    expect(html).toContain('OBJECT_HIT_RESULT')
    expect(html).toContain('objectHitTest')
    expect(html).toContain('setObjectProps')
  })

  it('non-editor template exposes no object editor commands', () => {
    const html = generateRenderTemplate('', { mode: 'playback' })
    expect(html).not.toContain("case 'SET_OBJECT_PROPS'")
    expect(html).not.toContain("case 'OBJECT_HIT_TEST'")
  })
})
