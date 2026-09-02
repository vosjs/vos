/**
 * The studio — shared contracts.
 *
 * These are the seams between the capture extension, the editor, the planner,
 * and the lowering. Branding lives at the app layer;
 * these types are intentionally generic so the core stays extraction-ready.
 */
import { BACKDROP_DEFAULT_ON, withDefaultBackdrop } from './backdrop'
import type { Segment } from '@vosjs/timeline'
import type { ZoomStyleName, ZoomStyleParams } from './zoomStyle'
import type { SpeedParams } from './planner/autoSpeed'

export type { Segment }

/** A single input event captured in the page, relative to the recording's t0. */
export interface CursorEvent {
  /** ms since t0 (recording start). */
  t: number
  /** viewport CSS px. */
  x: number
  y: number
  /**
   * Screen-coordinate CSS px (MouseEvent.screenX/Y) — the mapping anchor for
   * window/monitor captures, where the viewport is only part of the frame.
   * Carrying both spaces per event also gives an exact per-event viewport→screen
   * offset (sx−x, sy−y) for transforming element rects. Absent on old tracks.
   */
  sx?: number
  sy?: number
  /**
   * `key` is a typing-ACTIVITY ping (throttled): when and where typing is
   * happening, never what is typed — the payload must not carry key identity
   * or input contents at any layer. Position/rect follow the `focus`
   * convention: the focused editable element's center + bounds.
   */
  type: 'move' | 'down' | 'up' | 'scroll' | 'focus' | 'key'
  /** pointer button for down/up (0=left). */
  button?: 0 | 1 | 2
  /** target element bounds at event time — enables element-aware auto-zoom. */
  rect?: Rect
}

export type CursorTrack = CursorEvent[]

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Recording metadata needed to map captured pixels ↔ cursor coords ↔ time. */
export interface RecordingMeta {
  /** device pixel ratio at capture. */
  dpr: number
  /** page/browser zoom at capture. */
  zoom: number
  /** wall-clock origin (Date.now at first frame). */
  t0: number
  durationMs: number
  /** captured pixel dimensions. */
  width: number
  height: number
  fps: number
  /**
   * The recording's OWN file carries an audio track — unmute preview, mux into
   * export. After the AT split that track is SYSTEM/tab audio only (it rides
   * the same stream as the video, sample-aligned by construction); on takes
   * recorded before the split it is the legacy record-time mic+system mix.
   */
  hasAudio?: boolean
  /**
   * A separately-recorded microphone sidecar exists. The mic never
   * enters the video file — it records through its own audio-only
   * MediaRecorder so the studio can gain/mute/duck it independently.
   */
  hasMic?: boolean
  /**
   * Recorder start skew: wall-clock ms between the main recorder's start and
   * the mic/cam sidecar recorders' starts (positive = sidecar started later).
   * Lets the consume path trim/pad a sidecar head instead of assuming t0
   * equality. Absent on takes without the matching sidecar.
   */
  micT0DeltaMs?: number
  camT0DeltaMs?: number
  /**
   * Encoded frame dimensions in device px, from the capture track's settings.
   * `width`/`height` are the CSS-px viewport (the CursorEvent coordinate space);
   * these are the actual video pixels — same aspect when capture is constrained
   * to the tab size, but keep both spaces so mapping never assumes it.
   */
  captureWidth?: number
  captureHeight?: number
  /**
   * The tab viewport changed size mid-take. Capture resolution is fixed for the
   * whole take, so Chrome letterboxes the resized content — surface a notice.
   */
  resizedDuringTake?: boolean
  /**
   * Page URL/title at record start (seeds the browser-bar mock's address pill).
   * Query/hash are stripped at capture for privacy.
   */
  pageUrl?: string
  pageTitle?: string
  /**
   * What the frame contains. Absent = 'tab' (back-compat). Non-tab surfaces use
   * CursorEvent.sx/sy + the geometry rects below to map cursor → capture px
   * (see normalizeCaptureSpace); tab-only studio features (browser-bar mock,
   * letterbox notice) are gated off for them.
   */
  captureSurface?: 'tab' | 'window' | 'monitor'
  /**
   * Target-tab browser-window bounds at record start, screen-coord CSS px
   * (window.screenX/Y + outerWidth/Height). Anchor for 'window' captures.
   */
  windowRect?: Rect
  /**
   * FULL bounds of the display hosting the target window at record start,
   * screen-coord CSS px (chrome.system.display bounds — the true origin,
   * including the macOS menu bar; page availLeft/Top only as a fallback).
   * Anchor for 'monitor' captures; wrong-display shares surface as low
   * coverage and fall back to no auto-zoom.
   */
  screenRect?: Rect
  /**
   * The target window moved or resized during a 'window' take — the single
   * windowRect anchor can't map the whole track, so the studio drops the
   * cursor rather than rendering it at stale positions.
   */
  windowMovedDuringTake?: boolean
  /**
   * Viewport CSS-px size (innerWidth/Height) of the recorded tab at record
   * start. On 'window' takes this + windowRect + the cursor events' screen
   * coords derive the viewport crop that removes the real browser chrome from
   * the footage (deriveViewportCrop) so the synthetic browser bar applies.
   */
  viewport?: { w: number; h: number }
  /**
   * The tab viewport changed size mid-take on a display take (resize, devtools
   * dock, zoom) — the static viewport crop can't map the whole take, so crop
   * derivation fails closed.
   */
  viewportChangedDuringTake?: boolean
  /**
   * Fraction of a 'window' take during which the target tab's browser window
   * was the FOCUSED window (chrome.windows.onFocusChanged, pause-gated).
   * The wrong-window tell that geometry can't provide: cursor events come from
   * the recorded tab and its window geometry is self-consistent, so sharing a
   * DIFFERENT window (Finder, another app — even one with identical bounds)
   * still maps events "in frame". But driving that other window means focusing
   * it — a low fraction ⇒ the footage isn't the browser window, so cursor
   * effects and the viewport crop must fail closed (WINDOW_FOCUS_MIN).
   */
  windowFocusedFrac?: number
  /** Recorder OS (chrome.runtime.getPlatformInfo) — seeds the browser-bar style. */
  platform?: 'mac' | 'windows' | 'linux'
  /**
   * Which recorder produced the artifact. CLI takes synthesize the cursor
   * track from automation (exact coords, fresh rects, coverage 1 by
   * construction) and encode WebM; absent means the extension.
   */
  producer?: 'extension' | 'cli'
  /**
   * The step timeline: when each actions.json step ran, in SOURCE
   * seconds. This is what makes a cut re-anchorable across re-records — a
   * span anchored to a step re-times to wherever that step landed in the
   * new recording (`vos plan --reuse`). CLI takes only; a human recording
   * has no script and carries none.
   */
  steps?: StepSpan[]
}

/**
 * A span's tie to an actions.json step: metadata for `vos plan
 * --reuse`, which re-times the span onto a NEW recording of the same script
 * by resolving the step in the new `meta.steps`. NEVER read by lowering —
 * seconds stay the wire truth (`in`/`out` are always authoritative), so a
 * human recording with no steps renders identically with or without one.
 */
