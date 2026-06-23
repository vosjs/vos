import { describe, expect, it } from 'vitest'
import {
  ADDON_REGISTRY,
  detectRequiredAddons,
  generateAddonImports,
  getRequiredAddons,
} from '../addons/registry'
import type { VosConfig, VosConfigJson } from '../types'

describe('ADDON_REGISTRY', () => {
  it('contains DRACOLoader entry', () => {
    expect(ADDON_REGISTRY.DRACOLoader).toMatchObject({
      path: 'three/addons/loaders/DRACOLoader.js',
      named: 'DRACOLoader',
      category: 'loader',
      condition: 'setup',
    })
  })

  it('contains EXRLoader entry', () => {
    expect(ADDON_REGISTRY.EXRLoader).toMatchObject({
      path: 'three/addons/loaders/EXRLoader.js',
      named: 'EXRLoader',
      category: 'loader',
      condition: 'setup',
    })
  })

  it('contains GLTFLoader entry', () => {
    expect(ADDON_REGISTRY.GLTFLoader).toBeDefined()
    expect(ADDON_REGISTRY.GLTFLoader.category).toBe('loader')
  })

  it('contains HDRLoader entry', () => {
    expect(ADDON_REGISTRY.HDRLoader).toBeDefined()
    expect(ADDON_REGISTRY.HDRLoader.category).toBe('loader')
  })

  it('contains external Spark entries', () => {
    expect(ADDON_REGISTRY.SplatMesh).toBeDefined()
    expect(ADDON_REGISTRY.SplatMesh.category).toBe('external')
    expect(ADDON_REGISTRY.SplatMesh.importSpecifier).toBe('@sparkjsdev/spark')
    expect(ADDON_REGISTRY.SparkRenderer).toBeDefined()
    expect(ADDON_REGISTRY.SparkRenderer.category).toBe('external')
  })
})

describe('getRequiredAddons', () => {
  it('includes setup-condition addons when config has setup', () => {
    const config = {
      setup: () => {},
      createContent: () => ({}),
      createTimeline: () => ({ repeat: () => {} }),
    } as unknown as VosConfig

    const addons = getRequiredAddons(config)
    expect(addons).toContain('DRACOLoader')
    expect(addons).toContain('EXRLoader')
    expect(addons).toContain('GLTFLoader')
    expect(addons).toContain('HDRLoader')
    expect(addons).toContain('FontLoader')
    expect(addons).toContain('TextGeometry')
    expect(addons).toContain('MeshSurfaceSampler')
    // External packages excluded from blanket loading
    expect(addons).not.toContain('SplatMesh')
  })

  it('excludes setup addons when config has no setup', () => {
    const config = {
      createContent: () => ({}),
      createTimeline: () => ({ repeat: () => {} }),
    } as unknown as VosConfig

    const addons = getRequiredAddons(config)
    expect(addons).not.toContain('DRACOLoader')
    expect(addons).not.toContain('EXRLoader')
    expect(addons).not.toContain('GLTFLoader')
  })

  it('includes postprocessing addons when config has postprocessing', () => {
    const config = {
      createContent: () => ({}),
      createTimeline: () => ({ repeat: () => {} }),
      postprocessing: [{ type: 'bloom' }],
    } as unknown as VosConfig

    const addons = getRequiredAddons(config)
    expect(addons).toContain('EffectComposer')
    expect(addons).toContain('RenderPass')
    expect(addons).toContain('UnrealBloomPass')
  })

  it('deduplicates addon names', () => {
    const config = {
      createContent: () => ({}),
      createTimeline: () => ({ repeat: () => {} }),
      postprocessing: [{ type: 'bloom' }, { type: 'output' }],
      perLayerEffects: [{ type: 'bloom' }],
    } as unknown as VosConfig

    const addons = getRequiredAddons(config)
    const bloomCount = addons.filter((a) => a === 'UnrealBloomPass').length
    expect(bloomCount).toBe(1)
  })
})

