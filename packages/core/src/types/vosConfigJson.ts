/**
 * JSON-serializable VosConfig where functions are stored as strings.
 * Used for database storage and API transport.
 *
 * This mirrors VosConfig but replaces function types with strings,
 * enabling JSON serialization while preserving the full config structure.
 */

import type { CameraConfig, PostprocessingEffect, SceneConfig } from './vos'

/**
 * JSON-serializable version of VosConfig.
 * Functions are stored as strings that can be embedded in the compiled template.
 *
 * Note: Elements are typed loosely as Record<string, unknown>[] for JSON
 * transport compatibility. The actual ElementConfig type validation happens
 * at compile time in compileVosConfig.
 */
export interface VosConfigJson {
  /**
   * Schema version for forward compatibility.
   */
  version: number

  /**
   * Total duration of one animation cycle in seconds.
   */
  duration: number

  /** Scene configuration (background, fog) */
  scene?: SceneConfig

  /** Camera configuration */
  camera: CameraConfig

  /** Post-processing effects */
  postprocessing?: PostprocessingEffect[]

  /** Declare per-layer effect types for addon imports */
  perLayerEffects?: PostprocessingEffect[]

  /** Enable per-frame render group rebuild when zIndex changes at runtime */
  dynamicLayers?: boolean

  /** 2D Elements rendered as textured planes (loosely typed for JSON transport) */
  elements?: Record<string, unknown>[]

  /**
   * Arbitrary input data made available to functions as `ctx.data`.
   * The shape is the author's/app's, not vos's — vos passes it through verbatim.
   * Overridable at runtime via `initVos(container, deps)` `deps.data` (so a live
   * editor can update data without recompiling); `config.data` is the baked default.
   * @example { cursor: [{ t: 0, x: 10, y: 20, type: 'down' }] }
   */
  data?: Record<string, unknown>

  /**
   * Async setup hook as a string.
   * @example "(ctx) => { const loader = new ctx.loaders.FontLoader(); ... }"
   */
  setup?: string

  /**
   * Create scene content function as a string.
   * @example "(ctx, setupData) => { const { THREE, scene } = ctx; ... }"
   */
  createContent: string

  /**
   * Create GSAP timeline function as a string.
   * @example "(ctx, content, duration) => { const tl = ctx.gsap.timeline(); ... }"
   */
  createTimeline: string

  /**
   * Optional per-frame update function as a string.
   * @example "(ctx, content, deltaTime) => { content.refs.uniforms.iTime.value += deltaTime; }"
   */
  onFrame?: string
}