export interface StepAnchor {
  /** The step: its `id` from actions.json when it has one, else its index. */
  step: string | number
  /** Which edge of the step the span's `in` is measured from. Default 'start'. */
  at?: 'start' | 'end'
  /** Seconds from that edge to the span's `in` (negative = before it). */
  offset?: number
}

/** The lanes whose planners propose spans, and whose proposals can be rejected. */
export type RejectedLane = 'zoom' | 'tilt' | 'speed'

/**
 * A planner proposal the human or the agent deleted, kept so no re-plan
 * proposes it again: the lane and the SOURCE extent of the deleted `auto`
 * span (plus its step anchor when it had one). Every auto-merge drops a
 * fresh proposal that lands on a rejected extent of the same lane;
 * `plan --reuse` re-times these the way it re-times a manual span.
 */
export interface RejectedSpan {
  /** `r{n}`, stable for the differ and the history. */
  id: string
  lane: RejectedLane
  /** SOURCE seconds, the deleted span's extent. */
  in: number
  out: number
  anchor?: StepAnchor
  /** Why, in the deleter's words. Optional. */
  note?: string
}

/** One executed actions.json step's extent in the recording. */
export interface StepSpan {
  /** index into actions.steps at record time. */
  step: number
  /** the step's own id from actions.json, when it names one — an id lets a
   *  step move or be reordered without breaking anchors (absent = the index
   *  is the identity). */
  id?: string
  do: string
  selector?: string
  /** SOURCE seconds the gesture occupied, [tStart, tEnd]. */
  tStart: number
  tEnd: number
  /** the selector never became visible — the gesture did not run. */
  skipped?: boolean
}

/** Everything the capture extension hands off to the studio. */
export interface RecordingArtifact {
  /** OPFS key / object URL for the recorded video. */
  videoKey: string
  cursor: CursorTrack
  /** object URL for the separately-recorded mic sidecar (the mic/system split). */
  audioKey?: string
  /** object URL for a separately-recorded webcam track (drawn as an editable bubble). */
  camKey?: string
  meta: RecordingMeta
}

/**
 * Per-span transition speed — how fast the camera/bubble/card moves
 * into and out of a span's state, as NAMED steps (the category convention:
 * Screen Studio's speed words, Descript's one knob — never a curve editor).
 * Multipliers on the lane's own ramp constants, so 'smooth' (absent) is
 * byte-identical to the pre-feature motion and each lane keeps its feel.
 * 'instant' is a hard cut: the ramp collapses to the track emitter's 1ms
 * collision nudge.
 */
export type TransitionSpeed = 'instant' | 'fast' | 'smooth' | 'slow'

export const TRANSITION_SPEED_MULT: Record<TransitionSpeed, number> = {
  instant: 0,
  fast: 0.5,
  smooth: 1,
  slow: 1.6,
}

/** A span's ramp multiplier (absent = 'smooth' = 1, the exact legacy motion). */
export function transitionMult(t: TransitionSpeed | undefined): number {
  return t !== undefined && t in TRANSITION_SPEED_MULT
    ? TRANSITION_SPEED_MULT[t]
    : 1
}

/**
 * A speed-change region over a SOURCE-time span (seconds). Footage-anchored
 * like zoom keyframes — it follows its content through trims/splits, and a
 * span whose footage is fully cut away simply has no effect (and comes back
 * if the trim is undone). Non-overlapping (the lane clamps). The lowering
 * intersects spans with `segments` via @vosjs/timeline `splitBySpeed` into
 * rated segments; playback, export, and lane display all evaluate those.
 */
export interface SpeedSpan {
  /** Stable identity for selection/editing in the timeline UI. */
  id: string
  in: number
  out: number
  /** Re-record tie to an actions.json step; `in`/`out` stay the truth. */
  anchor?: StepAnchor
  /** Playback rate (> 0): 2 = twice as fast, 0.5 = half speed. */
  rate: number
  /**
   * The auto-zoom wand contract: 'auto' = planner suggestion
   * (planAutoSpeed — typing/scroll/idle), replaced by a re-plan; 'manual' =
   * user/agent work, always preserved. Absent = manual (spans predating the contract).
   */
  source?: 'auto' | 'manual'
}

/**
 * Speed-rate bounds. 16 is also Chromium's HTMLMediaElement.playbackRate
 * ceiling, so preview (native playback) and export (offline resample) can
 * honor the same range.
 */
export const SPEED_RATE_MIN = 0.1
export const SPEED_RATE_MAX = 16

/**
 * Minimum speed-span length in OUTPUT seconds (the lane converts through the
 * span's own rate: a 2× span may not shrink below 0.5s of source). A source
 * floor shrank with the rate — 0.1s of source at 5× was 20ms of screen, a
 * sliver nobody could grab again.
 */
export const SPEED_SPAN_MIN = 0.25

/** Clamp + quantize a speed rate for storage (2 decimals, like "1.75×"). */
export function clampSpeedRate(rate: number): number {
  const r = Math.min(SPEED_RATE_MAX, Math.max(SPEED_RATE_MIN, rate))
  return Math.round(r * 100) / 100
}

/**
 * A zoom region over a SOURCE-time span (seconds) — one adjustable clip on the
 * zoom lane. Footage-anchored like SpeedSpan/CamStyle.window: it follows its
 * content through trims/splits (a span whose footage is fully cut away renders
 * nothing, and comes back if the trim is undone; a partially-cut span keeps its
 * kept extent). Non-overlapping (the lane clamps). The camera ramps in around
 * `in`, holds `[level, cx, cy]` until `out`, then ramps back to 1× — or pans
 * straight to the next span when the gap is short (see `zoomTrackFromDoc`).
 */
export interface ZoomSpan {
  /** Stable identity for selection/editing (`z{n}` planner, `u{n}` user). */
  id: string
  in: number
  out: number
  /** Re-record tie to an actions.json step; `in`/`out` stay the truth. */
  anchor?: StepAnchor
  /** zoom level (1 = no zoom), ZOOM_LEVEL_MIN..ZOOM_LEVEL_MAX, 2 decimals. */
  level: number
  /** focus point in normalized [0..1] video-frame coords. */
  cx: number
  cy: number
  /** arrival ease (@vosjs/timeline EASINGS name). Absent = the default ramp ease. */
  ease?: string
  /**
   * Transition speed for THIS span's ramps (in, out, and the pan arriving
   * here from a chained neighbor). Absent = 'smooth', the camera style's
   * stock motion; 'instant' is a hard cut.
   */
  transition?: TransitionSpeed
  /**
   * 'auto' = the camera follows the cursor through the span (dead-zone
   * recenter, baked deterministically at lowering — see followFocusEvents);
   * absent/'manual' = the fixed cx/cy focus.
   */
  focusMode?: 'manual' | 'auto'
  /**
   * 'auto' = planner suggestion — regenerate replaces these freely, never
   * 'manual' ones. Any edit gesture promotes the span to 'manual' (OpenScreen's
   * contract: suggestions are disposable, user work is sacred).
   */
  source?: 'auto' | 'manual'
}

