/**
 * @vosjs/core type definitions
 */

// Vos core types
export type {
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
  VosResult,
  VosTimeline,
} from './vos'

// JSON-serializable config type
export type {
  AuthoredVosConfigJson,
  VosConfigJson,
} from './vosConfigJson'

// Element types
export type {
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
} from './elements'
export type {
  ObjectAssetConfig,
  ObjectConfig,
  ObjectInstance,
  ObjectPrimitiveShape,
  ObjectProps,
  ObjectTransformConfig,
} from './objects'

// Export types
export type {
  RenderMode,
  ImageFormat,
  VideoFormat,
  VideoQuality,
  FrameCaptureOptions,
  GifExportOptions,
  VideoExportOptions,
  ExportProgress,
} from './export'
