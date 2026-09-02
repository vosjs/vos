/**
 * Zoom/pan camera styles — named strategy
 * presets covering the whole auto-zoom pipeline: how the planner turns clicks
 * into spans (cluster vs session merging, level clamps, follow default) AND
 * how the lowering animates the camera (ramp durations, eases, connected-pan
 * gap, dead-zone follow tuning). One name → one coherent feel.
 *
 * The presets are grounded in a measured comparison of the four shipping
 * strategies (frame-by-frame optical-flow tracking of real exports + source
 * audits of Recordly/OpenScreen + Cursorful bundle/behavior research):
 *
 *  - Cursorful ("glide"): ONE modest zoom (~1.5×) per activity session —
 *    2+ clicks within a rolling window keep the zoom alive — and the camera
 *    TRAVELS by panning between focus points while zoomed. Measured zoom ramp
 *    fits css-bezier(0.26, 0, 0.16, 1): near-zero initial velocity, soft
 *    landing, zero overshoot. Pan durations scale with distance.
 *  - Screen Studio "Focused" / Recordly ("focus"): a zoom block per click
 *    cluster at ~1.8×, spring-settled ramps (~1.5 s in / ~1 s out), direct
 *    pans across gaps ≤ ~1.35 s, dead-zone cursor follow. The measured
 *    OpenScreen/Recordly ramp (their bezier filtered through the spring) fits
 *    css-bezier(0.28, 0.03, 0.09, 1) — that curve IS the family feel.
 *  - Screen Studio "Smooth" ("cinema"): the same block model, slower and
 *    more fluid — for content that is watched, not read.
 *  - "snappy": the studio's original fast cycles, with the defect fixed — the raw
 *    css-bezier(0.16, 1, 0.3, 1) arrival had an initial velocity 6.25× the
 *    ramp average (the "jump cut" complaint); competitors always filter that
 *    curve through a spring. This preset keeps the pace but caps the onset.
 *  - "cut": Screen Studio's "instant zoom" option — hard cut-in, no glide.
 *
 * Style changes are live SET_DATA (the zoom track is data); regenerating
 * auto spans on a style switch re-plans with the style's planner params while
 * preserving user-touched ('manual') spans, per the wand contract.
 */

import type { TiltStyleName } from './types'

export type ZoomStyleName =
  | 'glide'
  | 'focus'
  | 'cinema'
  | 'snappy'
  | 'cut'
  | 'none'
  | 'keynote'
  | 'drift'

/**
 * The tilt half of a camera style: the Dynamic-tilt
 * intensity the style ships with, plus optional overrides on the tilt track's
 * motion constants. A style pick stamps `doc.tiltStyle` with `intensity` and
 * re-plans auto tilt spans alongside the auto zooms — one name, one coherent
 * camera sentence (zoom AND lean).
 */
export interface TiltPersonality {
  /** Dynamic-tilt intensity this style ships with ('off' = flat card). */
  intensity: TiltStyleName
  /** tilt ramp overrides (seconds); absent = the TILT_RAMP_* constants. */
  rampIn?: number
  rampOut?: number
  /** output-time gap ≤ this → swing pose-to-pose (absent = TILT_CHAIN_GAP). */
  chainGap?: number
  /** connected-swing duration (absent = TILT_PAN). */
  pan?: number
}

