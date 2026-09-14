/**
 * Zoom/pan camera styles — named strategy
 * presets covering the whole auto-zoom pipeline: how the planner turns clicks
 * into spans (cluster vs session merging, level clamps, follow default) AND
 * how the lowering animates the camera (ramp durations, eases, connected-pan
 * gap, dead-zone follow tuning, and the tilt track's tempo). One name → one
 * coherent feel.
 *
 * The presets were grounded (2026-07) in a measured comparison of the four
 * shipping strategies (frame-by-frame optical-flow tracking of real exports +
 * source audits of Recordly/OpenScreen + Cursorful bundle/behavior research),
 * and re-founded (2026-09) on the stage camera at 60 fps, where every style
 * is timed against the default's traced arrival and obeys two structural
 * rules (see `pumpFreeChainGap` and the lowering's ramp fitting):
 *
 *  - Cursorful ("glide"): ONE modest zoom (~1.5×) per activity session —
 *    clicks within a rolling window keep the zoom alive — and the camera
 *    TRAVELS by panning between focus points while zoomed. Its arrival was
 *    traced at 60 fps and fitted by sum of differences (see the entry).
 *  - Screen Studio "Focused" / Recordly ("focus"): a zoom block per click
 *    cluster, spring-settled ramps, direct pans across short gaps, no cursor
 *    follow. The measured OpenScreen/Recordly ramp (their bezier filtered
 *    through the spring) fits css-bezier(0.28, 0.03, 0.09, 1) — that curve IS
 *    the family feel; it now runs at the default's tempo instead of 1.4 s.
 *  - Screen Studio "Smooth" ("cinema"): the long-HOLD style, slower and more
 *    fluid — for content that is watched, not read.
 *  - "snappy": the studio's original fast cycles, with the defect fixed — the
 *    raw css-bezier(0.16, 1, 0.3, 1) arrival had an initial velocity 6.25×
 *    the ramp average (the "jump cut" complaint); competitors always filter
 *    that curve through a spring. This preset keeps the pace but caps the
 *    onset.
 *  - "cut": Screen Studio's "instant zoom" option — hard cut-in, no glide.
 *
 * `keynote` and `drift` (2026-08) were another row plus a tilt intensity the
 * panel already exposes as its own control; they are retired names that
 * resolve to `glide` + medium and `cinema` + subtle (RETIRED_ZOOM_STYLES;
 * migrated on read by docVersion). What they had right survives in every
 * style: the tilt track moves at the style's own zoom tempo, so a chosen
 * lean lands WITH its zoom.
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

/**
 * Retired style names and what they meant: a live style plus the tilt
 * intensity the name carried. `resolveZoomStyle` honours the name at runtime
 * (a hand-edited doc.json never falls silently to the default) and
 * `migrateHostedDoc` rewrites a stored document onto the pair.
 */
export const RETIRED_ZOOM_STYLES: Record<
  string,
  { style: ZoomStyleName; tilt: TiltStyleName }
> = {
  keynote: { style: 'glide', tilt: 'medium' },
  drift: { style: 'cinema', tilt: 'subtle' },
}

/** The live style a name resolves to, retired names included; null = unknown. */
export function liveZoomStyleName(
  name: string | undefined,
): ZoomStyleName | null {
  if (!name) return null
  if (name in ZOOM_STYLES) return name as ZoomStyleName
  return RETIRED_ZOOM_STYLES[name]?.style ?? null
}

