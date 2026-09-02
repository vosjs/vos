/**
 * Tier-(a) timeline editing: serializable timing edits over an UNCHANGED
 * `createTimeline` (the timing-overlay strategy).
 *
 * Instead of regenerating user animation code (impossible for opaque
 * onUpdate/modifier tweens), an editor keeps the BASE config and bakes a
 * `TimelineEdit[]` overlay into a thin wrapper: the original function runs and
 * records as always, then `tl.applyEdits(...)` retimes the recorded entries.
 * Works for every tween — structured or opaque — on the vos tween backend.
 *
 * Always wrap the BASE source (never an already-wrapped one): the editor owns
 * the base config + the overlay, and regenerates the wrapper per commit. Lives
 * in shared because two consumers bake it: the studio's program anchor (its
 * composed config, in studio-core) and the web's program edits (base chunk).
 */

/** One entry of the overlay — `@vosjs/tween`'s `TweenEdit`, structurally. */
export interface TimelineEdit {
  index: number
  startTime?: number
  duration?: number
  ease?: string
  to?: Record<string, number>
  from?: Record<string, number>
}

/** Wrap a createTimeline function string with a baked edits overlay. */
export function wrapCreateTimeline(
  baseSource: string,
  edits: readonly TimelineEdit[],
): string {
  return `(ctx, content, duration) => {
  const __base = (${baseSource});
  const tl = __base(ctx, content, duration);
  if (tl && typeof tl.applyEdits === 'function') tl.applyEdits(${JSON.stringify(edits)});
  return tl;
}`
}

/**
 * Produce the effective config: the base config with its createTimeline wrapped
 * by the overlay (the same object when there are no edits).
 */
export function applyTimelineEdits<T extends { createTimeline?: unknown }>(
  baseConfig: T,
  edits: readonly TimelineEdit[],
): T {
  const source = baseConfig.createTimeline
  if (!edits.length || typeof source !== 'string' || !source) return baseConfig
  return { ...baseConfig, createTimeline: wrapCreateTimeline(source, edits) }
}
