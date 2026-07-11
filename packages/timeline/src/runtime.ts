/**
 * Runtime entry — the subset of @vosjs/timeline that ships INSIDE running vos
 * programs, bundled to an IIFE string by bundle.mjs and exposed as
 * `globalThis.__vosTimeline`. App lowerings inline `timelineRuntimeCode` into
 * their (constant) program so keyframes/segments travel as plain `ctx.data`
 * and evaluate identically in the editor host and the sandbox.
 *
 * Evaluation only — editing helpers (edits.ts) are host-side and excluded.
 */
export { EASINGS, resolveEase } from './easings'
export { lerpArray, sample } from './sample'
export { mapTime, rateAt, sourceToTimeline, totalDuration } from './mapTime'
