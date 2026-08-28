/**
 * @vosjs/core/audio — render the sound a program plays, offline.
 *
 * `renderAudio(config)` samples the program's audio schedule with the same
 * pure tween sampler live playback uses, then mixes the decoded sources into
 * plain PCM. `planAudio` and `mixAudio` are its two halves, exported so a
 * consumer can inspect a schedule or bring its own decoder.
 */
export { renderAudio } from './render'
export type { RenderAudioOptions } from './render'
export { planAudio, AUDIO_PLAN_STEP } from './plan'
export type {
  AudioPlan,
  AudioTrackPlan,
  AudioPoint,
  PlanAudioOptions,
} from './plan'
export { mixAudio } from './mix'
export type { MixAudioOptions } from './mix'
export { normalizeEnvelope, sampleEnvelope } from './envelope'
export type { GainEnvelope } from './envelope'
export {
  createPcm,
  pcmDuration,
  pcmFromAudioBuffer,
  toAudioBuffer,
} from './pcm'
export type { PcmBuffer } from './pcm'