describe('detectRequiredAddons', () => {
  it('detects GLTFLoader from loaders.gltf pattern (+ DRACOLoader implicit)', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup: '(ctx) => { return ctx.loaders.gltf.loadAsync("model.glb"); }',
      createContent: '(ctx, data) => { ctx.scene.add(data.scene); return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('GLTFLoader')
    expect(addons).toContain('DRACOLoader')
    expect(addons).not.toContain('FontLoader')
    expect(addons).not.toContain('EXRLoader')
  })

  it('detects FontLoader + TextGeometry together', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup:
        '(ctx) => { return new ctx.loaders.FontLoader().load("font.json"); }',
      createContent:
        '(ctx, data) => { const geo = new ctx.utils.TextGeometry("hi", { font: data }); return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('FontLoader')
    expect(addons).toContain('TextGeometry')
    expect(addons).not.toContain('GLTFLoader')
    expect(addons).not.toContain('DRACOLoader')
  })

  it('returns no loaders when setup is absent', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 3,
      camera: { preset: 'perspective' },
      createContent: '(ctx) => { return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).not.toContain('FontLoader')
    expect(addons).not.toContain('GLTFLoader')
    expect(addons).not.toContain('DRACOLoader')
    expect(addons).toHaveLength(0)
  })

  it('safety net: generic "loaders" includes all loaders if no specific match', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup: '(ctx) => { const l = ctx.loaders; return l.something(); }',
      createContent: '(ctx) => { return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('FontLoader')
    expect(addons).toContain('GLTFLoader')
    expect(addons).toContain('DRACOLoader')
    expect(addons).toContain('HDRLoader')
    expect(addons).toContain('EXRLoader')
  })

  it('detects postprocessing from config array', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      postprocessing: [{ type: 'bloom' }, { type: 'output' }],
      createContent: '(ctx) => { return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('EffectComposer')
    expect(addons).toContain('RenderPass')
    expect(addons).toContain('TexturePass')
    expect(addons).toContain('UnrealBloomPass')
    expect(addons).toContain('OutputPass')
  })

  it('detects combined setup + postprocessing', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup: '(ctx) => { return ctx.loaders.gltf.loadAsync("m.glb"); }',
      postprocessing: [{ type: 'bloom' }, { type: 'output' }],
      createContent: '(ctx, d) => { ctx.scene.add(d.scene); return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('GLTFLoader')
    expect(addons).toContain('DRACOLoader')
    expect(addons).toContain('EffectComposer')
    expect(addons).toContain('UnrealBloomPass')
    expect(addons).not.toContain('FontLoader')
  })

  it('detects MeshSurfaceSampler from keyword', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup: '(ctx) => { return {}; }',
      createContent:
        '(ctx) => { const s = new ctx.utils.MeshSurfaceSampler(mesh).build(); return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('MeshSurfaceSampler')
  })

  it('detects external package from SplatMesh keyword', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup: '(ctx) => { const splat = new SplatMesh(); return { splat }; }',
      createContent: '(ctx, data) => { ctx.scene.add(data.splat); return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('SplatMesh')
  })

  it('detects external package from SparkRenderer keyword', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup: '(ctx) => { const r = new SparkRenderer(); return {}; }',
      createContent: '(ctx) => { return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('SparkRenderer')
  })

  it('detects external package from ctx.splat keyword', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup: '(ctx) => { ctx.splat.load("gs://model.splat"); return {}; }',
      createContent: '(ctx) => { return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('SplatMesh')
  })

  it('detects external + Three.js addons together', () => {
    const config: VosConfigJson = {
      version: 2,
      duration: 5,
      camera: { preset: 'perspective' },
      setup:
        '(ctx) => { const splat = new SplatMesh(); const font = new ctx.loaders.FontLoader(); return {}; }',
      createContent: '(ctx) => { return {}; }',
      createTimeline: '(ctx, c, d) => ctx.gsap.timeline()',
    }
    const addons = detectRequiredAddons(config)
    expect(addons).toContain('SplatMesh')
    expect(addons).toContain('FontLoader')
  })
})

describe('generateAddonImports', () => {
  it('generates correct import for DRACOLoader', () => {
    const imports = generateAddonImports(['DRACOLoader'])
    expect(imports).toHaveLength(1)
    expect(imports[0]).toBe(
      "import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';",
    )
  })

  it('generates correct import for EXRLoader', () => {
    const imports = generateAddonImports(['EXRLoader'])
    expect(imports).toHaveLength(1)
    expect(imports[0]).toBe(
      "import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';",
    )
  })

  it('generates multiple imports', () => {
    const imports = generateAddonImports([
      'GLTFLoader',
      'DRACOLoader',
      'HDRLoader',
    ])
    expect(imports).toHaveLength(3)
    expect(imports[0]).toContain('GLTFLoader')
    expect(imports[1]).toContain('DRACOLoader')
    expect(imports[2]).toContain('HDRLoader')
  })

  it('returns empty array for no addons', () => {
    expect(generateAddonImports([])).toEqual([])
  })

  it('groups external package exports into single import', () => {
    const imports = generateAddonImports(['SplatMesh', 'SparkRenderer'])
    // Both should be grouped into one import from @sparkjsdev/spark
    expect(imports).toHaveLength(1)
    expect(imports[0]).toContain("from '@sparkjsdev/spark'")
    expect(imports[0]).toContain('SplatMesh')
    expect(imports[0]).toContain('SparkRenderer')
  })

  it('generates mixed Three.js and external imports', () => {
    const imports = generateAddonImports(['GLTFLoader', 'SplatMesh'])
    expect(imports).toHaveLength(2)
    expect(imports[0]).toContain('GLTFLoader')
    expect(imports[0]).toContain("from 'three/addons/")
    expect(imports[1]).toContain('SplatMesh')
    expect(imports[1]).toContain("from '@sparkjsdev/spark'")
  })
})