/** Zoom-level preset chips (OpenScreen-style picker). */
export const ZOOM_LEVELS = [1.25, 1.5, 1.8, 2.2, 3.5, 5] as const
export const ZOOM_LEVEL_MIN = 1
export const ZOOM_LEVEL_MAX = 5
/** Default level for new/user-created zooms. */
export const DEFAULT_ZOOM_LEVEL = 1.8
/**
 * Minimum zoom-span length in OUTPUT seconds (the lane clamps resizes,
 * converting through the rate in force so the floor is what the eye sees).
 */
export const ZOOM_SPAN_MIN = 0.3

/** Clamp + quantize a zoom level for storage (2 decimals, like "1.8×"). */
export function clampZoomLevel(level: number): number {
  const l = Math.min(ZOOM_LEVEL_MAX, Math.max(ZOOM_LEVEL_MIN, level))
  return Math.round(l * 100) / 100
}

/**
 * A tilt region over a SOURCE-time span (seconds) — one adjustable clip on the
 * tilt lane. Footage-anchored
 * like ZoomSpan/SpeedSpan: it follows its content through trims/splits and
 * speed changes (a span whose footage is fully cut away renders nothing, and
 * comes back if the trim is undone). Non-overlapping (the lane clamps). While
 * active the card leans to this pose; between spans it returns to the RESTING
 * FLAT rest pose (there is no static card tilt) — expanded at lowering into an
 * OUTPUT-time [rx, ry] degree keyframe track (see tiltTrackFromDoc).
 */
export interface TiltSpan {
  /** Stable identity for selection/editing (`t{n}` planner, `u{n}` user). */
  id: string
  in: number
  out: number
  /** Re-record tie to an actions.json step; `in`/`out` stay the truth. */
  anchor?: StepAnchor
  /**
   * Pose in DEGREES (the CardTilt convention): rx leans the card back/forward,
   * ry swings it left/right. Gentle values read best (±5..18°).
   */
  rx: number
  ry: number
  /** arrival ease (@vosjs/timeline EASINGS name). Absent = the house tilt ease. */
  ease?: string
  /**
   * Transition speed for this span's ramps. Absent = 'smooth' (the stock
   * tilt motion); 'instant' snaps the card to the pose.
   */
  transition?: TransitionSpeed
  /**
   * 'auto' = Dynamic-tilt wand suggestion — regenerate replaces these freely,
   * never 'manual' ones. Any edit gesture promotes the span to 'manual' (the
   * auto-zoom wand contract).
   */
  source?: 'auto' | 'manual'
}

/** Hard tilt bound in degrees (schema/lint); UI sliders stay within ±20. */
export const TILT_DEG_MAX = 45
/** UI slider bound — matches the Card panel's static (rest) tilt sliders. */
export const TILT_UI_DEG_MAX = 20
/**
 * Minimum tilt-span length in OUTPUT seconds (the lane clamps resizes). Bigger
 * than ZOOM_SPAN_MIN because tilt ramps are longer — a pose that can't settle
 * isn't a pose.
 */
export const TILT_SPAN_MIN = 0.8
/** Default pose for user-created spans: a medium three-quarter "showcase" lean. */
export const DEFAULT_TILT_POSE = { rx: 6, ry: -9 }

/** Clamp + quantize a tilt angle for storage (1 decimal, degrees). */
export function clampTiltDeg(deg: number): number {
  const d = Math.min(TILT_DEG_MAX, Math.max(-TILT_DEG_MAX, deg))
  return Math.round(d * 10) / 10
}

/**
 * Dynamic-tilt wand intensity ladder (the category convention — FocuSee ships
 * Subtle/Default/Strong): the max degrees planAutoTilt will lean per axis.
 */
export type TiltStyleName = 'off' | 'subtle' | 'medium' | 'strong'
export const TILT_INTENSITY_MAX: Record<
  Exclude<TiltStyleName, 'off'>,
  number
> = {
  subtle: 5,
  medium: 9,
  strong: 14,
}

export interface CursorStyle {
  /**
   * Draw the cursor dot. Off still keeps the track: auto-zoom cursor-follow
   * and click effects are independent of whether the dot is painted. Absent
   * reads as visible (pre-toggle docs).
   */
  visible: boolean
  /** 0..1 smoothing strength (lerp factor; higher = smoother/laggier). */
  smoothing: number
  /** rendered cursor size in px. */
  size: number
  style: 'default' | 'dot' | 'ring'
  hideWhenIdle: boolean
  clickFx: ClickFxStyle
}

/**
 * Click-effect styling. Clicks are extracted
 * at lowering (OUTPUT-anchored — see extractClicks) and drawn by ON_FRAME as a
 * pure function of t; every field here is a live SET_DATA edit.
 */
export interface ClickFxStyle {
  /** ring drawn at the click point ('highlight' glows the clicked element's rect). */
  style: 'none' | 'ripple' | 'pulse' | 'highlight'
  /** cursor press dip on real down→up spans — independent of ring style. */
  press: boolean
  intensity: 'subtle' | 'medium' | 'strong'
  /** resolved hex for rings/glow; 'auto' = neutral white-over-dark-rim. */
  color: string | 'auto'
}

/**
 * Named intensity levels → resolved multipliers (size/alpha `k`, duration
 * `dur`), baked into ctx.data at lowering so ON_FRAME needs no registry —
 * the same pattern as MINIMAL_BAR_THEMES resolving to concrete colors.
 */
export const CLICK_FX_INTENSITY: Record<
  ClickFxStyle['intensity'],
  { k: number; dur: number }
> = {
  subtle: { k: 0.7, dur: 0.9 },
  medium: { k: 1, dur: 1 },
  strong: { k: 1.35, dur: 1.1 },
}

/** Webcam bubble overlay — an editable layer composited over the frame. */
export interface CamStyle {
  visible: boolean
  /**
   * Free placement: the bubble CENTER as frame fractions (the overlay
   * and zoom cx/cy convention, so positions survive aspect switches). When
   * present they WIN over `position`; clearing them snaps back to the corner.
   */
  x?: number
  y?: number
  /** corner the bubble is anchored to when x/y are absent. */
  position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
  /** bubble diameter as a fraction of frame height (0..1). */
  size: number
  shape: 'circle' | 'rounded'
  /**
   * Corner radius in design px for the 'rounded' shape (absent = 18, the
   * house look; a circle ignores it). Scales with the canvas like every
   * frame-owned control.
   */
  radius?: number
  /**
   * Ring stroke over the bubble edge. Absent = the house ring (3px white at
   * 0.9 alpha — the pre-existing paint); `width: 0` = no ring.
   */
  border?: { width: number; color: string }
  /** Bubble shadow. Absent = 'soft', the pre-existing paint. */
  shadow?: 'none' | 'soft' | 'strong'
  /** mirror horizontally (selfie view). */
  mirror: boolean
  /**
   * Show the bubble only during this SOURCE-time span (trimmed on the cam
   * timeline lane; anchored to footage like zoom keyframes). Absent = always.
   */
  window?: Segment
}

