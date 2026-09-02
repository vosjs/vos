/**
 * The take pipeline and the vos.so verbs of the vos CLI, as a library.
 * `run(argv)` dispatches every non-engine verb; `manifest` lists them for
 * `vos help`. This directory used to ship separately as @vosso/vos-plugin
 * (and before that as @vosso/cli and @vosso/voila-cli); it folded into
 * @vosjs/cli so one install carries the whole loop.
 */
export { run } from './run'
export { manifest } from './manifest'
export { recordTake } from './recorder'
export { encodeRecording } from './encode'
export { planTake } from './plan'
export { digestTake, parseTranscript } from './digestTake'
export type { Digest, DigestOptions, DigestResult } from './digestTake'
export { pullMedia } from './media'
export { renderTake } from './renderTake'
export type { RenderTakeOptions, RenderTakeResult } from './renderTake'
export { renderAnimation } from './renderAnimation'
export type {
  RenderAnimationOptions,
  RenderAnimationResult,
} from './renderAnimation'
export { validateActions } from './actions'
export {
  convertAgentBrowser,
  parseAgentBrowserLog,
  splitCommand,
} from './agentBrowser'
export type {
  AgentBrowserRecord,
  ConvertOptions,
  ConvertResult,
} from './agentBrowser'
export type { ActionsFile, ActionStep } from './actions'
export { loadTake, takePaths } from './take'
export type { TakeData, TakePaths } from './take'
export {
  parseVosId,
  platformOrigin,
  readSyncState,
  writeSyncState,
  resolveCredential,
} from './platform'
export type { SyncState, VersionChange } from './platform'
