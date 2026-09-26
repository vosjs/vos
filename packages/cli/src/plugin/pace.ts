/**
 * The take's pace: the module moved to `@vosjs/render-core/record` (AN4,
 * the recorder's mechanism is host-free). This file keeps every name the
 * CLI and its tests import, so a caller sees no move.
 */
export {
  DEAD_SHARE_WARN_PCT,
  DEAD_STRETCH_WARN_MS,
  MOTION_TICK_MS,
  POINTER_MAX_MS,
  POINTER_MIN_MS,
  POINTER_MS_PER_PX,
  PRESS_HOLD_MS,
  PRESS_LEAD_MS,
  QUIET_MS,
  READ_BEAT_MS,
  RESPONSE_MS,
  SCROLL_SETTLE_MS,
  SETTLE_CAP_MS,
  SETTLE_MS,
  TRAILING_HOLD_MS,
  askedMs,
  clockMotion,
  clockTyping,
  deadLine,
  deadTime,
  deadWarns,
  easeInOutCubic,
  holdLeftMs,
  paceLine,
  paceReport,
  pointerTravelMs,
  settleMs,
  settleVerdict,
} from '@vosjs/render-core/record'
export type {
  DeadReport,
  DeadStep,
  PaceReport,
  StepPace,
} from '@vosjs/render-core/record'