/**
 * A cam pose region over a SOURCE-time span (seconds) — one adjustable clip on
 * the cam-move lane (MO track: animated cam layouts, the Screen Studio
 * signature). Footage-anchored like ZoomSpan/TiltSpan: it follows its content
 * through trims/splits and speed changes (a span whose footage is fully cut
 * away renders nothing, and comes back if the trim is undone). Non-overlapping
 * (the lane clamps). While active the bubble holds this pose; outside spans it
 * rests at the doc's cam style (doc.cam IS the rest pose); spans close together
 * in output time morph pose-to-pose without returning to rest. Absent pose
 * fields inherit the rest pose, so a span may move without resizing. Expanded
 * at lowering into an OUTPUT-time [x, y, size] fraction keyframe track
 * (camTrackFromDoc) — pure f(t), no springs.
 */
export interface CamPoseSpan {
  /** Stable identity for selection/editing (`m{n}` user-created). */
  id: string
  in: number
  out: number
  /**
   * Bubble CENTER as frame fractions [0..1] (the cam.x/y and zoom cx/cy
   * convention — aspect-stable). Absent = the rest pose's center.
   */
  x?: number
  y?: number
  /** Bubble diameter as a fraction of frame height. Absent = the rest size. */
  size?: number
  /** arrival ease (@vosjs/timeline EASINGS name). Absent = the house cam ease. */
  ease?: string
  /**
   * Transition speed for this span's morphs. Absent = 'smooth' (~0.65s);
   * 'instant' jump-cuts the bubble to its pose — the Screen Studio layout-cut.
   */
  transition?: TransitionSpeed
  /**
   * Reserved for a future auto planner (the wand contract: 'auto' spans are
   * disposable suggestions). Every studio gesture writes 'manual'.
   */
  source?: 'auto' | 'manual'
}

/**
 * Minimum cam-move span length in OUTPUT seconds (the lane clamps resizes).
 * Between zoom's 0.3 and tilt's 0.8: a bubble move settles faster than a card
 * pose but still needs its ~0.65s ramp to read as a move, not a jump.
 */
export const CAM_SPAN_MIN = 0.5
/** Bubble-size band for pose spans (fractions of frame height; UI + lint). */
export const CAM_SIZE_MIN = 0.08
export const CAM_SIZE_MAX = 0.6

/** Clamp + quantize a pose size for storage (3 decimals, frame fraction). */
export function clampCamSize(size: number): number {
  const v = Math.min(CAM_SIZE_MAX, Math.max(CAM_SIZE_MIN, size))
  return Math.round(v * 1000) / 1000
}

/** Clamp + quantize a pose center coordinate for storage (3 decimals, [0..1]). */
export function clampCamFrac(v: number): number {
  const c = Math.min(1, Math.max(0, v))
  return Math.round(c * 1000) / 1000
}

/**
 * Default pose for user-created cam-move spans: front-and-center, large —
 * the "talk to camera" moment that is the feature's reason to exist (the
 * DEFAULT_TILT_POSE philosophy: a new span shows a visible, editable move,
 * never a no-op).
 */
export const DEFAULT_CAM_POSE = { x: 0.5, y: 0.55, size: 0.45 }

/**
 * Mock browser chrome drawn as a strip above the video inside the frame card.
 * Drawn by the compositor (never captured) — the editor-frame pattern every
 * shot/recorder tool uses. All values travel in `ctx.data.frame` (live T2 edits).
 */
export interface BrowserBarStyle {
  kind:
    | 'none'
    | 'mac-light'
    | 'mac-dark'
    | 'windows-light'
    | 'windows-dark'
    | 'minimal'
  /** address-pill text (editable; seeded from the recorded page's URL). */
  url: string
  showUrl: boolean
  /** traffic lights (mac) / window buttons (windows). */
  showControls: boolean
  /** bar height in design px (1080-based, same space as padding/radius). */
  height: number
  /**
   * Minimal-bar color theme — RESOLVED colors (not a palette id) so ON_FRAME
   * needs no registry lookup (interpreter rule: everything in ctx.data is
   * self-contained). Absent = the built-in graphite look. Pick from
   * MINIMAL_BAR_THEMES in the inspector.
   */
  theme?: MinimalBarTheme
}

/** Resolved minimal-bar colors. `light` flips the hairline to dark-on-light. */
export interface MinimalBarTheme {
  id: string
  bar: string
  pill: string
  text: string
  light?: boolean
}

/**
 * Curated minimal-bar palette (Cursorful-style 12 swatches: 6 dark, 6 light).
 * The first entry matches the built-in default (theme absent).
 */
export const MINIMAL_BAR_THEMES: MinimalBarTheme[] = [
  { id: 'graphite', bar: '#141417', pill: '#26262b', text: '#9a9aa1' },
  { id: 'charcoal', bar: '#27272a', pill: '#3a3a3f', text: '#b0b0b6' },
  { id: 'ink', bar: '#0f172a', pill: '#1e293b', text: '#94a3b8' },
  { id: 'slate', bar: '#1e293b', pill: '#334155', text: '#a8b6c8' },
  { id: 'navy', bar: '#172033', pill: '#232e47', text: '#8fa0bd' },
  { id: 'steel', bar: '#2f3542', pill: '#414a5c', text: '#aab3c5' },
  { id: 'snow', bar: '#f8fafc', pill: '#ffffff', text: '#5f6368', light: true },
  {
    id: 'white',
    bar: '#ffffff',
    pill: '#f1f3f4',
    text: '#5f6368',
    light: true,
  },
  { id: 'mist', bar: '#e8ecf1', pill: '#f8fafc', text: '#566172', light: true },
  {
    id: 'lavender',
    bar: '#e7e9f8',
    pill: '#f6f7fe',
    text: '#5b5f79',
    light: true,
  },
  { id: 'sky', bar: '#dbe6f7', pill: '#f2f7ff', text: '#4d6079', light: true },
  {
    id: 'blush',
    bar: '#f7ecec',
    pill: '#fdf7f7',
    text: '#77595c',
    light: true,
  },
]

/**
 * A music/SFX clip. OUTPUT-anchored (`start` is final-cut seconds): music and
 * effects are authored against the cut that remains — unlike zoom keyframes /
 * cam window, they do NOT follow footage through trims. The mic track stays
 * source-anchored via the export's segment splice.
 */
export interface AudioClip {
  id: string
  /** blob URL (or asset URL) of the audio file. */
  key: string
  /** display name (file name or library track title). */
  name: string
  /** placement on the OUTPUT timeline, seconds. */
  start: number
  /** kept span within the source file, seconds (trim). */
  in: number
  out: number
  /** full source-file length, seconds — the trim ceiling (set on add). */
  duration: number
  /** linear gain 0..1. */
  gain: number
  /** fade durations, seconds. */
  fadeIn: number
  fadeOut: number
  /** loop the [in,out) span to fill `loopLen` output seconds. */
  loop?: boolean
  /** placed output length when looping (≥ span; defaults to the span). */
  loopLen?: number
  /** duck this clip under the mic while speech is detected. */
  duck?: boolean
}

/** Effective placed length of a clip on the output timeline, seconds. */
export function clipLength(
  clip: Pick<AudioClip, 'in' | 'out' | 'loop' | 'loopLen'>,
): number {
  const span = Math.max(0, clip.out - clip.in)
  return clip.loop ? Math.max(span, clip.loopLen ?? span) : span
}

