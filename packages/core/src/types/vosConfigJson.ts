/**
 * JSON-serializable VosConfig where functions are stored as strings.
 * Used for database storage and API transport.
 *
 * This mirrors VosConfig but replaces function types with strings,
 * enabling JSON serialization while preserving the full config structure.
 */

import type { CameraConfig, PostprocessingEffect, SceneConfig } from './vos'

/** A webfont face declaration: registered via the FontFace API at boot. */
export interface FontFaceDecl {
  /** Family name as used in `font.family` / canvas font strings. */
  family: string
  /** Font file URL (woff2/woff/ttf). Must be reachable from render pages. */
  url: string
  /** CSS weight the file carries (default 'normal'). One decl per weight. */
  weight?: number | string
  style?: 'normal' | 'italic'
}

/**
 * One program of the stack (`VosConfigJson.stack`), functions as strings: the
 * main program's hooks minus `createTimeline`. Runs after the main program in
 * each phase, on the same context, with its own `ctx.data` (`data` here,
 * overridable at runtime through `deps.stack[id]`) and its own error
 * boundary. See `ProgramEntry` for the semantics.
 */
export interface ProgramEntryJson {
  /** Unique within the stack; the `SET_DATA` target and the error report's name. */
  id: string
  /** This entry's own `ctx.data` (baked default). */
  data?: Record<string, unknown>
  setup?: string
  createContent?: string
  onFrame?: string
}

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
   * Which schema era this config was written against.
   *
   * Required, because this is the CANONICAL shape: what is stored, served
   * and read back later, when nobody can tell the era from the file itself.
   * `migrateConfig` stamps it, so the type you hand a storer always has one.
   * The authoring shape that may omit it is `AuthoredVosConfigJson`.
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
  /** Declarative world-space 3D objects (primitives / GLB). */
  objects?: Record<string, unknown>[]

  /**
   * Webfont faces to register and load BEFORE anything rasterizes text.
   * Canvas text silently falls back to a default font when a family isn't
   * loaded — headless render environments have near-zero system fonts, so any
   * non-generic family used by text elements (or setup-drawn canvases) should
   * be declared here with a self-hosted URL. Loading is awaited capped and
   * fail-open: a dead URL degrades to fallback stacks, never a hung page.
   */
  fonts?: FontFaceDecl[]

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

  /**
   * Evaluate the program at `f(t)`, as a string: `(t, data) => number`, a
   * pure function of the OUTPUT time and `ctx.data`. Slow motion, ramps,
   * reverse, freeze frames, ping-pong loops. See `VosConfig.retime`.
   */
  retime?: string

  /**
   * The program stack: more programs on this context, run after the main one
   * in array order, each with its own `ctx.data` and error boundary. A HUD, a
   * subtitle pass, a watermark, an overlay a remixer adds without touching the
   * main program's code. No timeline of their own — one master clock.
   */
  stack?: ProgramEntryJson[]
}

/**
 * A config as AUTHORED: the canonical shape with `version` optional.
 *
 * This is the narrow allowance, and it exists for exactly one situation: a
 * config being written and played right now, where the era is not in doubt
 * because you are watching the result. `compileVosConfig` takes this, and
 * `migrateConfig` turns it into the canonical shape by stamping the field.
 *
 * Anything DURABLE takes `VosConfigJson` instead. A stored config that
 * cannot say which schema it was written against is unreadable later, and
 * that is unrecoverable rather than merely inconvenient.
 */
export type AuthoredVosConfigJson = Omit<VosConfigJson, 'version'> & {
  version?: number
}
