/**
 * Element types for 2D overlays
 *
 * Elements are 2D content (text, images, SVG, video) rendered as textured
 * 3D planes in the WebGL scene — plus non-visual audio elements that play
 * sound synced to the master clock.
 */
import type * as THREE from 'three'

// =============================================================================
// Position & Transform
// =============================================================================

/**
 * Position can be pixels, percentages, or preset strings
 */
export type ElementPosition =
  | { x: number; y: number }
  | { x: string; y: string }
  | PositionPreset

export type PositionPreset =
  | 'center'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

export type Anchor =
  | 'center'
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

/**
 * 3D transform properties
 */
export interface Transform {
  translateX?: number
  translateY?: number
  translateZ?: number
  rotateX?: number
  rotateY?: number
  rotateZ?: number
  rotation?: number // Alias for rotateZ
  scale?: number
  scaleX?: number
  scaleY?: number
  perspective?: number
  origin?: { x: string; y: string }
}

// =============================================================================
// Base Element
// =============================================================================

/**
 * Base interface for all element types
 */
export interface BaseElement {
  /** Unique identifier for referencing in createTimeline */
  id?: string
  type: 'text' | 'image' | 'svg' | 'video' | 'audio'

  /** Position on screen */
  position: ElementPosition
  /** Transform origin */
  anchor?: Anchor
  /** Layer order (higher = on top, default: 100) */
  zIndex?: number
  /** Opacity 0-1 */
  opacity?: number
  /** 3D transform */
  transform?: Transform
}

// =============================================================================
// Text Element
// =============================================================================

export interface TextElement extends BaseElement {
  type: 'text'
  /** Text content (supports \n for multiline) */
  content: string

  font?: {
    family?: string
    size?: number
    weight?: number | string
    style?: 'normal' | 'italic'
    color?: string
    letterSpacing?: number
    lineHeight?: number
    align?: 'left' | 'center' | 'right'
  }

  stroke?: {
    color: string
    width: number
  }

  shadow?: {
    color: string
    blur: number
    offsetX?: number
    offsetY?: number
  }

  /**
   * Split text into segments for per-character/word/line animation.
   * When split is defined, the element exposes a `segments` array
   * of ElementProps for animating individual parts.
   */
  split?: {
    /** Type of split: 'chars', 'words', or 'lines' */
    type: 'chars' | 'words' | 'lines'
  }
}

// =============================================================================
// Image Element
// =============================================================================

export interface ImageElement extends BaseElement {
  type: 'image'
  /** URL, base64, or imported asset path */
  src: string

  size?: {
    width?: number | 'auto'
    height?: number | 'auto'
    fit?: 'contain' | 'cover' | 'fill'
  }

  filters?: {
    brightness?: number
    contrast?: number
    saturate?: number
    blur?: number
    hueRotate?: number
    grayscale?: number
  }

  borderRadius?: number
}

// =============================================================================
// SVG Element
// =============================================================================

export interface SVGElement extends BaseElement {
  type: 'svg'
  /** SVG string, URL, or imported asset */
  src: string

  size?: {
    width?: number | 'auto'
    height?: number | 'auto'
  }

  /** Override colors in SVG */
  colors?: Record<string, string>
}

// =============================================================================
// Video Element
// =============================================================================

export interface VideoElement extends BaseElement {
  type: 'video'
  src: string

  size?: {
    width?: number | 'auto'
    height?: number | 'auto'
    fit?: 'contain' | 'cover' | 'fill'
  }

  loop?: boolean
  muted?: boolean
  playbackRate?: number
  startTime?: number

  /**
   * Decode strategy:
   *  - 'html5' (default): HTMLVideoElement + VideoTexture (legacy; not frame-accurate)
   *  - 'webcodecs': frame-accurate WebCodecs decode (deterministic export/scrub)
   *  - 'auto': webcodecs when available, else html5
   */
  frameSource?: 'auto' | 'webcodecs' | 'html5'
}

// =============================================================================
// Audio Element
// =============================================================================

/**
 * Non-visual element that plays an audio file synced to the master clock.
 * Drive it like an html5 video: set `playing` and/or animate `currentTime`
 * in createTimeline; playback honors the global pause/seek state, and
 * `props.gain` (0-1) is animatable for fades. Renders no pixels — position,
 * anchor and transform are accepted for BaseElement compatibility but ignored.
 */
export interface AudioElement extends Omit<BaseElement, 'position'> {
  type: 'audio'
  /** Audio file URL (anything the browser's media stack decodes) */
  src: string
  /** Ignored (audio renders no pixels) */
  position?: ElementPosition
  /** Initial volume 0-1 (default: 1); animatable via props.gain */
  gain?: number
  loop?: boolean
  /** Offset into the source when playback begins, seconds (default: 0) */
  startTime?: number
}

// =============================================================================
// Element Config Union
// =============================================================================

export type ElementConfig =
  | TextElement
  | ImageElement
  | SVGElement
  | VideoElement
  | AudioElement

// =============================================================================
// Runtime Types
// =============================================================================

/**
 * GSAP-animatable properties exposed on each element instance
 */
export interface ElementProps {
  x: number
  y: number
  z: number
  opacity: number
  scale: number
  scaleX: number
  scaleY: number
  rotation: number
  rotationX: number
  rotationY: number
  // Text-specific
  fontSize?: number
  letterSpacing?: number
  // Video-specific (only available for video elements)
  /** Current playback position in seconds (animatable with GSAP) */
  currentTime?: number
  /** Video duration in seconds (read-only) */
  readonly duration?: number
  /** Whether the video is playing (controls native playback) */
  playing?: boolean
  /** Start offset for video playback */
  startOffset?: number
  /** Volume 0-1 (audio elements; animatable for fades) */
  gain?: number
}

/**
 * Runtime element instance with animatable props and methods
 */
export interface ElementInstance {
  /** Original configuration */
  config: ElementConfig
  /** Three.js mesh (textured plane) */
  mesh: THREE.Mesh
  /** DOM node for SplitText (text elements only) - typed as unknown for portability */
  node: unknown
  /** GSAP-animatable properties */
  props: ElementProps
  /**
   * Split text segments (only available when split config is defined).
   * Each segment has its own ElementProps for individual animation.
   */
  segments?: ElementProps[]
  /** Update element content (text or image src) */
  setContent: (content: string) => void
  /** Remove element from scene */
  destroy: () => void
}
