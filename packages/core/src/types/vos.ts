/**
 * Core animation types and interfaces
 */
import type * as THREE from 'three'
import type gsap from 'gsap'
import type { ElementConfig, ElementInstance } from './elements'

/**
 * Resolution configuration passed to animations
 */
export interface Resolution {
  width: number
  height: number
  pixelRatio: number
  /** Physical drawing buffer width (width × pixelRatio) - for shader uniforms */
  drawingBufferWidth: number
  /** Physical drawing buffer height (height × pixelRatio) - for shader uniforms */
  drawingBufferHeight: number
}

/**
 * Loaders registry - common Three.js loaders
 */
export interface LoadersRegistry {
  FontLoader: any
  TextureLoader: any
  GLTFLoader: any
  HDRLoader: any
  CubeTextureLoader: any
}

/**
 * Utilities registry - common Three.js utilities
 */
export interface UtilsRegistry {
  MeshSurfaceSampler: any
  BufferGeometryUtils: any
  TextGeometry: any
}

/**
 * Context available during async setup phase
 */
export interface SetupContext {
  THREE: typeof THREE
  resolution: Resolution
  loaders: LoadersRegistry
  utils: UtilsRegistry
  /**
   * Read-only input data exposed to all functions as `ctx.data`.
   * Sourced from `config.data`, overridable at runtime by `initVos` `deps.data`.
   * Always defined (defaults to `{}`). Shape is the author's/app's, not vos's.
   */
  data: Readonly<Record<string, unknown>>
}

/**
 * Context available during animation creation
 */
export interface VosContext extends SetupContext {
  gsap: typeof gsap
  scene: THREE.Scene
  camera: THREE.Camera
  renderer: THREE.WebGLRenderer
  /** Dedicated scene for 2D overlay elements (rendered on top of main scene) */
  overlayScene: THREE.Scene
  /** Orthographic camera for 2D overlay (pixel-space: 1 unit = 1 pixel) */
  overlayCamera: THREE.OrthographicCamera
  composer?: unknown // EffectComposer if postprocessing enabled
  /** Element instances for timeline animations */
  elements: Map<string, ElementInstance>
  /** Current playback time in seconds (available in onFrame) */
  time: number
  /** Playback progress 0-1 (available in onFrame) */
  progress: number
}

/**
 * Result from createContent function
 */
export interface ContentResult {
  /** Objects added to scene */
  objects: THREE.Object3D[]
  /** Named references for timeline animations */
  refs?: Record<string, unknown>
  /** Cleanup function for content-specific resources */
  dispose?: () => void
}

/**
 * Scene configuration
 */
export interface SceneConfig {
  /** Background color (hex number or CSS string) */
  background?: number | string
  /** Fog configuration */
  fog?: FogConfig
}

/**
 * Fog configuration
 */
export type FogConfig =
  | {
      type: 'exp2'
      color: number | string
      density: number
    }
  | {
      type: 'linear'
      color: number | string
      near: number
      far: number
    }

/**
 * Camera configuration
 */
export type CameraConfig =
  | PerspectiveCameraConfig
  | OrthographicCameraConfig
  | FullscreenCameraConfig

export interface PerspectiveCameraConfig {
  preset: 'perspective'
  fov?: number
  near?: number
  far?: number
  position?: [number, number, number]
  lookAt?: [number, number, number]
}

export interface OrthographicCameraConfig {
  preset: 'orthographic'
  zoom?: number
  near?: number
  far?: number
  position?: [number, number, number]
  lookAt?: [number, number, number]
}

/**
 * Fullscreen camera for shader materials.
 * Creates OrthographicCamera(-1, 1, 1, -1, 0, 1) for clip-space rendering.
 */
export interface FullscreenCameraConfig {
  preset: 'fullscreen'
  /** Near clipping plane (default: 0) */
  near?: number
  /** Far clipping plane (default: 1) */
  far?: number
}

/**
 * Post-processing effect configuration
 */
export type PostprocessingEffect =
  | BloomEffect
  | GlitchEffect
  | FilmGrainEffect
  | DotScreenEffect
  | OutputEffect

export interface BloomEffect {
  type: 'bloom'
  strength?: number
  radius?: number
  threshold?: number
}

