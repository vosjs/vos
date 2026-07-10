/**
 * @vosjs/tween — record a GSAP-dialect timeline into a structured per-element IR.
 *
 * The recorder is a facade shaped like the slice of `gsap` that `createTimeline` uses:
 * it captures every tween as a `TweenSpec` (with GSAP position parameters resolved to
 * absolute time) and, given a real `gsap` backend, delegates 1:1 so live playback is
 * unchanged. `extractTimeline` folds the specs into per-target keyframe tracks — the
 * neutral model a per-element timeline editor edits and a deterministic backend samples.
 */
export {
  createTweenRecorder,
  RecordingTimeline,
  type TweenRecorder,
  type GsapBackend,
  type TimelineBackend,
} from './recorder'
export { buildTracks, extractTimeline } from './extract'
export { tagTarget, readTag, TargetResolver } from './target'
export {
  makeElement,
  makeElementsMap,
  tagUniforms,
  tagRef,
  runCreateTimeline,
  type ExtractionElement,
} from './scope'
export { DEFAULT_EASE, DEFAULT_DURATION, parseVars, type ParsedVars } from './vars'
export {
  targetKey,
  type TweenTarget,
  type TweenSpec,
  type TargetTrack,
  type TimelineDoc,
  type EaseName,
  type Keyframe,
  type KeyframeTrack,
} from './types'
