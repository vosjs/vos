/**
 * Exposure scanning and masks: the module moved to
 * `@vosjs/render-core/record` (AN4). This file keeps every name the CLI
 * and its tests import.
 */
export {
  EXPOSURE_ADVICE,
  EXPOSURE_MATCHERS_SRC,
  EXPOSURE_PROBE,
  ExposureLog,
  exposureLine,
  maskInitScript,
} from '@vosjs/render-core/record'
export type {
  Exposure,
  ExposureKind,
  MaskReport,
  MaskRule,
} from '@vosjs/render-core/record'