export interface GlitchEffect {
  type: 'glitch'
  goWild?: boolean
}

export interface FilmGrainEffect {
  type: 'filmGrain'
  intensity?: number
}

export interface DotScreenEffect {
  type: 'dotScreen'
  scale?: number
}

export interface OutputEffect {
  type: 'output'
}

/**
 * Main animation configuration interface
 */
export interface VosConfig {
  /**
   * Schema version for forward compatibility.
   */
  version: number

  /**
   * Total duration of one animation cycle in seconds.
   * This defines how long a single loop takes.
   * @example 8 // 8-second animation cycle
   */
  duration: number

  /** Scene configuration (background, fog) */
  scene?: SceneConfig
  /** Camera configuration */
  camera: CameraConfig
  /** Post-processing effects (applied globally when multiple 3D groups exist) */
  postprocessing?: PostprocessingEffect[]
  /** Declare per-layer effect types for addon imports. Actual params come from userData.postprocessing at runtime. */
  perLayerEffects?: PostprocessingEffect[]
  /** Enable per-frame render group rebuild when zIndex changes at runtime */
  dynamicLayers?: boolean
  /** 2D Elements rendered as textured planes */
  elements?: ElementConfig[]

  /** Arbitrary input data exposed as `ctx.data` (overridable by `deps.data` at runtime). */
  data?: Record<string, unknown>

  /**
   * Async setup hook for loading assets before scene creation.
   * Runs before createContent. Returned data is passed to createContent.
   * @example
   * setup: async (ctx) => {
   *   const loader = new ctx.loaders.FontLoader()
   *   const font = await loader.loadAsync('...')
   *   return { font }
   * }
   */
  setup?: (ctx: SetupContext) => Promise<Record<string, any>>

  /**
   * Create scene content - returns objects and refs for timeline.
   * Receives setupData from the setup hook if provided.
   */
  createContent: (
    ctx: VosContext,
    setupData?: Record<string, any>,
  ) => ContentResult

  /**
   * Create GSAP timeline.
   * @param ctx - Animation context with THREE, gsap, scene, camera, etc.
   * @param content - Result from createContent with objects and refs
   * @param duration - The configured duration in seconds
   */
  createTimeline: (
    ctx: VosContext,
    content: ContentResult,
    duration: number,
  ) => gsap.core.Timeline

  /**
   * Optional per-frame update (for uniforms, custom logic)
   */
  onFrame?: (ctx: VosContext, content: ContentResult, deltaTime: number) => void
}

/**
 * Result returned from animation initialization
 */
export interface VosResult {
  timeline: gsap.core.Timeline
  cleanup: () => void
  /** Resolves when async content assets (e.g. decoded videos) are ready. */
  assetsReady?: Promise<void>
  /**
   * Live data channel (T2 edit): replace `ctx.data` on the running instance without
   * re-init. `onFrame` redraws with the new value next frame. Values baked into GSAP
   * tweens at `createTimeline` time do NOT change retroactively (that is a program /
   * T3 edit — handled by a warm reload). See ENGINE_LIVE_UPDATE_STRATEGY.
   */
  setData?: (next: Readonly<Record<string, unknown>>) => void
  /** Current live `ctx.data` snapshot (frozen). */
  getData?: () => Readonly<Record<string, unknown>>
  /**
   * Duration capability (T2.5 edit): retime the master timeline without re-init.
   * Opt-in: only defined when `createTimeline` returned a pure duration-carrier
   * timeline and declared it via `timeline.data = { vosCarrier: true }` (the
   * interpreter-pattern shape — per-frame state derives from ctx.time/ctx.data).
   * Undefined means duration is structural — hosts fall back to a warm reload (T3).
   */
  setDuration?: (seconds: number) => void
  /**
   * Element instances of the running program, keyed by element id. Editor tooling
   * uses these for hit-testing and ephemeral property overrides (via each
   * instance's `props` proxy); durable element edits are config edits (T3).
   */
  elements?: Map<string, ElementInstance>
  /** The 2D overlay camera (pixel-space orthographic) — for bounds projection. */
  overlayCamera?: THREE.OrthographicCamera
}