/**
 * The tilt half of a camera style: the Dynamic-tilt intensity the style
 * ships with (every live style ships 'off' — intensity is the Dynamic tilt
 * dial's, never a name's) plus the tilt track's motion, which is the
 * style's OWN zoom tempo so a lean lands with its zoom. A style pick stamps
 * `doc.tiltStyle` with `intensity` and re-plans auto tilt spans alongside
 * the auto zooms — one name, one coherent camera sentence (zoom AND lean).
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
  /**
   * Minimum clicks for a cluster to earn a zoom. Every style is 1: the
   * Cursorful ≥2 rule glide once carried was never in effect on a recorded
   * take (the recorder counted each press twice, so a lone click was a pair
   * on most pages and a stray on the rest), and the lone click on a button
   * is the zoom people miss when it goes.
   */
  minClusterClicks: number
  /** zoom so the clicked element fills ~this fraction of the frame. */
  targetFill: number
  minLevel: number
  maxLevel: number
  /**
   * The level a DRAG is followed at (a press that travels before its
   * release: a slider thumb, a scrubber, a thing moved across a canvas).
   * The camera pans WITH the pointer for the whole press (a path follow,
   * not a dead zone), so the level stays mild: the thumb and what it drives
   * both stay in the window. By rule minLevel + 0.2.
   */
  dragLevel: number
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
   * By rule minLevel + 0.1.
   */
  typingMinLevel: number
  // ── camera (zoomTrackFromDoc) ────────────────────────────────────────────
  /** zoom-in ramp duration; arrival lands rampInOverlap into the span. */
  rampIn: number
  rampInOverlap: number
  rampOut: number
  /**
   * output-time gap ≤ this → pan straight to the next span (no zoom-out).
   * Never below `pumpFreeChainGap`: a gap just past it would zoom out and
   * straight back in (the pump), which is arithmetic, not taste.
   */
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

/**
 * The shortest rest between a zoom-out and the next zoom-in that reads as
 * a rest rather than a pump (seconds).
 */
export const PUMP_REST = 1.0

/**
 * The chain gap below which a style PUMPS: two spans whose gap lies in
 * (chainGap, chainGap + rampOut + rampIn − overlap + PUMP_REST] zoom out and
 * straight back in with no rest between. Every ZOOM_STYLES entry clears
 * this floor by construction (a test pins it) and `resolveZoomStyle`
 * raises a `zoomParams` override that does not.
 */
export function pumpFreeChainGap(
  p: Pick<ZoomStyleParams, 'rampIn' | 'rampInOverlap' | 'rampOut'>,
): number {
  return p.rampOut + (p.rampIn - p.rampInOverlap) + PUMP_REST
}

// Cursorful strategy — one steady zoom per activity session, travel by pans.
// The camera's timing was measured against a Cursorful take of the same
// steps: a zoom-in of ~0.55 s on a heavy ease-out (most of the move in
// the first quarter second, a long settle), a zoom-out of ~0.45 s, and
// holds of four to five seconds per beat. The old 1.1 s ramp started
// 0.75 s BEFORE the click and landed 0.35 s after it, so the frame was
// moving more of the time than it was resting.
const glide: ZoomStyleParams = {
  autoZoom: true,
  clusterGap: 3.0,
  minClusterClicks: 1,
  targetFill: 0.42,
  minLevel: 1.3,
  maxLevel: 1.8,
  dragLevel: 1.5,
  lead: 0.35,
  hold: 1.2,
  followByDefault: true,
  typingZoom: true,
  typingGap: 2.5,
  typingHold: 1.1,
  typingMinLevel: 1.4,
  rampIn: 0.6,
  rampInOverlap: 0.2,
  rampOut: 0.5,
  chainGap: 3.0,
  pan: 0.55,
  // The reference's corner trace at 60 fps: a quarter of the move by a
  // fifth of the time, two thirds by half, nine tenths by three
  // quarters, over ~0.6 s. Fitted against those three points,
  // (0.36, 0, 0.4, 1) is the closest cubic (15 / 64 / 93 %; half the
  // move at ~245 ms and 90 % at ~425 ms at 0.6 s): a gentle start and a
  // long settle. CSS ease (0.25, 0.1, 0.25, 1) reached the midpoint
  // 70 ms earlier and read a touch fast; (0.16, 1, 0.3, 1) put half the
  // move in the first sixty milliseconds and read as a twitch.
  ease: 'css-bezier(0.36, 0, 0.4, 1)',
  panEase: 'css-bezier(0.36, 0, 0.4, 1)',
  followSafeRatio: 0.45,
  followRecenter: 0.55,
  followLookahead: 0.4,
  tilt: {
    intensity: 'off',
    rampIn: 0.6,
    rampOut: 0.5,
    chainGap: 3.0,
    pan: 0.55,
  },
}