/**
 * Media layer drawn over the CSS `background` and under the card
 * The flagship option is a vos rendered
 * to a seamless loop (`vosId` provenance kept for re-bakes + a future live
 * tier). Video time is OUTPUT-anchored modulo the loop (`bgT = t % duration`)
 * — trims/speed never retime ambience. Fail-open: while the media loads (or if
 * it can't), the CSS background underneath still paints — never a black frame.
 */
export interface BackgroundMedia {
  kind: 'video' | 'image'
  /**
   * Source URL — blob URL (session), /api/assets/{id}/file (saved vos),
   * https://assets.vos.so/... (pre-baked official), or take-dir relative path
   * (CLI). Rides the same resolution plumbing as source.videoKey.
   */
  key: string
  /** Loop length in seconds (video; the bake duration). */
  duration?: number
  /** Provenance: the vos this media was rendered from. */
  vosId?: string
  versionId?: string
  /** Poster/thumbnail URL (picker display + reduced-motion; not drawn by the layer). */
  poster?: string
  /** Black scrim over the media, 0..1 — the one legibility dial. */
  dim: number
  /** Blur radius in design px — softens the media behind the card. */
  blur?: number
}

export interface FrameStyle {
  /** CSS background (gradient/color): always painted — the media underlay/fallback. */
  background: string
  /** Optional media layer (vos loop / image) drawn over the CSS background. */
  backgroundMedia?: BackgroundMedia | null
  padding: number
  radius: number
  /** shadow strength 0..1. */
  shadow: number
  /** stroke around the card, 0..1 alpha (0 = off). The switch AND the opacity. */
  border: number
  /**
   * Stroke width in design px (scales with the canvas, like radius), drawn
   * OUTWARD from the card's edge (a CSS outline) so it never covers footage.
   * Absent = FRAME_BORDER_WIDTH_DEFAULT, the hairline every take shipped with.
   */
  borderWidth?: number
  /**
   * Stroke colour, any CSS colour string. Absent = FRAME_BORDER_COLOR_DEFAULT.
   * `border` is the alpha it is drawn at, so an opaque colour is correct here.
   */
  borderColor?: string
  /**
   * How footage meets an off-ratio frame. 'contain' (default) fits the
   * whole card inside the padded area, letterboxing onto the background;
   * 'cover' makes the padded area the card and cover-fills it with footage,
   * cropped around `focus` — what a 440x280 store tile or a 2.5:1 marquee
   * demands ("fill the region"). Absent = contain; every existing doc is
   * byte-identical.
   */
  fit?: 'contain' | 'cover'
  /**
   * Cover-crop anchor, normalized video-frame fractions (the zoom cx/cy
   * convention): which point of the footage stays visible when `fit:'cover'`
   * crops. Absent = center. Ignored under contain.
   */
  focus?: { cx: number; cy: number }
  aspectRatio: string
  browserBar: BrowserBarStyle
  /**
   * Background parallax 0..1: the background media counter-pans subtly
   * as the zoom camera moves (depth cue). 0/absent = static.
   */
  parallax?: number
}

/**
 * Overlay clips (compositor v2: "elements-shaped data"). Screen-
 * space clips drawn on the OVERLAY layer (above the card, never tilts, outside
 * the zoom transform). **OUTPUT-anchored** — trims/speed never retime a title.
 * The first slice ships `kind: 'text'`; image/video kinds are the next slice and extend this
 * union without changing the anchoring or transform model.
 */
export type OverlayKind = 'text' | 'image' | 'video'

/** Named house text styles — resolved to concrete font/size/color at lowering. */
export type TextOverlayPreset = 'title' | 'caption' | 'label'

/** Enter/exit transition presets — pure f(t), evaluated in ON_FRAME. */
export type OverlayTransition = 'none' | 'fade' | 'rise'

/** Text animation vocabulary — entrance presets evaluated per unit. */
export type TextFxKind = 'fade' | 'rise' | 'pop' | 'blur' | 'typewriter'
export type TextFxUnit = 'block' | 'line' | 'word' | 'char'
export type TextFxDirection = 'forward' | 'reverse' | 'center'

/**
 * Text entrance animation. When present it OWNS the entrance — the
 * clip's `enter` string is ignored (a spec with `unit: 'block'` is the
 * superset of the legacy presets); `exit` stays clip-level. Segmentation is
 * baked at lowering (deterministic doc-derived data), per-unit progress is
 * evaluated in ON_FRAME — pure f(t), so scrub/seek/chunk cold-seeks agree.
 */
export interface TextFxSpec {
  fx: TextFxKind
  /** What animates as one thing (default 'block' — the whole text). */
  unit?: TextFxUnit
  /** Unit start order (default 'forward'; 'center' ripples outward). */
  direction?: TextFxDirection
  /**
   * Seconds between unit starts. Defaults: typewriter 0.05, other kinds
   * 0.06 when unit ≠ block, else 0. Clamped at lowering so the whole
   * entrance fits the clip.
   */
  stagger?: number
  /** Per-unit seconds (default OVERLAY_TRANSITION_DUR); typewriter ignores it. */
  duration?: number
}

/**
 * A pose keyframe on an overlay/object clip (element motion).
 * `at` is CLIP-LOCAL OUTPUT seconds (0 = the clip's start), so poses ride
 * along when the clip moves. Values interpolate across the gap between poses
 * (ease-into per pose, the KeyframeTrack convention); a hold is two identical
 * poses. The clip's base transform is the value before the first pose, and
 * absent fields inherit it — a pose may move without resizing. Baked at
 * lowering into a clip-local keyframe track, sampled in ON_FRAME as pure
 * f(t): scrub, export and chunked server renders agree by construction.
 */
export interface MotionPose {
  /** Clip-local OUTPUT seconds. */
  at: number
  /** Anchor center as frame fractions (the transform.x/y convention). */
  x?: number
  y?: number
  /** Scale multiplier (the transform.scale convention). */
  scale?: number
  /** Degrees (the transform.rotation convention). */
  rotation?: number
  /** Opacity MULTIPLIER 0..1 on the clip's own alpha (default 1). */
  opacity?: number
  /** Arrival ease (@vosjs/timeline EASINGS name). Absent = the house motion ease. */
  ease?: string
}

/** Default pose-to-pose ease: a symmetric in-out (continuous motion between
 * poses, not a settle — the CapCut/keyframe convention). */
export const MOTION_EASE = 'power2.inOut'

export interface OverlayTransform {
  /**
   * Anchor CENTER as FRACTIONS of the output frame [0..1] (the zoom cx/cy
   * convention): 0.5/0.5 = frame center at ANY aspect ratio — positions
   * survive aspect switches (design px did not: the space's width changes
   * with the aspect, pushing clips off-frame).
   */
  x: number
  y: number
  /** Uniform scale multiplier on the preset size. */
  scale: number
  /** Rotation in degrees (screen-space, about the anchor). */
  rotation: number
}

interface OverlayClipBase {
  /** Stable identity for selection/editing in the timeline UI. */
  id: string
  /** OUTPUT-time span (seconds). */
  start: number
  duration: number
  transform: OverlayTransform
  /** Absent = 'rise' for enter, 'fade' for exit (the house default motion). */
  enter?: OverlayTransition
  exit?: OverlayTransition
  /**
   * Pose keyframes (see MotionPose): the clip's transform animated
   * over clip-local time, rendered as diamonds on the clip. Optional: absent
   * lowers byte-identically (no track in data).
   */
  motion?: MotionPose[]
}

