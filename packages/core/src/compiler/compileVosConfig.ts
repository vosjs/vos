import { dracoDecoderPath } from '../addons/cdn'
import {
  ADDON_REGISTRY,
  detectRequiredAddons,
  getExternalImportmapEntries,
} from '../addons/registry'
import { vosConfigJsonSchema } from '../schema/configJsonSchema'
import { migrateConfig } from '../schema/migrations'
import {
  generateCameraSetup,
  generateCleanup,
  generateDynamicLayerRebuild,
  generateElementsSetup,
  generateGlobalComposerSetup,
  generateImports,
  generateLayerAssignment,
  generatePerLayerComposerSetup,
  generatePostprocessingSetup,
  generateRenderLoop,
  generateRendererSetup,
  generateResizeHandler,
  generateSceneSetup,
} from './generators'
import type { VosConfigJson } from '../types'

/**
 * Compiles a VosConfigJson (with function strings) into an executable template.
 *
 * This function is safe to run in Cloudflare Workers because it only does
 * string concatenation - no eval() or new Function() required.
 *
 * @example
 * ```typescript
 * const template = compileVosConfig({
 *   version: 2,
 *   duration: 8,
 *   camera: { preset: 'perspective', fov: 75 },
 *   createContent: '(ctx) => { const { THREE, scene } = ctx; ... }',
 *   createTimeline: '(ctx, content, duration) => { ... }',
 * })
 * ```
 */
export interface CompileVosConfigOptions {
  /**
   * Which tween backend the compiled module targets (default 'gsap').
   *
   * The compiled code is backend-agnostic at runtime — `ctx.gsap` always
   * comes from `deps.gsap` (the host chooses the backend). This option only
   * controls whether the module emits `import gsap from 'gsap'`: 'vos' omits
   * it so no GSAP is fetched from the CDN. Such modules still run in a
   * gsap-backend host (the import was shadowed anyway); legacy gsap-mode
   * modules still run in a vos-backend host (the importmap entry remains).
   */
  tweenEngine?: 'gsap' | 'vos'
}

