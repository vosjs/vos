import type { VosConfig, VosConfigJson } from '../types'

export interface AddonEntry {
  path: string
  named: string
  category: 'loader' | 'util' | 'postprocessing' | 'external'
  condition?: 'setup' | 'postprocessing'
  /** Keywords to detect in function strings */
  keywords?: string[]
  /** Addon names auto-included when this one is detected */
  implicitDeps?: string[]
  /** For external packages: the bare import specifier (e.g., '@sparkjsdev/spark') */
  importSpecifier?: string
  /** For external packages: all named exports to destructure */
  namedExports?: string[]
  /** CDN URL override (external packages need full URL with ?external=three) */
  cdnUrl?: (threeVersion: string) => string
  /** Code injected after imports to initialize the package (has access to `renderer`, `scene`) */
  initCode?: string | null
  /** Code injected in dispose to clean up the package */
  cleanupCode?: string | null
  /** Peer dependencies that must share instance (e.g., ['three']) */
  peerDeps?: string[]
}

export const ADDON_REGISTRY: Record<string, AddonEntry> = {
  FontLoader: {
    path: 'three/addons/loaders/FontLoader.js',
    named: 'FontLoader',
    category: 'loader',
    condition: 'setup',
    keywords: ['FontLoader'],
  },
  GLTFLoader: {
    path: 'three/addons/loaders/GLTFLoader.js',
    named: 'GLTFLoader',
    category: 'loader',
    condition: 'setup',
    keywords: ['GLTFLoader', 'loaders.gltf'],
    implicitDeps: ['DRACOLoader'],
  },
  HDRLoader: {
    path: 'three/addons/loaders/HDRLoader.js',
    named: 'HDRLoader',
    category: 'loader',
    condition: 'setup',
    keywords: ['HDRLoader'],
  },
  DRACOLoader: {
    path: 'three/addons/loaders/DRACOLoader.js',
    named: 'DRACOLoader',
    category: 'loader',
    condition: 'setup',
    keywords: ['DRACOLoader', 'loaders.draco'],
  },
  EXRLoader: {
    path: 'three/addons/loaders/EXRLoader.js',
    named: 'EXRLoader',
    category: 'loader',
    condition: 'setup',
    keywords: ['EXRLoader'],
  },
  TextGeometry: {
    path: 'three/addons/geometries/TextGeometry.js',
    named: 'TextGeometry',
    category: 'util',
    condition: 'setup',
    keywords: ['TextGeometry'],
  },
  MeshSurfaceSampler: {
    path: 'three/addons/math/MeshSurfaceSampler.js',
    named: 'MeshSurfaceSampler',
    category: 'util',
    condition: 'setup',
    keywords: ['MeshSurfaceSampler'],
  },
  EffectComposer: {
    path: 'three/addons/postprocessing/EffectComposer.js',
    named: 'EffectComposer',
    category: 'postprocessing',
  },
  RenderPass: {
    path: 'three/addons/postprocessing/RenderPass.js',
    named: 'RenderPass',
    category: 'postprocessing',
  },
  UnrealBloomPass: {
    path: 'three/addons/postprocessing/UnrealBloomPass.js',
    named: 'UnrealBloomPass',
    category: 'postprocessing',
  },
  GlitchPass: {
    path: 'three/addons/postprocessing/GlitchPass.js',
    named: 'GlitchPass',
    category: 'postprocessing',
  },
  FilmPass: {
    path: 'three/addons/postprocessing/FilmPass.js',
    named: 'FilmPass',
    category: 'postprocessing',
  },
  DotScreenPass: {
    path: 'three/addons/postprocessing/DotScreenPass.js',
    named: 'DotScreenPass',
    category: 'postprocessing',
  },
  OutputPass: {
    path: 'three/addons/postprocessing/OutputPass.js',
    named: 'OutputPass',
    category: 'postprocessing',
  },
  ShaderPass: {
    path: 'three/addons/postprocessing/ShaderPass.js',
    named: 'ShaderPass',
    category: 'postprocessing',
  },
  TexturePass: {
    path: 'three/addons/postprocessing/TexturePass.js',
    named: 'TexturePass',
    category: 'postprocessing',
  },
  // External packages
  SplatMesh: {
    path: '@sparkjsdev/spark',
    named: 'SplatMesh',
    category: 'external',
    condition: 'setup',
    keywords: ['SplatMesh', 'ctx.splat'],
    importSpecifier: '@sparkjsdev/spark',
    namedExports: ['SplatMesh', 'SparkRenderer'],
    cdnUrl: () =>
      'https://esm.sh/@sparkjsdev/spark?external=three&target=es2022',
    peerDeps: ['three'],
    initCode: null,
    cleanupCode: null,
  },
  SparkRenderer: {
    path: '@sparkjsdev/spark',
    named: 'SparkRenderer',
    category: 'external',
    condition: 'setup',
    keywords: ['SparkRenderer'],
    importSpecifier: '@sparkjsdev/spark',
    namedExports: ['SplatMesh', 'SparkRenderer'],
    cdnUrl: () =>
      'https://esm.sh/@sparkjsdev/spark?external=three&target=es2022',
    peerDeps: ['three'],
  },
}