export const ZOOM_STYLES: Record<ZoomStyleName, ZoomStyleParams> = {
  glide,
  // Screen Studio "Focused" / Recordly — a block per click, framed and
  // released, no travel. The spring-settled family ease (near-linear onset,
  // long settle) at the default's tempo: 0.8 s in, 0.65 s out, and a beat
  // of 1.5 s after the click so the block is read before it goes. At its
  // 2026-07 timing (1.4 s in, 1.0 s out around a 1.35 s span) a lone click
  // spent 74% of its beat moving and every dwell or sped-up click was
  // shorter than the ramp, which the lowering compressed into a cut.
  focus: {
    autoZoom: true,
    clusterGap: 1.5,
    minClusterClicks: 1,
    targetFill: 0.5,
    minLevel: 1.4,
    maxLevel: 2.0,
    dragLevel: 1.6,
    lead: 0.35,
    hold: 1.5,
    followByDefault: false,
    typingZoom: true,
    typingGap: 2.0,
    typingHold: 1.3,
    typingMinLevel: 1.5,
    rampIn: 0.8,
    rampInOverlap: 0.25,
    rampOut: 0.65,
    chainGap: 2.4,
    pan: 0.7,
    ease: 'css-bezier(0.28, 0.03, 0.09, 1)',
    panEase: 'css-bezier(0.26, 0.08, 0.2, 1)',
    followSafeRatio: 0.5,
    followRecenter: 0.55,
    followLookahead: 0,
    tilt: {
      intensity: 'off',
      rampIn: 0.8,
      rampOut: 0.65,
      chainGap: 2.4,
      pan: 0.7,
    },
  },
  // Screen Studio "Smooth" — the long-HOLD style: 1.2 s in, 1.0 s out,
  // two-second holds, chains across 3.5 s so a slow clip travels rather
  // than pumps, and the default's level range, because a watched clip
  // wants the frame, not the magnifier. Its ramps still exceed a dwell or
  // a sped-up click; the lowering fits them to the room.
  cinema: {
    autoZoom: true,
    clusterGap: 2.4,
    minClusterClicks: 1,
    targetFill: 0.42,
    minLevel: 1.3,
    maxLevel: 1.8,
    dragLevel: 1.5,
    lead: 0.6,
    hold: 2.0,
    followByDefault: true,
    typingZoom: true,
    typingGap: 3.0,
    typingHold: 1.8,
    typingMinLevel: 1.4,
    rampIn: 1.2,
    rampInOverlap: 0.4,
    rampOut: 1.0,
    chainGap: 3.5,
    pan: 1.1,
    ease: 'css-bezier(0.33, 0, 0.15, 1)',
    panEase: 'css-bezier(0.33, 0, 0.22, 1)',
    followSafeRatio: 0.6,
    followRecenter: 0.9,
    followLookahead: 0.5,
    tilt: {
      intensity: 'off',
      rampIn: 1.2,
      rampOut: 1.0,
      chainGap: 3.5,
      pan: 1.1,
    },
  },
  // The studio's original pace with the instant-velocity onset defect fixed:
  // 0.4 s cycles on the onset-capped ease, the 2.5× ceiling of the 2026-07
  // comparison's defect two brought to 2.2, a chain gap past its pump band.
  snappy: {
    autoZoom: true,
    clusterGap: 1.2,
    minClusterClicks: 1,
    targetFill: 0.5,
    minLevel: 1.4,
    maxLevel: 2.2,
    dragLevel: 1.6,
    lead: 0.25,
    hold: 1.2,
    followByDefault: false,
    typingZoom: true,
    typingGap: 1.6,
    typingHold: 0.9,
    typingMinLevel: 1.5,
    rampIn: 0.4,
    rampInOverlap: 0.15,
    rampOut: 0.4,
    chainGap: 2.0,
    pan: 0.5,
    ease: 'css-bezier(0.3, 0.55, 0.2, 1)',
    panEase: 'css-bezier(0.25, 0.1, 0.25, 1)',
    followSafeRatio: 0.5,
    followRecenter: 0.45,
    followLookahead: 0,
    tilt: {
      intensity: 'off',
      rampIn: 0.4,
      rampOut: 0.4,
      chainGap: 2.0,
      pan: 0.5,
    },
  },
  // Screen Studio's "instant zoom" — a cut-in (eight frames at 60 fps),
  // tutorial tempo. Untouched in motion (the one style that never pumped
  // and never left a ramp unsettled); the ceiling comes down with the
  // others and the hold gains the beat a cut-in needs to be read.
  cut: {
    autoZoom: true,
    clusterGap: 1.2,
    minClusterClicks: 1,
    targetFill: 0.5,
    minLevel: 1.4,
    maxLevel: 2.0,
    dragLevel: 1.6,
    lead: 0.2,
    hold: 1.2,
    followByDefault: false,
    typingZoom: true,
    typingGap: 1.2,
    typingHold: 0.6,
    typingMinLevel: 1.5,
    rampIn: 0.14,
    rampInOverlap: 0.07,
    rampOut: 0.14,
    chainGap: 1.3,
    pan: 0.35,
    ease: 'css-bezier(0.2, 0, 0.4, 1)',
    panEase: 'css-bezier(0.2, 0, 0.4, 1)',
    followSafeRatio: 0.5,
    followRecenter: 0.35,
    followLookahead: 0,
    tilt: {
      intensity: 'off',
      rampIn: 0.3,
      rampOut: 0.3,
      chainGap: 1.3,
      pan: 0.35,
    },
  },
  // Auto-zoom off (every competitor ships this switch). Camera params still
  // apply to MANUAL spans — they move the way the default camera moves
  // TODAY (spelled as a spread, never a copy that fossilises).
  none: { ...glide, autoZoom: false },
}