export interface TextOverlayClip extends OverlayClipBase {
  kind: 'text'
  /** Text content; '\n' breaks lines. */
  text: string
  preset: TextOverlayPreset
  /** Font size override in design px (preset default when absent). */
  size?: number
  /** CSS color override (preset default when absent). */
  color?: string
  /**
   * Font family override — a catalog family name (GET /api/fonts). Unknown
   * names fail open: used verbatim with the preset stack as fallback.
   */
  family?: string
  /** Weight override — snapped to the nearest weight the catalog hosts. */
  weight?: number
  /** Synthesized oblique (no italic files are hosted). */
  italic?: boolean
  /** Multi-line alignment within the block (default center). */
  align?: 'left' | 'center' | 'right'
  /** Letter spacing in design px at the resolved size (default 0). */
  letterSpacing?: number
  /** Line height multiplier (default OVERLAY_LINE_HEIGHT). */
  lineHeight?: number
  /** Text outline, drawn under the fill. */
  stroke?: TextOverlayStroke
  /** Background pill behind the text block (absent = none). */
  box?: TextOverlayBox
  /** Entrance animation. Absent = the legacy `enter` transition. */
  fx?: TextFxSpec
  /**
   * Wrap width as a FRACTION of the frame width [0.1..1] (the transform.x
   * convention — aspect-stable). Absent = no wrapping (lines break only on
   * explicit \n). Wrapping is greedy over word tokens at measured widths; a
   * single token wider than the budget gets its own line (no intra-word
   * breaks). Tokens keep their trailing whitespace, so fx unit sequences
   * are IDENTICAL wrapped or not — entrances regroup, never recount.
   */
  maxWidth?: number
}

export interface TextOverlayStroke {
  /** CSS stroke color. */
  color: string
  /** Stroke width in design px at the resolved size. */
  width: number
}

/**
 * Text background pill. Paddings and radius are EMs of the resolved font
 * size, so the pill scales with the text through size overrides, transform
 * scale and output resolution alike.
 */
export interface TextOverlayBox {
  /** CSS color of the pill. */
  color: string
  /** Extra opacity multiplier on top of the clip's fade alpha (default 1). */
  opacity?: number
  /** Horizontal padding in EMs (default 0.6). */
  paddingX?: number
  /** Vertical padding in EMs (default 0.35). */
  paddingY?: number
  /** Corner radius in EMs (default 0.25); clamped to half the pill height. */
  radius?: number
}

/**
 * Image/video overlay (V1b) — a media card on the overlay layer. `key` rides
 * the same resolution plumbing as source.videoKey / backgroundMedia.key
 * (blob URL in-session, /api/assets URL saved, take-dir path in CLI takes).
 * Sized by `width` (fraction of the FRAME width, aspect from the media) ×
 * transform.scale. Video time is clip-local (t − start), muted (soundtracks
 * belong to doc.audio), looping optional.
 */
export interface MediaOverlayClip extends OverlayClipBase {
  kind: 'image' | 'video'
  key: string
  /**
   * The card shadow. Absent = 'soft' — the baked look every
   * doc predating the field renders, so absence lowers byte-identically. 'strong' is the
   * hero float, 'none' the flat cutout.
   */
  shadow?: 'none' | 'soft' | 'strong'
  /**
   * An outline stroke drawn over the clipped media edge.
   * Absent = none. `width` in design px (scales with the canvas like
   * radius); any CSS color.
   */
  border?: { width: number; color: string }
  /** Base width as a fraction of the frame width [0..1]. Absent = 0.35. */
  width?: number
  /** Corner radius in design px. Absent = 12 (the house card radius). */
  radius?: number
  /** Opacity 0..1. Absent = 1. */
  opacity?: number
  /** Video only: loop while the clip is active. Absent = hold the last frame. */
  loop?: boolean
}

export type OverlayClip = TextOverlayClip | MediaOverlayClip

/**
 * Ceiling on `transform.scale` for text overlays, shared by the canvas box
 * and the panel so the two can never disagree about where growth stops (a
 * 64px title at 8× is a 512px hero word — past that it is a poster, not a
 * caption). The floor is 0.1 in both places.
 */
export const OVERLAY_SCALE_MAX = 8
export const OVERLAY_MEDIA_DEFAULT_WIDTH = 0.35
export const OVERLAY_MEDIA_DEFAULT_RADIUS = 12

/**
 * World-space object clips (compositor v2). These shapes are
 * DRAFTED AS THE FUTURE ENGINE SPEC: field names, asset-ref shape, and transform
 * convention carry to `objects?: ObjectConfig[]` upstream unchanged — today they
 * run interpreter-side (ON_FRAME reconciles meshes from ctx.data; live
 * SET_DATA add/remove), and a later engine release swaps the construction site into the engine.
 *
 * Conventions (agent-facing units match the rest of the doc):
 *  - position x/y = FRACTIONS of the frame [0..1] (the overlay/zoom
 *    convention), z = world units TOWARD the camera from the card plane
 *    (0 = on the card's depth; 0.5 floats clearly in front).
 *  - scale = fraction of the FRAME HEIGHT the object's unit size occupies.
 *  - span (OUTPUT seconds) gates visibility with soft edge fades; absent =
 *    the whole timeline.
 */
export type ObjectPrimitiveShape = 'cube' | 'sphere' | 'torus' | 'knot'

/**
 * 3D-text material presets — fleet-audited: everything single-sided,
 * no `dispersion`, transmission only single-sided (the documented
 * SwiftShader constraints). Resolved to plain material params at lowering.
 */
export type Text3dMaterial = 'standard' | 'metal' | 'glass' | 'neon'

export type ObjectAsset =
  /** Curated primitive props — fleet-safe, no asset fetch. */
  | { kind: 'primitive'; shape: ObjectPrimitiveShape; color?: string }
  /** GLB by key — accepted in the schema for forward compat with the engine spec; loads in a later slice. */
  | { kind: 'gltf'; key: string }
  /**
   * Extruded 3D text from a hosted typeface JSON. `typeface` is a
   * catalog slug or family name (GET the list from the typeface catalog;
   * unknown names fall back to the house face). `depth` is the extrusion as
   * a fraction of the glyph height (default 0.25); `bevel` defaults on.
   */
  | {
      kind: 'text3d'
      text: string
      typeface?: string
      material?: Text3dMaterial
      color?: string
      depth?: number
      bevel?: boolean
    }

/** Curated motion presets — pure f(t), deterministic. */
export type ObjectAnimation = 'spin' | 'float'

/**
 * A pose keyframe on a 3D object clip (the MotionPose model over
 * transform3d). `at` is CLIP-LOCAL OUTPUT seconds from the clip's span start
 * (0 when the clip has no span). Absent fields inherit the base transform3d;
 * `spin`/`float` presets compose ADDITIVELY on top of the sampled pose.
 */