export function compileVosConfig(
  input: VosConfigJson,
  options: CompileVosConfigOptions = {},
): string {
  // Migrate old config versions
  const config = migrateConfig(
    input as unknown as Record<string, unknown>,
  ) as unknown as VosConfigJson

  // Validate config
  const result = vosConfigJsonSchema.safeParse(config)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid VosConfigJson:\n${issues}`)
  }

  const version = result.data.version

  // Detect which addons are actually needed by scanning function strings
  const detectedAddons = detectRequiredAddons(config)

  // Cast to any for generators that expect VosConfig
  // (they only use non-function properties which are identical)
  const configForGenerators = config as any

  const imports = generateImports(configForGenerators, detectedAddons, {
    includeGsap: options.tweenEngine !== 'vos',
  })
  const sceneSetup = generateSceneSetup(config.scene)
  const cameraSetup = generateCameraSetup(config.camera)
  const postprocessingSetup = generatePostprocessingSetup(config.postprocessing)
  const rendererSetup = generateRendererSetup()

  // Functions are already strings in VosConfigJson
  const contentCreation = config.createContent
  const timelineCreation = config.createTimeline
  const onFrameSetup = config.onFrame
    ? `const onFrame = ${config.onFrame};`
    : ''

  const renderLoop = generateRenderLoop(configForGenerators)
  const resizeHandler = generateResizeHandler(configForGenerators)
  const cleanup = generateCleanup(configForGenerators)
  const elementsSetup = generateElementsSetup(configForGenerators)
  const layerAssignment = generateLayerAssignment()
  const perLayerComposerSetup =
    generatePerLayerComposerSetup(configForGenerators)
  const globalComposerSetup = generateGlobalComposerSetup(configForGenerators)
  const dynamicLayerRebuild = generateDynamicLayerRebuild(configForGenerators)

  // Generate setup hook if present
  const hasSetup = !!config.setup
  const setupFn = hasSetup ? `const setup = ${config.setup};` : ''
  const setupCall = hasSetup
    ? 'const setupData = await setup(setupContext);'
    : ''
  const setupDataArg = hasSetup ? 'setupData' : 'undefined'

  // Baked default for ctx.data. Runtime deps.data overrides this (so a live editor
  // can pass fresh data without recompiling). Omitting config.data bakes `{}`.
  const bakedData = JSON.stringify(config.data ?? {})

  // Build loaders and utils registries from detected addons only
  const detectedSet = new Set(detectedAddons)
  const hasDraco = detectedSet.has('DRACOLoader')
  const hasGltf = detectedSet.has('GLTFLoader')

  const loaderEntries = Object.entries(ADDON_REGISTRY)
    .filter(([name, e]) => e.category === 'loader' && detectedSet.has(name))
    .map(([name]) => `    ${name},`)
    .join('\n')
  const utilEntries = Object.entries(ADDON_REGISTRY)
    .filter(([name, e]) => e.category === 'util' && detectedSet.has(name))
    .map(([name]) => `    ${name},`)
    .join('\n')

  // External package init/cleanup code
  const externalInits: string[] = []
  const externalCleanups: string[] = []
  for (const name of detectedAddons) {
    const entry = ADDON_REGISTRY[name] as
      | (typeof ADDON_REGISTRY)[string]
      | undefined
    if (entry?.category === 'external') {
      if (entry.initCode) externalInits.push(entry.initCode)
      if (entry.cleanupCode) externalCleanups.push(entry.cleanupCode)
    }
  }

  const dracoSetup =
    hasSetup && hasDraco
      ? `
  // DRACO decoder (auto-configured)
  const _dracoLoader = new DRACOLoader();
  _dracoLoader.setDecoderPath(
    (typeof window !== 'undefined' && window.__THREE_DRACO_PATH__)
    || '${dracoDecoderPath('0.183.0')}'
  );`
      : ''

  const gltfSetup =
    hasSetup && hasGltf
      ? `
  // GLTFLoader with DRACO pre-attached
  const _gltfLoader = new GLTFLoader();${hasDraco ? '\n  _gltfLoader.setDRACOLoader(_dracoLoader);' : ''}`
      : ''

  const loadersRegistry = hasSetup
    ? `${dracoSetup}${gltfSetup}

  // Loaders registry
  const loaders = {
    // Constructors (for manual instantiation)
${loaderEntries}
    TextureLoader: THREE.TextureLoader,
    CubeTextureLoader: THREE.CubeTextureLoader,${hasGltf ? '\n    // Pre-configured instances (recommended)\n    gltf: _gltfLoader,' : ''}${hasDraco ? '\n    draco: _dracoLoader,' : ''}
  };

  // Utils registry
  const utils = {
${utilEntries}
    BufferGeometryUtils: THREE.BufferGeometryUtils,
  };${externalInits.length ? '\n\n  ' + externalInits.join('\n  ') : ''}`
    : ''

  const setupContextDef = hasSetup
    ? `
  // Setup context (before scene/camera creation)
  const setupContext = {
    THREE,
    renderer,
    resolution: { width, height, pixelRatio },
    loaders,
    utils,
    get data() { return __vosData; },
  };`
    : ''

  return `${imports}


export const initVos = async (container, deps) => {
  const VOS_VERSION = ${version};
  const { THREE, gsap, resolution } = deps;

  // Input data exposed as ctx.data (runtime deps.data overrides baked config.data; never undefined).
  // Mutable internal + getter (like currentTime/currentProgress) so the instance's setData()
  // can swap inputs live without re-init; onFrame reads ctx.data fresh every frame. Each
  // snapshot is frozen to preserve determinism (output is a pure fn of program + data + time).
  let __vosData = Object.freeze((deps && deps.data) ?? ${bakedData});

  // Resolution
  const width = resolution?.width ?? container.clientWidth ?? window.innerWidth;
  const height = resolution?.height ?? container.clientHeight ?? window.innerHeight;
  const pixelRatio = resolution?.pixelRatio ?? Math.min(window.devicePixelRatio ?? 1, 2);

  // Physical drawing buffer dimensions (what gl_FragCoord uses)
  const drawingBufferWidth = resolution?.drawingBufferWidth ?? Math.floor(width * pixelRatio);
  const drawingBufferHeight = resolution?.drawingBufferHeight ?? Math.floor(height * pixelRatio);
  ${rendererSetup}
  ${loadersRegistry}
  ${setupContextDef}
  ${setupFn}
  ${setupCall}
  ${sceneSetup}
  ${cameraSetup}
  ${postprocessingSetup}
  ${elementsSetup}

  // Playback state
  let currentTime = 0;
  let currentProgress = 0;

  // Context for content and timeline creation
  const context = {
    THREE,
    gsap,
    scene,
    camera,
    renderer,
    overlayScene,
    overlayCamera,
    resolution: { width, height, pixelRatio, drawingBufferWidth, drawingBufferHeight },
    elements,
    get data() { return __vosData; },
    get time() { return currentTime; },
    get progress() { return currentProgress; },
    ${hasSetup ? 'loaders,' : ''}
    ${hasSetup ? 'utils,' : ''}
    ${config.postprocessing?.length ? 'composer,' : ''}
  };

  const DURATION = ${config.duration};

  const createContent = ${contentCreation};
  const content = createContent(context, ${setupDataArg});

  ${layerAssignment}

  ${perLayerComposerSetup}

  ${globalComposerSetup}

  const createTimeline = ${timelineCreation};
  const tl = createTimeline(context, content, DURATION);
  tl.repeat(-1);
  tl.pause();

  // Duration capability (T2.5): opt-in for "carrier" timelines. Programs whose
  // timeline exists only to define duration and drive ctx.time (the interpreter
  // pattern) declare it via timeline.data = { vosCarrier: true }; retiming then
  // rebuilds the carrier, which is safe by that contract. Freeform timelines get
  // no setDuration — duration is structural there (tween layout, baked values),
  // so edits fall back to a warm LOAD. No heuristic: GSAP cannot retime a nested
  // value-tween without invalidate() re-capturing starts (nondeterministic).
  let __setDuration;
  if (tl.data && tl.data.vosCarrier === true) {
    __setDuration = (seconds) => {
      const s = Math.max(0.001, Number(seconds) || 0);
      const t = Math.min(tl.time(), s);
      tl.clear();
      tl.to({}, { duration: s, ease: 'none' }, 0);
      tl.seek(t, false);
    };
  }

  ${onFrameSetup}

  ${resizeHandler}
  handleResize();

  ${dynamicLayerRebuild}

  ${renderLoop}

  return {
    timeline: tl,
    cleanup: ${cleanup},
    assetsReady: content.assetsReady,
    // Live data channel (T2): swap ctx.data without re-init. onFrame redraws with the
    // new value next frame. NOTE: values baked into GSAP tweens at createTimeline time
    // do not retroactively change — that is a program (T3) edit handled by warm LOAD.
    setData: (next) => { __vosData = Object.freeze(next ?? {}); },
    getData: () => __vosData,
    setDuration: __setDuration,
    // Introspection handles for editor tooling (element picking / bounds projection).
    // References into the live instance — read-mostly; property writes go through
    // each element's props proxy.
    elements,
    overlayCamera,
  };
};
`
}

/**
 * Get external package importmap entries needed for a given config.
 * Used by callers to populate render template's additionalImportmapEntries.
 */
export function getConfigImportmapEntries(
  config: VosConfigJson,
  threeVersion = '0.183.0',
): Record<string, string> {
  const detected = detectRequiredAddons(config)
  return getExternalImportmapEntries(detected, threeVersion)
}