// ---------------------------------------------------------------------------
// Postprocessing registry — maps effect types to code generation
// ---------------------------------------------------------------------------

export interface PostprocessingEntry {
  passName: string
  requiredAddons: string[]
  generate: (effect: any) => string
  /** Code string for a runtime factory function: (effectConfig) => Pass */
  runtimeFactory: string
}

export const POSTPROCESSING_REGISTRY: Record<string, PostprocessingEntry> = {
  bloom: {
    passName: 'bloomPass',
    requiredAddons: ['UnrealBloomPass'],
    generate: (e) =>
      `const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), ${e.strength ?? 1.0}, ${e.radius ?? 0.5}, ${e.threshold ?? 0});\n  composer.addPass(bloomPass);`,
    runtimeFactory:
      '(e) => new UnrealBloomPass(new THREE.Vector2(drawingBufferWidth, drawingBufferHeight), e.strength ?? 1.0, e.radius ?? 0.5, e.threshold ?? 0)',
  },
  glitch: {
    passName: 'glitchPass',
    requiredAddons: ['GlitchPass'],
    generate: (e) =>
      `const glitchPass = new GlitchPass();\n  ${e.goWild ? 'glitchPass.goWild = true;\n  ' : ''}composer.addPass(glitchPass);`,
    runtimeFactory:
      '(e) => { const p = new GlitchPass(); if (e.goWild) p.goWild = true; return p; }',
  },
  filmGrain: {
    passName: 'filmPass',
    requiredAddons: ['FilmPass'],
    generate: (e) =>
      `const filmPass = new FilmPass(${e.intensity ?? 0.5});\n  composer.addPass(filmPass);`,
    runtimeFactory: '(e) => new FilmPass(e.intensity ?? 0.5)',
  },
  dotScreen: {
    passName: 'dotScreenPass',
    requiredAddons: ['DotScreenPass'],
    generate: (e) =>
      `const dotScreenPass = new DotScreenPass();\n  ${e.scale ? `dotScreenPass.uniforms.scale.value = ${e.scale};\n  ` : ''}composer.addPass(dotScreenPass);`,
    runtimeFactory:
      '(e) => { const p = new DotScreenPass(); if (e.scale) p.uniforms.scale.value = e.scale; return p; }',
  },
  output: {
    passName: 'outputPass',
    requiredAddons: ['OutputPass'],
    generate: () =>
      `const outputPass = new OutputPass();\n  composer.addPass(outputPass);`,
    runtimeFactory: '() => new OutputPass()',
  },
}

/**
 * Get addon names required for a given config (legacy — includes ALL setup addons).
 * Used by getRequiredAddons for runtime VosConfig (where functions are real functions,
 * not strings we can scan).
 */
export function getRequiredAddons(config: VosConfig): string[] {
  const addons: string[] = []

  if (config.setup) {
    for (const [name, entry] of Object.entries(ADDON_REGISTRY)) {
      if (entry.condition === 'setup' && entry.category !== 'external') {
        addons.push(name)
      }
    }
  }

  if (config.postprocessing?.length) {
    addons.push('EffectComposer', 'RenderPass', 'TexturePass')
    for (const effect of config.postprocessing) {
      const entry = POSTPROCESSING_REGISTRY[effect.type as string] as
        | PostprocessingEntry
        | undefined
      if (entry) addons.push(...entry.requiredAddons)
    }
  }

  if (config.perLayerEffects?.length) {
    addons.push('EffectComposer', 'RenderPass')
    for (const effect of config.perLayerEffects) {
      const entry = POSTPROCESSING_REGISTRY[effect.type as string] as
        | PostprocessingEntry
        | undefined
      if (entry) addons.push(...entry.requiredAddons)
    }
  }

  return [...new Set(addons)]
}

/**
 * Detect required addons by scanning VosConfigJson function strings for keywords.
 * Much more efficient than blanket-loading all addons — only imports what's actually used.
 */