export interface ZoomStyleParams {
  // ── planner (planAutoZoom) ───────────────────────────────────────────────
  /** false = the planner emits nothing (the 'none' style — manual zooms only). */
  autoZoom: boolean
  /** clicks within this many seconds merge into one span (session merge). */
  clusterGap: number
  /** minimum clicks for a cluster to earn a zoom (Cursorful's ≥2 rule). */
  minClusterClicks: number
  /** zoom so the clicked element fills ~this fraction of the frame. */
  targetFill: number
  minLevel: number
  maxLevel: number
  /** span lead-in before the first click / hold after the last (seconds). */
  lead: number
  hold: number
  /** planner emits spans with focusMode 'auto' (cursor-follow camera). */
  followByDefault: boolean
  // ── typing (`key` activity pings → typing-session spans) ─────────────
  /** false = typing sessions plan no spans (clicks/dwells still do). */
  typingZoom: boolean
  /** max silence between pings before the typing session ends (seconds). */
  typingGap: number
  /** hold after the last keystroke — the read-what-you-typed beat (seconds). */
  typingHold: number
  /**
   * Level FLOOR for typing spans, above the style's minLevel: a wide field
   * (URL bar, dialog search input) fit-clamps to this instead — typing is the
   * moment being narrated, so it reads a notch punchier than a wide click.
   */
  typingMinLevel: number
  // ── camera (zoomTrackFromDoc) ────────────────────────────────────────────
  /** zoom-in ramp duration; arrival lands rampInOverlap into the span. */
  rampIn: number
  rampInOverlap: number
  rampOut: number
  /** output-time gap ≤ this → pan straight to the next span (no zoom-out). */
  chainGap: number
  /** connected-pan duration. */
  pan: number
  /** arrival ease (zoom-in AND zoom-out). */
  ease: string
  /** connected-pan + follow-recenter ease. */
  panEase: string
  // ── cursor follow (followFocusEvents) ────────────────────────────────────
  /** recenter when the cursor exits this central fraction of the crop. */
  followSafeRatio: number
  /** seconds the camera takes to glide to a recentered focus. */
  followRecenter: number
  /**
   * Recenter targets the cursor this many seconds AHEAD of the exit moment
   * (Cursorful's look-ahead: the camera leads the pointer instead of chasing
   * a stale position). Sampled from the real track — still deterministic.
   */
  followLookahead: number
  // ── tilt (planAutoTilt + tiltTrackFromDoc) ───────────────────────────────
  /** The style's tilt personality — see TiltPersonality. */
  tilt: TiltPersonality
}