export interface MotionPose3D {
  at: number
  /** Frame fractions (the transform3d.x/y convention). */
  x?: number
  y?: number
  /** World units toward the camera from the card plane. */
  z?: number
  /** Euler degrees. */
  rx?: number
  ry?: number
  rz?: number
  /** Fraction of the frame height. */
  scale?: number
  /** Arrival ease (@vosjs/timeline EASINGS name). Absent = the house motion ease. */
  ease?: string
}

export interface ObjectClip {
  id: string
  asset: ObjectAsset
  /** OUTPUT-time visibility span; absent = always. */
  span?: { start: number; duration: number }
  transform3d: {
    x: number
    y: number
    /** World units toward the camera from the card plane. */
    z: number
    /** Euler degrees. */
    rx: number
    ry: number
    rz: number
    /** Fraction of the frame height. */
    scale: number
  }
  animation?: ObjectAnimation | null
  /** Pose keyframes (see MotionPose3D). Absent lowers byte-identically. */
  motion?: MotionPose3D[]
}

export const OBJECT_DEFAULT_SCALE = 0.18

/** Enter/exit transition length in seconds (pure f(t) in ON_FRAME). */
export const OVERLAY_TRANSITION_DUR = 0.35
/** Line height multiplier for multi-line text overlays. */
export const OVERLAY_LINE_HEIGHT = 1.25
export const OVERLAY_MIN_DURATION = 0.2

/**
 * The editable project state. An app-level convention that *lowers to* a vos
 * Composition (it is NOT vos core). Fully serializable.
 */
export interface ProjectDoc {
  source: {
    videoKey: string
    cursor: CursorTrack
    meta: RecordingMeta
    /** object URL for a separately-recorded webcam track, if the take had a camera. */
    camKey?: string
    /**
     * object URL for the separately-recorded microphone sidecar (AT split).
     * When present the recording's own audio track (hasAudio) is SYSTEM/tab
     * audio and micGain governs this sidecar; absent on legacy takes, where
     * the recording's track is the old record-time mix.
     */
    micKey?: string
    /**
     * Decode strategy for the recording (vos VideoElement.frameSource):
     * 'webcodecs' (frame-accurate, MP4), 'html5' (robust, any format), 'auto'.
     * Defaults to 'auto' in lowering. Dev uploads use 'html5'; the B2 recorder
     * (known-good MP4) uses 'webcodecs'.
     */
    frameSource?: 'auto' | 'webcodecs' | 'html5'
    /**
     * 'image' = videoKey points at a still (screenshot) shown for the doc's
     * whole duration — the full editing stack (frame, browser bar, zoom, export)
     * applies unchanged. Defaults to 'video'.
     */
    sourceKind?: 'video' | 'image'
    /**
     * drawImage source rect (capture px) for window takes: the viewport's rect
     * inside the captured frame, derived once at doc build (normalizeCaptureSpace)
     * — crops the real browser chrome out of the footage so the synthetic
     * browser bar applies. When set, cursor track + meta dims are already in
     * crop space. Absent = draw the full frame.
     */
    crop?: Rect
    /**
     * The derived viewport crop + the full capture dims it was cut from — kept
     * even while the "Original" frame mode shows the uncropped window, so the
     * crop can be re-applied losslessly (docToCropSpace/docToFullSpace remap
     * cursor/zoom/meta between the two spaces; the footage itself always holds
     * the full frame). Present ⟺ crop derivation succeeded at ingest.
     */
    chromeCrop?: { rect: Rect; frameW: number; frameH: number }
  }
  /**
   * Kept SOURCE-time spans (@vosjs/timeline `Segment`s); the output timeline is
   * their concatenation — trim/split/cut are all segment edits. Canonical form
   * is one full-source segment; an empty list is tolerated and means "untrimmed".
   */
  segments: Segment[]
  /**
   * Speed-change spans (SOURCE time, footage-anchored — see SpeedSpan).
   * Optional for backward compatibility with persisted docs; absent = all 1×.
   */
  speed?: SpeedSpan[]
  /** Zoom regions (SOURCE time, footage-anchored, non-overlapping — see ZoomSpan). */
  zoom: ZoomSpan[]
  /**
   * Camera style — one named strategy preset driving BOTH the auto-zoom
   * planner and the camera motion (ramps/eases/pans/follow; see zoomStyle.ts).
   * Absent = DEFAULT_ZOOM_STYLE.
   */
  zoomStyle?: ZoomStyleName
  /**
   * Per-doc overrides on top of the named style — the "Custom" seam for
   * agents/doc.json (the studio shows Custom while any override is present;
   * picking a named style clears them). Span edits do NOT set this: the style
   * describes camera dynamics, spans are content.
   */
  zoomParams?: Partial<ZoomStyleParams>
  /**
   * Per-doc overrides for the auto-speed planner: idle/typing/scroll
   * thresholds and rates. Absent = DEFAULT_SPEED_PARAMS.
   */
  speedParams?: Partial<SpeedParams>
  /**
   * Tilt regions (SOURCE time, footage-anchored, non-overlapping — see
   * TiltSpan). Optional: absent lowers byte-identically (no tiltTrack in data).
   */
  tilt?: TiltSpan[]
  /**
   * Dynamic-tilt wand intensity (planAutoTilt — the auto-zoom wand contract:
   * regenerate replaces only `source:'auto'` spans). 'off'/absent = the wand
   * is off; manual tilt spans work either way.
   */
  tiltStyle?: TiltStyleName
  /**
   * Deleted planner proposals (SOURCE time, one lane each — see
   * RejectedSpan): a re-plan never proposes a span that lands on one. Absent
   * = nothing rejected; lowers byte-identically (the renderer never reads it).
   */
  rejected?: RejectedSpan[]
  /** music/SFX clips on the output timeline (see AudioClip anchoring note). */
  audio: AudioClip[]
  /**
   * Master gain for the VOICE, 0..1. Absent = 1. With a mic sidecar
   * (source.micKey) this governs the sidecar; on legacy takes it governs the
   * recording's own (mixed) track.
   */
  micGain?: number
  /**
   * Master gain for the recording's own SYSTEM/tab audio track, 0..1. Absent
   * = 1. Only meaningful on split takes (source.micKey present) — legacy
   * takes have one track and one fader (micGain).
   */
  systemGain?: number
  cursor: CursorStyle
  cam: CamStyle
  /**
   * Cam pose regions (SOURCE time, footage-anchored, non-overlapping — see
   * CamPoseSpan). The bubble morphs to a span's pose and back to the rest
   * pose (doc.cam). Optional: absent lowers byte-identically (no camTrack
   * in data). Only renders when the take has a cam track (source.camKey).
   */
  camMotion?: CamPoseSpan[]
  frame: FrameStyle
  /**
   * Card presentation (tilt / entrance) — compositor v2. Optional: absent
   * lowers byte-identically to a pre-v2 doc and renders pixel-identically.
   */
  /**
   * Screen-space overlay clips (text; later image/video) — compositor v2.
   * OUTPUT-anchored spans on the overlay layer. Optional: absent lowers
   * byte-identically to a doc predating overlays.
   */
  overlays?: OverlayClip[]
  /**
   * World-space object clips (interpreter-side; the drafted engine spec).
   * Optional: absent lowers byte-identically.
   */
  objects?: ObjectClip[]
  export: {
    resolution: ExportResolution
    fps: 30 | 60
    format: 'mp4'
  }
}

