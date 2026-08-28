/**
 * Core animation types and interfaces
 */
import type * as THREE from 'three'
import type gsap from 'gsap'
import type { ElementConfig, ElementInstance } from './elements'
import type { ObjectConfig, ObjectInstance } from './objects'

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
  /**
   * The OUTPUT time in seconds: what the transport shows and the capture
   * counts. Equal to `time` unless the config carries a `retime`, in which
   * case `time` is `retime(outputTime, data)` — the program's own time —
   * while `outputTime` keeps counting the output. Stack entries read
   * `ctx.time` as output time (they are output-anchored by contract).
   */
  outputTime: number
}

/**
 * Structural master-clock interface the engine seeks each frame.
 *
 * This is the ONLY surface the runtime uses from the timeline object returned by
 * `createTimeline` (pause/seek/play + transport queries + carrier retiming). It is
 * satisfied structurally by `gsap.core.Timeline` today, so authoring against real
 * GSAP is unchanged — but the public API no longer hard-depends on the `gsap` type,
 * which lets an alternate deterministic backend provide a conformant timeline later
 * without a breaking change. Method shorthand is intentional (bivariant params) so
 * GSAP's overloaded signatures remain structurally assignable.
 */
export interface VosTimeline {
  /** Pause playback (frame-stepped export pauses before the first frame). */
  pause(): unknown
  /** Resume playback. */
  play(): unknown
  /** Seek to `time` seconds. `suppressEvents=false` fires onUpdate callbacks. */
  seek(time: number, suppressEvents?: boolean): unknown
  /** Rebuild/clear children (used by the vosCarrier duration-retime path). */
  clear(): unknown
  /** Set playback rate. */
  timeScale(value: number): unknown
  /** Current playhead in seconds. */
  time(): number
  /** Normalized progress 0..1. */
  progress(): number
  /** Configured duration in seconds. */
  duration(): number
  /** Total duration including repeats (seconds). */
  totalDuration(): number
  /** Attach/read a lifecycle callback (engine uses onUpdate). */
  eventCallback(type: string, callback?: (...args: any[]) => void): unknown
  /** Opaque author-attached marker (e.g. `{ vosCarrier: true }`). */
  data?: unknown
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
 * One program of the stack (`VosConfig.stack`): the main program's hooks
 * minus `createTimeline`, run AFTER the main program in each phase (setup →
 * createContent → onFrame), on the same context — the same scene,
 * overlayScene, renderer, elements, objects and master clock.
 *
 * Three rules make it a composition and not a nesting:
 * - `ctx.data` is the entry's OWN (`data` here; `deps.stack[id]` at runtime;
 *   `setData(next, id)` live). Everything else on `ctx` is shared.
 * - No timeline: an entry reads `ctx.time` / `ctx.progress` like any hook.
 * - Its own error boundary: a throwing entry is disabled for the session and
 *   reported through `VosResult.stack.onError`; nothing else stops.
 *
 * An entry's `createContent` returns the objects it added (`objects`), like
 * the main program's: that list is what a live rebuild removes.
 */
export interface ProgramEntry {
  /** Unique within the stack. */
  id: string
  /** This entry's own `ctx.data` (baked default). */
  data?: Record<string, unknown>
  setup?: (ctx: SetupContext) => Promise<Record<string, any>>
  createContent?: (
    ctx: VosContext,
    setupData?: Record<string, any>,
  ) => ContentResult
  onFrame?: (
    ctx: VosContext,
    content: ContentResult | null,
    deltaTime: number,
  ) => void
}

/** One stack entry's live state (`VosResult.stack.state()`). */
export interface StackEntryState {
  id: string
  /** False once the entry threw; it stays disabled for the session. */
  ok: boolean
  error: string | null
}

/**
 * Main animation configuration interface
 */
export interface VosConfig {
  /**
   * Which schema era this config was written against. Required: this is the
   * shape a config has once it has been read, which is always stamped.
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

  /** Declarative world-space 3D objects (primitives / GLB) in the main scene */
  objects?: ObjectConfig[]

