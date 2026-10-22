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
  NOTICE_ADVICE,
  NoticeLog,
  exposureLine,
  maskInitScript,
  noticeLine,
} from '@vosjs/render-core/record'
export type {
  Exposure,
  ExposureKind,
  MaskReport,
  MaskRule,
  Notice,
} from '@vosjs/render-core/record'