/** Export quality presets — each names the SHORT edge of the output (see resolveExportSize). */
export type ExportResolution = '720p' | '1080p' | '2k' | '4k'

export const EXPORT_SHORT_EDGE: Record<ExportResolution, number> = {
  '720p': 720,
  '1080p': 1080,
  '2k': 1440,
  '4k': 2160,
}

/** Presets in ascending quality order (picker order; recommendedExportResolution walks it). */
export const EXPORT_RESOLUTION_OPTIONS: ExportResolution[] = [
  '720p',
  '1080p',
  '2k',
  '4k',
]

/**
 * Default ON (ripple + press, medium, neutral): click emphasis is the point of
 * the product, and the wrong-window/coverage gates already drop the cursor
 * track (and with it every click) on takes where effects would misfire.
 */
export const DEFAULT_CLICK_FX: ClickFxStyle = {
  style: 'ripple',
  press: true,
  intensity: 'medium',
  color: 'auto',
}

export const DEFAULT_CURSOR_STYLE: CursorStyle = {
  visible: true,
  smoothing: 0.15,
  size: 24,
  style: 'default',
  hideWhenIdle: true,
  clickFx: DEFAULT_CLICK_FX,
}

export const DEFAULT_CAM_STYLE: CamStyle = {
  visible: true,
  position: 'bottom-left',
  size: 0.25,
  shape: 'circle',
  mirror: true,
}

export const DEFAULT_BROWSER_BAR: BrowserBarStyle = {
  kind: 'none',
  url: '',
  showUrl: true,
  showControls: true,
  height: 44,
}

const BASE_FRAME_STYLE: FrameStyle = {
  // Brand default: signal red → amber (sunset warmth; deliberately not AI-purple).
  background: 'linear-gradient(135deg, #ff5148, #ffb03a)',
  padding: 48,
  radius: 12,
  shadow: 0.4,
  border: 0,
  // 'native' = the recording's own aspect ratio (meta.width/height). See ASPECT_RATIOS.
  aspectRatio: 'native',
  browserBar: DEFAULT_BROWSER_BAR,
}

/**
 * The frame a NEW take opens on. Once `BACKDROP_DEFAULT_ON`
 * flips (backdrop.ts), the default is the house loop on its own ground;
 * until then the brand gradient. Every ingest path spreads this, so the
 * flip reaches the extension handoff, the in-page recorder, a dropped file
 * and `vos record` at once; a doc that already carries a frame keeps it.
 */
export const DEFAULT_FRAME_STYLE: FrameStyle = BACKDROP_DEFAULT_ON
  ? withDefaultBackdrop(BASE_FRAME_STYLE)
  : BASE_FRAME_STYLE

/** Border alpha applied when the Frame-border toggle turns on. */
export const FRAME_BORDER_DEFAULT = 0.35

/**
 * The border a doc that names no width/colour is drawn with: the hairline
 * white stroke that was hard-coded in ON_FRAME before the two knobs existed,
 * so every take made before them renders byte-identically after.
 */
export const FRAME_BORDER_WIDTH_DEFAULT = 1.5
export const FRAME_BORDER_COLOR_DEFAULT = '#ffffff'

/**
 * The realistic browser-bar kind matching the recorder's OS — seeds Default
 * mode so the synthetic chrome looks native to where the take was recorded
 * (light variants: browsers default light). Windows/Linux get the windows
 * chrome; when the platform is unknown — a direct upload with no browser
 * information — we default to macOS.
 */
export function platformBarKind(
  platform: RecordingMeta['platform'],
): BrowserBarStyle['kind'] {
  return platform === 'windows' || platform === 'linux'
    ? 'windows-light'
    : 'mac-light'
}

/**
 * Address-pill display text for a recorded page URL: hostname (www. stripped)
 * plus a non-root path. Empty for non-http(s) or unparsable URLs.
 */
export function pageDisplayUrl(pageUrl: string | undefined): string {
  if (!pageUrl) return ''
  try {
    const u = new URL(pageUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    const host = u.hostname.replace(/^www\./, '')
    return u.pathname && u.pathname !== '/' ? host + u.pathname : host
  } catch {
    return ''
  }
}

/** Output aspect-ratio presets (id used as FrameStyle.aspectRatio). Ordered for the picker. */
export interface AspectRatioOption {
  id: string
  label: string
}

export const ASPECT_RATIOS: AspectRatioOption[] = [
  { id: 'native', label: 'Native' },
  { id: '21:9', label: '21:9' },
  { id: '16:9', label: '16:9' },
  { id: '16:10', label: '16:10' },
  { id: '3:2', label: '3:2' },
  { id: '4:3', label: '4:3' },
  { id: '1:1', label: '1:1' },
  { id: '3:4', label: '3:4' },
  { id: '2:3', label: '2:3' },
  { id: '10:16', label: '10:16' },
  { id: '9:16', label: '9:16' },
]

/** Numeric width/height ratio for an aspect-ratio id; 'native' resolves from the source meta. */
export function aspectRatioValue(
  id: string,
  meta: { width: number; height: number },
): number {
  const nativeRatio = (meta.width || 16) / (meta.height || 9)
  if (!id || id === 'native') return nativeRatio
  const [w, h] = id.split(':').map(Number)
  return w > 0 && h > 0 ? w / h : nativeRatio
}

/**
 * Resolve the export pixel dimensions from the chosen aspect ratio + quality. The quality
 * (`export.resolution`) is the SHORT edge (720/1080/1440/2160), so 16:9 @ 1080p→1920×1080,
 * 9:16 @ 4k→2160×3840, 1:1 @ 1080p→1080×1080. Dimensions are rounded to even numbers
 * (H.264 requires it). Unknown values (hand-edited doc.json) fall back to 1080p.
 */
export function resolveExportSize(
  doc: Pick<ProjectDoc, 'frame' | 'source' | 'export'>,
  resolution: ExportResolution = doc.export.resolution,
): { width: number; height: number } {
  return exportSizeFor(
    aspectRatioValue(doc.frame.aspectRatio, doc.source.meta),
    resolution,
  )
}

/**
 * The quality-preset → pixels math, free of any document. Every product's
 * export UI resolves its dimensions through this one function (the shared
 * ExportDialog included), so a preset name means the same thing everywhere:
 * before it existed the web app carried three private resolution tables that
 * disagreed about what "2K" was.
 */
export function exportSizeFor(
  ratio: number,
  resolution: ExportResolution,
): { width: number; height: number } {
  // Widened index: hand-edited doc.json can carry values outside the union.
  const short =
    (EXPORT_SHORT_EDGE as Record<string, number | undefined>)[resolution] ??
    1080
  const even = (n: number) => {
    const r = Math.round(n)
    return r % 2 ? r + 1 : r
  }
  const safe = ratio > 0 && Number.isFinite(ratio) ? ratio : 16 / 9
  return safe >= 1
    ? { width: even(short * safe), height: even(short) }
    : { width: even(short), height: even(short / safe) }
}