  /** Webfont faces registered + awaited before first render (fail-open). */
  fonts?: import('./vosConfigJson').FontFaceDecl[]

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
  ) => VosTimeline

  /**
   * Optional per-frame update (for uniforms, custom logic)
   */
  onFrame?: (ctx: VosContext, content: ContentResult, deltaTime: number) => void

  /**
   * Evaluate the program at `f(t)`: a pure function of the OUTPUT time and
   * `ctx.data`, returning the program time to render. Each frame the runtime
   * seeks the program's timeline there and sets `ctx.time` to it, while the
   * transport (play, pause, seek, duration, capture) keeps counting output
   * time on a clock of `duration` seconds. Slow motion (`t => t / 2`),
   * ramps, reverse (`(t, d) => d.duration - t`), a freeze, a ping-pong loop,
   * all without re-authoring the timeline. Reads `data` live, so a rate
   * that lives in `ctx.data` changes with `setData` (no re-init). The
   * result is clamped to the program timeline's `[0, duration]`; a
   * non-finite result falls back to `t` and warns once.
   */
  retime?: (t: number, data: Readonly<Record<string, unknown>>) => number

  /**
   * The program stack: more programs on this context, after the main one,
   * each with its own `ctx.data` and error boundary. See `ProgramEntry`.
   */
  stack?: ProgramEntry[]
}

/**
 * Result returned from animation initialization
 */
export interface VosResult {
  timeline: VosTimeline
  cleanup: () => void
  /** Resolves when async content assets (e.g. decoded videos) are ready. */
  assetsReady?: Promise<void>
  /**
   * Live data channel (T2 edit): replace `ctx.data` on the running instance without
   * re-init. `onFrame` redraws with the new value next frame. Values baked into GSAP
   * tweens at `createTimeline` time do NOT change retroactively (that is a program /
   * T3 edit — handled by a warm reload via the bridge's LOAD command).
   */
  setData?: (
    next: Readonly<Record<string, unknown>>,
    /** A stack entry's id: replace THAT entry's `ctx.data` instead (its own three rungs). */
    target?: string,
  ) => void
  /** Current live `ctx.data` snapshot (frozen). */
  getData?: () => Readonly<Record<string, unknown>>
  /** True when the program carries a `retime`: `timeline` is then the OUTPUT clock, and `setDuration` is always defined. */
  retime?: boolean
  /** The program stack, when `config.stack` is set: its ids, each entry's live state, and an error subscription. */
  stack?: {
    ids: string[]
    state: () => StackEntryState[]
    /** Fires when an entry throws (once per entry — it is disabled after). Returns the unsubscribe. */
    onError: (cb: (e: { id: string; error: string }) => void) => () => void
  }
  /**
   * Duration capability (T2.5 edit): retime the master timeline without re-init.
   * Opt-in: only defined when `createTimeline` returned a pure duration-carrier
   * timeline and declared it via `timeline.data = { vosCarrier: true }` (the
   * interpreter-pattern shape — per-frame state derives from ctx.time/ctx.data).
   * Undefined means duration is structural — hosts fall back to a warm reload (T3).
   */
  setDuration?: (seconds: number) => void
  /**
   * One synchronous engine tick: sync objects, publish the clock, run
   * per-frame code, draw every render group — exactly what the internal rAF
   * loop does per frame, callable directly. Capture harnesses use it to
   * drive frames without waiting for the compositor's vsync (seek →
   * renderFrame() → capture); evaluation stays a pure function of the
   * timeline position. Absent on artifacts compiled before 0.11.
   */
  renderFrame?: () => void
  /** Stops the internal rAF loop. Call before driving renderFrame directly,
   * or every captured frame is rendered twice (the loop keeps ticking). */
  stopRenderLoop?: () => void
  /**
   * Element instances of the running program, keyed by element id. Editor tooling
   * uses these for hit-testing and ephemeral property overrides (via each
   * instance's `props` proxy); durable element edits are config edits (T3).
   */
  elements?: Map<string, ElementInstance>
  /** Engine-managed world-space objects by id (present when config.objects is set). */
  objects?: Map<string, ObjectInstance>
  /** The 2D overlay camera (pixel-space orthographic) — for bounds projection. */
  overlayCamera?: THREE.OrthographicCamera
}