export const ZOOM_STYLES: Record<ZoomStyleName, ZoomStyleParams> = {
  // Cursorful strategy — one steady zoom per activity session, travel by pans.
  glide: {
    autoZoom: true,
    clusterGap: 3.0,
    minClusterClicks: 2,
    targetFill: 0.42,
    minLevel: 1.3,
    maxLevel: 1.8,
    lead: 0.5,
    hold: 0.6,
    followByDefault: true,
    typingZoom: true,
    typingGap: 2.5,
    typingHold: 1.1,
    typingMinLevel: 1.4,
    rampIn: 1.1,
    rampInOverlap: 0.35,
    rampOut: 1.0,
    chainGap: 2.5,
    pan: 1.0,
    ease: 'css-bezier(0.26, 0, 0.16, 1)',
    panEase: 'css-bezier(0.3, 0, 0.2, 1)',
    followSafeRatio: 0.45,
    followRecenter: 0.8,
    followLookahead: 0.4,
    tilt: { intensity: 'off' },
  },
  // Screen Studio "Focused" / Recordly — block zooms, spring-settled, readable.
  focus: {
    autoZoom: true,
    clusterGap: 1.2,
    minClusterClicks: 1,
    targetFill: 0.5,
    minLevel: 1.5,
    maxLevel: 2.2,
    lead: 0.35,
    hold: 1.0,
    followByDefault: false,
    typingZoom: true,
    typingGap: 2.0,
    typingHold: 1.2,
    typingMinLevel: 1.6,
    rampIn: 1.4,
    rampInOverlap: 0.5,
    rampOut: 1.0,
    chainGap: 1.35,
    pan: 1.0,
    ease: 'css-bezier(0.28, 0.03, 0.09, 1)',
    panEase: 'css-bezier(0.26, 0.08, 0.2, 1)',
    followSafeRatio: 0.5,
    followRecenter: 0.6,
    followLookahead: 0,
    tilt: { intensity: 'off' },
  },
  // Screen Studio "Smooth" — slower, more fluid; creative content over reading.
  cinema: {
    autoZoom: true,
    clusterGap: 1.8,
    minClusterClicks: 1,
    targetFill: 0.45,
    minLevel: 1.35,
    maxLevel: 2.0,
    lead: 0.6,
    hold: 1.4,
    followByDefault: true,
    typingZoom: true,
    typingGap: 3.0,
    typingHold: 1.6,
    typingMinLevel: 1.45,
    rampIn: 1.8,
    rampInOverlap: 0.55,
    rampOut: 1.5,
    chainGap: 2.2,
    pan: 1.4,
    ease: 'css-bezier(0.33, 0, 0.15, 1)',
    panEase: 'css-bezier(0.33, 0, 0.22, 1)',
    followSafeRatio: 0.6,
    followRecenter: 1.0,
    followLookahead: 0.5,
    tilt: { intensity: 'off' },
  },
  // The studio's original pace with the instant-velocity onset defect fixed.
  snappy: {
    autoZoom: true,
    clusterGap: 1.2,
    minClusterClicks: 1,
    targetFill: 0.5,
    minLevel: 1.4,
    maxLevel: 2.5,
    lead: 0.25,
    hold: 1.0,
    followByDefault: false,
    typingZoom: true,
    typingGap: 1.6,
    typingHold: 0.8,
    typingMinLevel: 1.5,
    rampIn: 0.7,
    rampInOverlap: 0.3,
    rampOut: 0.75,
    chainGap: 1.5,
    pan: 0.8,
    ease: 'css-bezier(0.3, 0.55, 0.2, 1)',
    panEase: 'css-bezier(0.25, 0.1, 0.25, 1)',
    followSafeRatio: 0.5,
    followRecenter: 0.5,
    followLookahead: 0,
    tilt: { intensity: 'off' },
  },
  // Screen Studio's "instant zoom" — a cut-in (2–4 frames), tutorial tempo.
  cut: {
    autoZoom: true,
    clusterGap: 1.2,
    minClusterClicks: 1,
    targetFill: 0.5,
    minLevel: 1.5,
    maxLevel: 2.2,
    lead: 0.2,
    hold: 1.0,
    followByDefault: false,
    typingZoom: true,
    typingGap: 1.2,
    typingHold: 0.6,
    typingMinLevel: 1.6,
    rampIn: 0.14,
    rampInOverlap: 0.07,
    rampOut: 0.14,
    chainGap: 1.2,
    pan: 0.35,
    ease: 'css-bezier(0.2, 0, 0.4, 1)',
    panEase: 'css-bezier(0.2, 0, 0.4, 1)',
    followSafeRatio: 0.5,
    followRecenter: 0.35,
    followLookahead: 0,
    tilt: { intensity: 'off' },
  },
  // Auto-zoom off (every competitor ships this switch). Camera params still
  // apply to MANUAL spans — they get the default (glide) motion.
  none: {
    autoZoom: false,
    clusterGap: 3.0,
    minClusterClicks: 2,
    targetFill: 0.42,
    minLevel: 1.3,
    maxLevel: 1.8,
    lead: 0.5,
    hold: 0.6,
    followByDefault: false,
    typingZoom: true,
    typingGap: 2.5,
    typingHold: 1.1,
    typingMinLevel: 1.4,
    rampIn: 1.1,
    rampInOverlap: 0.35,
    rampOut: 1.0,
    chainGap: 2.5,
    pan: 1.0,
    ease: 'css-bezier(0.26, 0, 0.16, 1)',
    panEase: 'css-bezier(0.3, 0, 0.2, 1)',
    followSafeRatio: 0.45,
    followRecenter: 0.8,
    followLookahead: 0,
    tilt: { intensity: 'off' },
  },
  // ── tilt-forward styles — the camera moves in DEPTH too.
  // Research note (2026-08-03): no competitor ships a document-wide personality
  // driving BOTH auto-zoom dynamics and focus-following tilt from one name —
  // FocuSee's Subtle/Default/Strong 3D Motion is a separate layered effect,
  // TiltIt/ScreenDrift sell per-clip templates. These two own that space.
  //
  // "keynote": the launch-film sentence (the Apple register: rehearsed,
  // restrained, one move per beat) — glide's session-merged, modest zooms plus
  // a MEDIUM lean toward each zoom's focus, tilt ramps MATCHED to the zoom
  // ramps so lean and zoom read as one camera move; chained so back-to-back
  // beats swing pose-to-pose. Never oscillation, ±5..18° band.
  keynote: {
    autoZoom: true,
    clusterGap: 3.0,
    minClusterClicks: 2,
    targetFill: 0.42,
    minLevel: 1.3,
    maxLevel: 1.8,
    lead: 0.5,
    hold: 0.7,
    followByDefault: true,
    typingZoom: true,
    typingGap: 2.5,
    typingHold: 1.2,
    typingMinLevel: 1.4,
    rampIn: 1.2,
    rampInOverlap: 0.35,
    rampOut: 1.1,
    chainGap: 2.5,
    pan: 1.1,
    ease: 'css-bezier(0.26, 0, 0.16, 1)',
    panEase: 'css-bezier(0.3, 0, 0.2, 1)',
    followSafeRatio: 0.45,
    followRecenter: 0.8,
    followLookahead: 0.4,
    // Lean lands WITH the zoom (matched ramps read as one camera move).
    tilt: {
      intensity: 'medium',
      rampIn: 1.2,
      rampOut: 1.1,
      chainGap: 2.5,
      pan: 1.1,
    },
  },
  // "drift": calm ambient depth — cinema's slow, fluid blocks with a SUBTLE
  // lean that eases in over ~1.6s and lingers (long chain gap keeps the card
  // from flattening between nearby beats). For watched-not-read content:
  // launch films, portfolio clips, hero loops.
  drift: {
    autoZoom: true,
    clusterGap: 1.8,
    minClusterClicks: 1,
    targetFill: 0.45,
    minLevel: 1.35,
    maxLevel: 2.0,
    lead: 0.6,
    hold: 1.4,
    followByDefault: true,
    typingZoom: true,
    typingGap: 3.0,
    typingHold: 1.6,
    typingMinLevel: 1.45,
    rampIn: 1.8,
    rampInOverlap: 0.55,
    rampOut: 1.5,
    chainGap: 2.2,
    pan: 1.4,
    ease: 'css-bezier(0.33, 0, 0.15, 1)',
    panEase: 'css-bezier(0.33, 0, 0.22, 1)',
    followSafeRatio: 0.6,
    followRecenter: 1.0,
    followLookahead: 0.5,
    tilt: {
      intensity: 'subtle',
      rampIn: 1.6,
      rampOut: 1.4,
      chainGap: 3.0,
      pan: 1.4,
    },
  },
}

