/**
 * @vosjs/core — Vos animation engine
 *
 * Pure generation layer for creating Three.js/GSAP animation templates.
 * No browser dependencies — safe for use in Node.js/server environments.
 *
 * @example
 * ```ts
 * import { compileVosConfig, vosConfigSchema } from '@vosjs/core'
 * import type { VosConfig } from '@vosjs/core'
 * ```
 */

// Compiler
export { compileVosConfig } from './compiler/compileVosConfig'

// Schema & validators
export { vosConfigSchema } from './schema/configSchema'
export { vosConfigJsonSchema } from './schema/configJsonSchema'
export type { ValidatedVosConfig } from './schema/configSchema'
export type { ValidatedVosConfigJson } from './schema/configJsonSchema'
export { isValidVosConfigJson } from './schema/validators'
export { CURRENT_CONFIG_VERSION, migrateConfig } from './schema/migrations'

// Addon registry
export {
  ADDON_REGISTRY,
  POSTPROCESSING_REGISTRY,
  generateAddonImports,
  getAllAddonNames,
  getRequiredAddons,
} from './addons/registry'
export type { AddonEntry, PostprocessingEntry } from './addons/registry'

// Types
export type {
  // Vos core
  Resolution,
  LoadersRegistry,
  UtilsRegistry,
  SetupContext,
  VosContext,
  ContentResult,
  SceneConfig,
  FogConfig,
  CameraConfig,
  PerspectiveCameraConfig,
  OrthographicCameraConfig,
  FullscreenCameraConfig,
  PostprocessingEffect,
  BloomEffect,
  GlitchEffect,
  FilmGrainEffect,
  DotScreenEffect,
  OutputEffect,
  VosConfig,
  VosConfigJson,
  VosResult,
  VosTimeline,
  // Elements
  ElementPosition,
  PositionPreset,
  Anchor,
  Transform,
  BaseElement,
  TextElement,
  ImageElement,
  SVGElement,
  VideoElement,
  ElementConfig,
  ElementProps,
  ElementInstance,
  // Export
  RenderMode,
  ImageFormat,
  VideoFormat,
  VideoQuality,
  FrameCaptureOptions,
  GifExportOptions,
  VideoExportOptions,
  ExportProgress,
} from './types'