export function detectRequiredAddons(config: VosConfigJson): string[] {
  const addons = new Set<string>()

  // 1. Scan function strings for setup-condition addons
  if (config.setup) {
    const codeToScan = [
      config.setup,
      config.createContent,
      config.createTimeline,
      config.onFrame,
    ]
      .filter(Boolean)
      .join('\n')

    let hasLoaderKeyword = false
    let hasUtilKeyword = false
    let hasGenericLoaders = false
    let hasGenericUtils = false

    // Check for generic references (safety net)
    if (/\bloaders\b/.test(codeToScan)) hasGenericLoaders = true
    if (/\butils\b/.test(codeToScan)) hasGenericUtils = true

    // Scan for specific keywords
    for (const [name, entry] of Object.entries(ADDON_REGISTRY)) {
      if (entry.condition !== 'setup' || !entry.keywords) continue

      for (const keyword of entry.keywords) {
        if (codeToScan.includes(keyword)) {
          addons.add(name)
          if (entry.category === 'loader') hasLoaderKeyword = true
          if (entry.category === 'util') hasUtilKeyword = true

          // Resolve implicit deps
          if (entry.implicitDeps) {
            for (const dep of entry.implicitDeps) {
              addons.add(dep)
            }
          }
          break
        }
      }
    }

    // Safety net: if generic 'loaders'/'utils' referenced but no specific match, include all
    if (hasGenericLoaders && !hasLoaderKeyword) {
      for (const [name, entry] of Object.entries(ADDON_REGISTRY)) {
        if (entry.condition === 'setup' && entry.category === 'loader') {
          addons.add(name)
        }
      }
    }
    if (hasGenericUtils && !hasUtilKeyword) {
      for (const [name, entry] of Object.entries(ADDON_REGISTRY)) {
        if (entry.condition === 'setup' && entry.category === 'util') {
          addons.add(name)
        }
      }
    }
  }

  // 2. Postprocessing addons from config arrays
  if (config.postprocessing?.length) {
    addons.add('EffectComposer')
    addons.add('RenderPass')
    addons.add('TexturePass')
    for (const effect of config.postprocessing) {
      const entry = POSTPROCESSING_REGISTRY[effect.type as string] as
        | PostprocessingEntry
        | undefined
      if (entry) {
        for (const a of entry.requiredAddons) addons.add(a)
      }
    }
  }

  if (config.perLayerEffects?.length) {
    addons.add('EffectComposer')
    addons.add('RenderPass')
    for (const effect of config.perLayerEffects) {
      const entry = POSTPROCESSING_REGISTRY[effect.type as string] as
        | PostprocessingEntry
        | undefined
      if (entry) {
        for (const a of entry.requiredAddons) addons.add(a)
      }
    }
  }

  return [...addons]
}

/**
 * Generate ES module import statements from addon names.
 * Groups external packages by import specifier for a single import per package.
 */
export function generateAddonImports(addons: string[]): string[] {
  const imports: string[] = []
  const externalGroups = new Map<string, Set<string>>()

  for (const name of addons) {
    const entry = ADDON_REGISTRY[name] as AddonEntry | undefined
    if (!entry) continue

    if (entry.category === 'external' && entry.importSpecifier) {
      // Group external package exports by specifier
      if (!externalGroups.has(entry.importSpecifier)) {
        externalGroups.set(
          entry.importSpecifier,
          new Set(entry.namedExports ?? [entry.named]),
        )
      } else {
        const group = externalGroups.get(entry.importSpecifier)!
        for (const exp of entry.namedExports ?? [entry.named]) {
          group.add(exp)
        }
      }
    } else {
      imports.push(`import { ${entry.named} } from '${entry.path}';`)
    }
  }

  // Generate one import per external package
  for (const [specifier, exports] of externalGroups) {
    imports.push(`import { ${[...exports].join(', ')} } from '${specifier}';`)
  }

  return imports
}

/**
 * Get all addon names (used for video export which imports everything)
 */
export function getAllAddonNames(): string[] {
  return Object.keys(ADDON_REGISTRY)
}

/**
 * Generate a runtime effect factory object code string from declared effect types.
 * Returns code like `{ bloom: (e) => new UnrealBloomPass(...), ... }`
 */
export function generateEffectFactoryCode(effects: { type: string }[]): string {
  const entries = effects
    .map((e) => {
      const entry = POSTPROCESSING_REGISTRY[e.type] as
        | PostprocessingEntry
        | undefined
      return entry ? `    ${e.type}: ${entry.runtimeFactory},` : ''
    })
    .filter(Boolean)
  return `{\n${entries.join('\n')}\n  }`
}

/**
 * Get external package importmap entries from detected addons.
 * Returns a record of import specifier → CDN URL.
 */
export function getExternalImportmapEntries(
  detectedAddons: string[],
  threeVersion: string,
): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const name of detectedAddons) {
    const entry = ADDON_REGISTRY[name] as AddonEntry | undefined
    if (
      entry?.category === 'external' &&
      entry.importSpecifier &&
      entry.cdnUrl
    ) {
      entries[entry.importSpecifier] = entry.cdnUrl(threeVersion)
    }
  }
  return entries
}
