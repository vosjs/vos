/**
 * Chunk planner — timeline sharding for deterministic renders.
 *
 * Because vos evaluation is a pure function of time (seek(t) — the whole
 * point of the sampler tween backend), any frame range can render in
 * isolation. The planner splits [0, totalFrames) into balanced, contiguous
 * ranges; each chunk encodes independently (so it starts on a keyframe by
 * construction) with chunk-LOCAL timestamps starting at 0, and the finalize
 * step (concat.ts) offsets packets back onto the global timeline.
 *
 * Pure math — no I/O — so the policy stays unit-testable and reusable by
 * every harness (CLI, local server, render service).
 */

export interface ChunkPlanPolicy {
  /** Upper bound on simultaneous chunk renders (browser pages/sessions). */
  maxParallel: number
  /**
   * Below this many frames per chunk, extra parallelism costs more in
   * per-chunk fixed overhead (page load, module import, first seek) than it
   * saves — stop splitting. (Remotion's floor is 5; ours is higher because
   * chunk startup includes CDN module imports.)
   */
  minFramesPerChunk?: number
}

export const DEFAULT_MIN_FRAMES_PER_CHUNK = 24

export interface RenderChunk {
  /** 0-based chunk index; also the concat order. */
  index: number
  /** First frame of the chunk (inclusive, global frame numbering). */
  startFrame: number
  /** End frame (exclusive). */
  endFrame: number
  frameCount: number
  /** Global start time in seconds (startFrame / fps). */
  startTime: number
  /** Exact chunk duration in seconds (frameCount / fps). */
  duration: number
}

/**
 * Split `totalFrames` into at most `maxParallel` balanced contiguous chunks.
 * Sizes differ by at most one frame; chunk boundaries are exact frame
 * indices so no frame is rendered twice or skipped.
 */
export function planChunks(
  totalFrames: number,
  fps: number,
  policy: ChunkPlanPolicy,
): RenderChunk[] {
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) {
    throw new Error(
      `planChunks: totalFrames must be a positive integer, got ${totalFrames}`,
    )
  }
  if (!(fps > 0)) {
    throw new Error(`planChunks: fps must be positive, got ${fps}`)
  }
  const minFrames = policy.minFramesPerChunk ?? DEFAULT_MIN_FRAMES_PER_CHUNK
  const chunkCount = Math.max(
    1,
    Math.min(
      Math.floor(policy.maxParallel),
      Math.floor(totalFrames / minFrames),
    ),
  )

  const base = Math.floor(totalFrames / chunkCount)
  const remainder = totalFrames % chunkCount

  const chunks: RenderChunk[] = []
  let startFrame = 0
  for (let index = 0; index < chunkCount; index++) {
    // The first `remainder` chunks carry one extra frame.
    const frameCount = base + (index < remainder ? 1 : 0)
    const endFrame = startFrame + frameCount
    chunks.push({
      index,
      startFrame,
      endFrame,
      frameCount,
      startTime: startFrame / fps,
      duration: frameCount / fps,
    })
    startFrame = endFrame
  }
  return chunks
}