/** The default camera style for new projects (the Cursorful-family strategy). */
export const DEFAULT_ZOOM_STYLE: ZoomStyleName = 'glide'

/**
 * Resolve a style name (+ optional per-doc overrides, `doc.zoomParams`) into a
 * full parameter bundle. Overrides are the "Custom" seam: agents/doc.json can
 * tune individual params on top of a named preset; the studio shows Custom
 * while any override is present. A retired name resolves to its live style;
 * an unknown name from a hand-edited doc.json falls back to the default.
 * The chain gap never rests below its pump-free floor, whatever an override
 * asked for.
 */
export function resolveZoomStyle(
  name?: string,
  overrides?: Partial<ZoomStyleParams>,
): ZoomStyleParams {
  const live = liveZoomStyleName(name) ?? DEFAULT_ZOOM_STYLE
  const params = { ...ZOOM_STYLES[live], ...overrides }
  const floor = pumpFreeChainGap(params)
  if (params.chainGap < floor) params.chainGap = floor
  return params
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
    name: 'focus',
    label: 'Focus',
    hint: 'A zoom per click, framed and released',
  },
  {
    name: 'cinema',
    label: 'Cinema',
    hint: 'Slow moves and long holds, for content that is watched',
  },
  { name: 'snappy', label: 'Snappy', hint: 'Quick, energetic zoom cycles' },
  { name: 'cut', label: 'Cut', hint: 'Instant zooms, no glide' },
  {
    name: 'none',
    label: 'None',
    hint: 'No automatic zooms, add your own on the timeline',
  },
]
