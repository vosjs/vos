import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileVosConfig } from '../compiler/compileVosConfig'
import type { VosConfigJson } from '../types'

// TODO: migrate these JSON fixtures into the repo (e.g. src/__tests__/fixtures)
// and drop the skipIf. They are not yet part of the open-source repo.
const configsDir = join(__dirname, '../../../../data/test/configs')
const hasFixtures = existsSync(configsDir)

function loadConfig(name: string): VosConfigJson {
  return JSON.parse(readFileSync(join(configsDir, name), 'utf-8'))
}

describe.skipIf(!hasFixtures)('compileVosConfig', () => {
  describe('DRACO auto-config', () => {
    it('includes DRACOLoader import when config has setup', () => {
      const config = loadConfig('model-draco-auto.json')
      const output = compileVosConfig(config)
      expect(output).toContain(
        "import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';",
      )
    })

    it('creates DRACO loader and sets decoder path', () => {
      const config = loadConfig('model-draco-auto.json')
      const output = compileVosConfig(config)
      expect(output).toContain('const _dracoLoader = new DRACOLoader()')
      expect(output).toContain('_dracoLoader.setDecoderPath(')
      expect(output).toContain('window.__THREE_DRACO_PATH__')
    })

    it('attaches DRACO loader to GLTFLoader', () => {
      const config = loadConfig('model-draco-auto.json')
      const output = compileVosConfig(config)
      expect(output).toContain('const _gltfLoader = new GLTFLoader()')
      expect(output).toContain('_gltfLoader.setDRACOLoader(_dracoLoader)')
    })

    it('provides loaders registry with gltf and draco instances', () => {
      const config = loadConfig('model-draco-auto.json')
      const output = compileVosConfig(config)
      expect(output).toContain('gltf: _gltfLoader')
      expect(output).toContain('draco: _dracoLoader')
    })
  })

  describe('EXRLoader support', () => {
    it('includes EXRLoader import when config has setup', () => {
      const config = loadConfig('exr-environment.json')
      const output = compileVosConfig(config)
      expect(output).toContain(
        "import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';",
      )
    })

    it('includes HDRLoader import for HDR config', () => {
      const config = loadConfig('hdr-environment.json')
      const output = compileVosConfig(config)
      expect(output).toContain(
        "import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';",
      )
    })
  })

  describe('setup vs no-setup', () => {
    it('includes loaders registry when setup is present', () => {
      const config = loadConfig('model-draco-auto.json')
      const output = compileVosConfig(config)
      expect(output).toContain('const loaders = {')
      expect(output).toContain('const utils = {')
      expect(output).toContain('const setupContext = {')
    })

    it('omits loaders registry when setup is absent', () => {
      const config: VosConfigJson = {
        version: 2,
        duration: 3,
        camera: { preset: 'perspective' },
        createContent:
          '(ctx) => { const { THREE, scene } = ctx; const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(mesh); return { mesh }; }',
        createTimeline:
          '(ctx, content, duration) => { const { gsap } = ctx; return gsap.timeline().to(content.mesh.rotation, { y: Math.PI, duration }); }',
      }
      const output = compileVosConfig(config)
      expect(output).not.toContain('const loaders = {')
      expect(output).not.toContain('const _dracoLoader')
      expect(output).not.toContain('DRACOLoader')
    })
  })

  describe('combined config', () => {
    it('compiles model + HDR combined config with detected loader imports', () => {
      const config = loadConfig('combined-model-hdr.json')
      const output = compileVosConfig(config)
      // Config uses loaders.HDRLoader() and loaders.gltf → detects these
      expect(output).toContain('GLTFLoader')
      expect(output).toContain('HDRLoader')
      expect(output).toContain('DRACOLoader')
      expect(output).toContain('initVos')
      // EXRLoader not referenced in this config → not included
      expect(output).not.toContain('EXRLoader')
    })
  })

  describe('selective addon detection', () => {
    it('only includes detected loaders when setup is present', () => {
      const config = loadConfig('model-draco-auto.json')
      const output = compileVosConfig(config)
      expect(output).toContain('GLTFLoader')
      expect(output).toContain('DRACOLoader')
      // These aren't referenced in model-draco-auto.json
      expect(output).not.toContain('FontLoader')
      expect(output).not.toContain('EXRLoader')
      expect(output).not.toContain('HDRLoader')
    })
  })

  describe('animation config', () => {
    it('compiles config with onFrame hook', () => {
      const config = loadConfig('model-with-animations.json')
      const output = compileVosConfig(config)
      expect(output).toContain('const onFrame =')
      expect(output).toContain('mixer')
    })
  })

  describe('validation', () => {
    it('throws on invalid config (missing createContent)', () => {
      const config = {
        version: 2,
        duration: 5,
        camera: { preset: 'perspective' },
        createTimeline: '() => gsap.timeline()',
      } as unknown as VosConfigJson

      expect(() => compileVosConfig(config)).toThrow('Invalid VosConfigJson')
    })

    it('throws on invalid config (negative duration)', () => {
      const config = {
        version: 2,
        duration: -1,
        camera: { preset: 'perspective' },
        createContent: '() => ({})',
        createTimeline: '() => gsap.timeline()',
      } as unknown as VosConfigJson

      expect(() => compileVosConfig(config)).toThrow('Invalid VosConfigJson')
    })
  })

  describe('v1 backward compatibility', () => {
    it('compiles a v1 config with repeat field', () => {
      const config: VosConfigJson = {
        version: 1,
        duration: 3,
        repeat: -1,
        camera: { preset: 'perspective' },
        createContent: '(ctx) => { return { objects: [], refs: {} }; }',
        createTimeline:
          '(ctx, content, duration) => { return ctx.gsap.timeline({ paused: true }); }',
      } as any
      const output = compileVosConfig(config)
      expect(output).toContain('tl.repeat(-1)')
      expect(output).not.toContain('REPEAT')
    })
  })
})
