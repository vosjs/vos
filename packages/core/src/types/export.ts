/**
 * Export-related types for the animation system
 */

/** Render mode for video export */
export type RenderMode = 'realtime' | 'deterministic'

/** Image format for frame capture */
export type ImageFormat = 'png' | 'jpg' | 'webp'

/** Video format */
export type VideoFormat = 'mp4' | 'webm'

/** Video quality preset */
export type VideoQuality = 'high' | 'medium' | 'low'

/**
 * Options for capturing a single frame
 */
export interface FrameCaptureOptions {
  /** Time in seconds to capture */
  time: number
  /** Output format */
  format: ImageFormat
  /** Output resolution (defaults to canvas size) */
  resolution?: { width: number; height: number }
  /** Quality 0-1 for jpg/webp */
  quality?: number
}

/**
 * Options for exporting a GIF
 */
export interface GifExportOptions {
  /** Start time in seconds */
  startTime: number
  /** End time in seconds */
  endTime: number
  /** Frames per second */
  fps: number
  /** Output resolution */
  resolution?: { width: number; height: number }
  /** GIF quality (1-20, lower is better) */
  quality?: number
  /** Enable dithering */
  dither?: boolean
}

/**
 * Extended video export options with deterministic mode
 */
export interface VideoExportOptions {
  /** Start time in seconds */
  startTime?: number
  /** End time in seconds */
  endTime?: number
  /** Frames per second */
  fps: number
  /** Output format */
  format: VideoFormat
  /** Output resolution */
  resolution: { width: number; height: number }
  /** Quality preset */
  quality?: VideoQuality
  /**
   * Render mode:
   * - 'realtime': Fast but may drop frames
   * - 'deterministic': Waits for GPU, guaranteed smooth
   */
  renderMode?: RenderMode
  /** Progress callback */
  onProgress?: (progress: ExportProgress) => void
  /** Abort signal for cancellation */
  signal?: AbortSignal
}

/**
 * Export progress information
 */
export interface ExportProgress {
  /** Current phase */
  phase: 'preparing' | 'rendering' | 'encoding' | 'finalizing'
  /** Current frame number */
  currentFrame: number
  /** Total frames to render */
  totalFrames: number
  /** Percentage complete (0-100) */
  percent: number
  /** Estimated time remaining in seconds */
  estimatedTimeRemaining?: number
  /** Time to render last frame in ms */
  lastFrameTime?: number
}
