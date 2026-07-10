/**
 * Sandbox runtime surface, bundled by bundle.mjs into an injectable IIFE that
 * defines `globalThis.__vosTween`. The render template inlines it when the
 * host selects the vos tween backend: `deps.gsap` becomes
 * `__vosTween.createTweenRecorder()` — a gsap-shaped facade whose timelines
 * record every tween and evaluate themselves deterministically (no GSAP, no
 * CDN fetch). Extraction helpers ride along for in-sandbox editor tooling.
 */
export { createTweenRecorder, RecordingTimeline } from './recorder'
export { extractTimeline, buildTracks } from './extract'
export { tagTarget, readTag } from './target'
export { targetKey } from './types'