/** The default camera style for new projects (the Cursorful-family strategy). */
export const DEFAULT_ZOOM_STYLE: ZoomStyleName = 'glide'

/**
 * Resolve a style name (+ optional per-doc overrides, `doc.zoomParams`) into a
 * full parameter bundle. Overrides are the "Custom" seam: agents/doc.json can
 * tune individual params on top of a named preset; the studio shows Custom
 * while any override is present. Unknown names from hand-edited doc.json fall
 * back to the default style.
 */
export function resolveZoomStyle(
  name?: ZoomStyleName,
  overrides?: Partial<ZoomStyleParams>,
): ZoomStyleParams {
  const params: ZoomStyleParams | undefined = name
    ? ZOOM_STYLES[name]
    : undefined
  return { ...(params ?? ZOOM_STYLES[DEFAULT_ZOOM_STYLE]), ...overrides }
}

/** Picker order + copy for the studio's Camera style control. */
export const ZOOM_STYLE_OPTIONS: {
  name: ZoomStyleName
  label: string
  hint: string
}[] = [
  {
    name: 'glide',
    label: 'Glide',
    hint: 'One steady zoom that travels between clicks',
  },
  {
    name: 'keynote',
    label: 'Keynote',
    hint: 'Gliding zooms that lean toward each focus',
  },
  {
    name: 'drift',
    label: 'Drift',
    hint: 'Slow, fluid moves with a subtle ambient lean',
  },
  {
    name: 'focus',
    label: 'Focus',
    hint: 'A zoom per click cluster, settles fast',
  },
  { name: 'cinema', label: 'Cinema', hint: 'Slow, fluid camera moves' },
  { name: 'snappy', label: 'Snappy', hint: 'Quick, energetic zoom cycles' },
  { name: 'cut', label: 'Cut', hint: 'Instant zooms, no glide' },
  {
    name: 'none',
    label: 'None',
    hint: 'No automatic zooms, add your own on the timeline',
  },
]
