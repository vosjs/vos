/**
 * @vosjs/timeline — deterministic time math for editable vos compositions.
 *
 * A pure evaluation LIBRARY, not a document format: apps embed these value
 * types (keyframes, segments) inside their own project documents, lower them
 * into `ctx.data`, and evaluate with the same functions on both sides of the
 * player bridge (import here on the host; inline `timelineRuntimeCode` from
 * `@vosjs/timeline/bundle` inside the program). No DOM, no engine coupling,
 * no RNG/wall-clock — everything is a pure function of its arguments.
 */
export type { EaseFn, EaseName, Keyframe, KeyframeTrack, Lerp, Segment } from './types'
export { EASINGS, resolveEase } from './easings'
export { lerpArray, sample, sortKeyframes } from './sample'
export { mapTime, sourceToTimeline, totalDuration } from './mapTime'
export {
  MIN_SEGMENT_LENGTH,
  normalizeSegments,
  removeSegment,
  splitSegments,
  trimSegment,
} from './edits'
