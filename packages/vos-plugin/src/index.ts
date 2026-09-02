/**
 * @vosso/vos-plugin — the vosso platform layer of the vos CLI, as a library.
 * `run(argv)` is the delegation contract used by @vosjs/cli for every
 * non-engine verb; `manifest` tells the host what those verbs are so
 * `vos help` and version doctoring stay accurate without a vosjs/vos
 * release. Previously published as @vosso/cli (and @vosso/voila-cli) —
 * both names keep working as forwarding shims during the transition.
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
export { launchBrowser, BrowserUnavailableError } from './browser'
export {
  parseVosId,
  platformOrigin,
  readSyncState,
  writeSyncState,
  resolveCredential,
} from './platform'
export type { SyncState, VersionChange } from './platform'
