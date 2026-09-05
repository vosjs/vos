/**
 * lowerToComposition — the IR bridge.
 *
 * Turns the app-level `ProjectDoc` into a vos `VosConfigJson` (+ a `data` value).
 * The editor's "opinion" lowers into vos core's function-string IR; vos core never
 * sees `ProjectDoc`.
 *
 * The studio's output is 2D compositing (gradient background, the video inset with
 * padding + rounded corners + shadow, zoom/pan, a cursor on top). Compositor v2
 * draws it as a **three-layer mesh stack** under one perspective camera —
 * a background quad (CSS fill + vos loop), the CARD (its own 2D canvas, on a
 * plane that can tilt), and an overlay quad (cam bubble + future overlays). Each
 * layer is a 2D canvas that `onFrame` paints from `ctx.data` (deterministic — a
 * pure function of ctx.time); at tilt = 0 the card fills the frustum and renders
 * pixel-identically to the pre-v2 fullscreen quad. See stage.ts for the geometry.
 *
 * THE INTERPRETER PATTERN: all four
 * function strings are module-level CONSTANTS — the program is a fixed
 * interpreter and the entire editable state travels in `ctx.data`. The compiled
 * program string is therefore a structural hash: every edit is a live SET_DATA
 * (T2), a trim is SET_DATA + SET_DURATION (T2.5, via the `vosCarrier` opt-in),
 * and the program only changes when this module changes. Even `duration` is
 * data: the config bakes a placeholder and the carrier timeline reads
 * `ctx.data.duration` (delivered with LOAD / deps.data).
 *
 * Time model: `t` (ctx.time) is OUTPUT-timeline seconds; the source moment on
 * screen is `srcT = mapTime(segments, t)` (@vosjs/timeline, inlined into the
 * program via `timelineRuntimeCode` so host and sandbox evaluate identically).
 * Cursor samples stay SOURCE-anchored and are read at `srcT`; zoom spans are
 * source-anchored in the doc and expanded to an OUTPUT-time keyframe track here
 * (ramps must run in output time so they never straddle a cut).
 *
 * NOTE: uses an HTMLVideoElement for the source (robust, any format). Frame-accurate
 * WebCodecs export is a later layer; this nails the *look* + makes every control work.
 */
import {
  EASINGS,
  lerpArray,
  sample,
  segmentRate,
  sortKeyframes,
  sourceToTimeline,
  splitBySpeed,
  totalDuration,
} from '@vosjs/timeline'
import { timelineRuntimeCode } from '@vosjs/timeline/bundle'
import { camBubbleRect, clampFocus, docCardLayout } from '../layout'
import { smoothCursor } from '../planner/smoothing'
import {
  BACKGROUND_Z,
  CAMERA_FAR,
  CAMERA_NEAR,
  CARD_FOV,
  CARD_Z,
  OVERLAY_Z,
} from '../stage'
import {
  OVERLAY_FONT_FACES,
  overlayFaceFor,
  overlayFontFaces,
  overlayLines,
  resolveOverlayBox,
  resolveOverlayFx,
  resolveOverlayStyle,
} from '../overlayText'
import { resolveText3dAsset } from '../text3d'
import {
  CLICK_FX_INTENSITY,
  CARD_EDGE_OVERDRAW,
  FRAME_BORDER_COLOR_DEFAULT,
  FRAME_BORDER_WIDTH_DEFAULT,
  MOTION_EASE,
  OBJECT_DEFAULT_SCALE,
  OVERLAY_LINE_HEIGHT,
  OVERLAY_MEDIA_DEFAULT_RADIUS,
  OVERLAY_MEDIA_DEFAULT_WIDTH,
  OVERLAY_MIN_DURATION,
  clampCamSize,
  clampTiltDeg,
  clampZoomLevel,
  clipLength,
  transitionMult,
} from '../types'
import { DEFAULT_ZOOM_STYLE, ZOOM_STYLES, resolveZoomStyle } from '../zoomStyle'
import { isRecordingDoc, programDuration } from '../doc/studioDoc'
import { clipEnvelope } from './audioEnvelope'
import { followFocusEvents } from './cursorFollow'
import { cursorIdleFade } from './cursorIdle'
import { STUDIO_ENTRY_ID, studioEntry } from './studioEntry'
import {
  cardPoseTrack,
  entranceTiltKeyframes,
  entranceZoomKeyframes,
  expandEndCard,
  prependEntrance,
  withHolds,
} from './motion'
import {
  CLICK_FX_PRE,
  CLICK_HIGHLIGHT_FADE,
  CLICK_PULSE_DUR,
  CLICK_RIPPLE_DUR,
  extractClicks,
  hexToRgbTriplet,
} from './extractClicks'
import type { StudioDoc } from '../doc/studioDoc'
import type { TimelineEdit } from '@vosjs/shared/timelineEdits'
import type { Keyframe, KeyframeTrack, Segment } from '@vosjs/timeline'
import type { ZoomStyleParams } from '../zoomStyle'
import type { CamBubbleRect } from '../layout'
import type { FollowEvent } from './cursorFollow'
import type {
  AudioClip,
  CamPoseSpan,
  CamStyle,
  ObjectClip,
  OverlayClip,
  ProjectDoc,
  TiltSpan,
  ZoomSpan,
} from '../types'

export interface LoweredComposition {
  /** The composed config: the anchor's program plus the studio stack entry. */
  config: Record<string, unknown>
  /** The MAIN program's ctx.data. */
  data: Record<string, unknown>
  /** Each stack entry's own ctx.data, by entry id (`deps.stack` / `SET_DATA { target }`). */
  stack: Record<string, Record<string, unknown>>
  /**
   * A program anchor's tween-timing overlay: delivered to the player
   * LIVE (`SET_TWEEN_EDITS`, bridge protocol 8) so a retime never changes
   * the program string. Absent on a recording, and on a stored (baked)
   * program config.
   */
  tweenEdits?: readonly TimelineEdit[]
  /** Output duration in seconds (drives the carrier + SET_DURATION). */
  duration: number
}

/**
 * Zoom transition shape — deterministic pure keyframes evaluated by TL.sample
 * (no stateful springs, seek stays a pure function of t). The zoom-in ramp
 * starts BEFORE the span and lands rampInOverlap into it (the camera arrives
 * just after the moment it frames); the zoom-out starts at the span's end.
 * All timing/ease constants come from the doc's zoom STYLE (zoomStyle.ts —
 * named strategy presets grounded in the measured competitor comparison).
 * Eases are `css-bezier(…)` curves
 * (@vosjs/timeline >=0.4.0 — parsed identically by host + runtime bundle).
 *
 * Legacy constant names = the DEFAULT style's values, kept for scripts/tests
 * that reason about "the default ramp" symbolically.
 */
export const ZOOM_RAMP_IN = ZOOM_STYLES[DEFAULT_ZOOM_STYLE].rampIn
export const ZOOM_RAMP_IN_OVERLAP =
  ZOOM_STYLES[DEFAULT_ZOOM_STYLE].rampInOverlap
export const ZOOM_RAMP_OUT = ZOOM_STYLES[DEFAULT_ZOOM_STYLE].rampOut
/** Output-time gap ≤ this → pan straight to the next span (no zoom-out). */
export const ZOOM_CHAIN_GAP = ZOOM_STYLES[DEFAULT_ZOOM_STYLE].chainGap
/** Connected-zoom pan duration (compressed into short gaps). */
export const ZOOM_PAN = ZOOM_STYLES[DEFAULT_ZOOM_STYLE].pan
export const ZOOM_EASE = ZOOM_STYLES[DEFAULT_ZOOM_STYLE].ease
export const ZOOM_PAN_EASE = ZOOM_STYLES[DEFAULT_ZOOM_STYLE].panEase

/**
 * Tilt transition shape (tilt spans). Fixed constants, deliberately NOT the
 * zoom style's (switching
 * "Camera style" must not silently change tilt feel; a tiltParams override
 * layer can arrive later if real use demands it). The eases are the same
 * measured css-bezier family the default zoom style uses. Unlike zoom, the
 * pose is SETTLED at span.in (the ramp starts TILT_RAMP_IN before, with no
 * overlap-into-span): tilt frames a moment, it doesn't chase content.
 */
export const TILT_RAMP_IN = 0.9
export const TILT_RAMP_OUT = 0.8
/** Output-time gap ≤ this → swing straight to the next pose (no flatten between). */
export const TILT_CHAIN_GAP = 1.35
/** Connected-tilt swing duration (compressed into short gaps). */
export const TILT_PAN = 0.9
export const TILT_EASE = ZOOM_EASE
export const TILT_PAN_EASE = ZOOM_PAN_EASE

/**
 * Cam-move transition shape (animated cam layouts). Own constants,
 * deliberately NOT the zoom style's or tilt's (switching another
 * subsystem's personality must never silently change the bubble's feel). The
 * premium band for an in-video layout morph is 0.6–1.0s (Descript's Smart
 * Transition defaults to 0.8s); the bubble is small chrome, so it sits at the
 * fast end. Like tilt, the pose is SETTLED at span.in (the ramp starts before,
 * no overlap-into-span): a cam move frames what follows.
 */
export const CAM_RAMP_IN = 0.65
export const CAM_RAMP_OUT = 0.65
/** Output-time gap ≤ this → morph straight to the next pose (no return to rest). */
export const CAM_CHAIN_GAP = 1.2
/** Connected-move morph duration (compressed into short gaps). */
export const CAM_PAN = 0.7
export const CAM_EASE = ZOOM_EASE
export const CAM_PAN_EASE = ZOOM_PAN_EASE

/**
 * The config `duration` placeholder. The REAL duration lives in `ctx.data`
 * (the carrier timeline reads it), so trims never change the program string.
 */
const PROGRAM_DURATION = 1

/**
 * The doc's kept spans with speed spans applied — the OUTPUT-time truth every
 * downstream consumer evaluates (mapTime in ON_FRAME, duration, zoom remap,
 * the export's audio splice). An empty segment list means "untrimmed", so
 * speed spans still apply over one synthesized full-source segment.
 */
export function ratedSegments(doc: StudioDoc): Segment[] {
  // A program is ONE source span, its own length: its speed spans
  // rate it exactly as a recording's rate the footage.
  const segs = isRecordingDoc(doc)
    ? doc.segments.length
      ? doc.segments
      : [{ in: 0, out: doc.source.meta.durationMs / 1000 }]
    : [{ in: 0, out: programDuration(doc) }]
  // A held segment freezes on its last frame for its hold seconds; the
  // freeze is a rated piece, so every reader of this list inherits it.
  return withHolds(segs, splitBySpeed(segs, doc.speed ?? []))
}

function durationSec(doc: ProjectDoc, rated: Segment[]): number {
  const trimmed = totalDuration(rated)
  return trimmed > 0 ? trimmed : doc.source.meta.durationMs / 1000
}

/**
 * Map a SOURCE-time span onto the output timeline through the RATED segment
 * list: the output extent of its KEPT footage (a partially-cut span snaps its
 * edges into kept footage; a fully-cut span returns null — it follows its
 * footage, like every source-anchored feature). Rate-aware: output positions
 * accumulate each piece's (out − in) / rate.
 */
export function spanOutputExtent(
  segments: Segment[],
  sIn: number,
  sOut: number,
): { start: number; end: number } | null {
  let acc = 0
  let start: number | null = null
  let end: number | null = null
  for (const p of segments) {
    const rate = segmentRate(p)
    const len = Math.max(0, p.out - p.in) / rate
    const ovIn = Math.max(sIn, p.in)
    const ovOut = Math.min(sOut, p.out)
    if (ovOut > ovIn) {
      if (start === null) start = acc + (ovIn - p.in) / rate
      end = acc + (ovOut - p.in) / rate
    }
    acc += len
  }
  return start !== null && end !== null && end > start ? { start, end } : null
}

/** A span's arrival ease, validated against the shared ease set. */
function spanEase(
  ease: string | undefined,
  fallback: string,
): NonNullable<Keyframe['ease']> {
  return (ease && ease in EASINGS ? ease : fallback) as NonNullable<
    Keyframe['ease']
  >
}

/**
 * Monotonic keyframe emitter shared by every span→track expansion (zoom,
 * tilt): clamps into strictly-increasing time, skips exact no-op repeats,
 * nudges 1ms on time collisions. Extracted so the tracks can never drift on
 * these rules — zoom's emitted keyframes are byte-identical to the previous
 * in-closure version (verify-zoom-spans pins it).
 */
function trackEmitter(): {
  keyframes: Keyframe<number[]>[]
  push: (
    t: number,
    value: number[],
    ease: NonNullable<Keyframe['ease']>,
  ) => number
} {
  const keyframes: Keyframe<number[]>[] = []
  const push = (
    t: number,
    value: number[],
    ease: NonNullable<Keyframe['ease']>,
  ): number => {
    const prev = keyframes.at(-1)
    let tt = Math.max(0, t)
    if (prev) {
      if (tt <= prev.t + 1e-6 && sameVec(prev.value, value)) return prev.t
      if (tt <= prev.t + 1e-6) tt = prev.t + 0.001
    }
    keyframes.push({ t: round(tt), value: value.map(round), ease })
    return tt
  }
  return { keyframes, push }
}

/**
 * Expand the doc's source-anchored zoom spans into a standard @vosjs/timeline
 * keyframe track in OUTPUT time (values are [level, cx, cy] vectors):
 *
 *   rest ──ramp-in──▶ [level,cx,cy] ──hold──▶ span end ──ramp-out──▶ rest
 *
 * with one twist: when the output gap to the NEXT span is ≤ ZOOM_CHAIN_GAP,
 * the camera never returns to rest — it pans straight to the next span's
 * state over ZOOM_PAN and holds it through the gap (OpenScreen's connected
 * zooms: the camera glides from focus to focus). Transitions run in output
 * time, so they never straddle a cut; keyframe times are strictly increasing
 * (dense spans compress rather than reorder).
 */
/** A span enriched by the lowering with baked cursor-follow recenters. */
export interface LoweredZoomSpan extends ZoomSpan {
  followEvents?: FollowEvent[]
}

export function zoomTrackFromDoc(
  zoom: LoweredZoomSpan[],
  segments: Segment[],
  style: ZoomStyleParams = ZOOM_STYLES[DEFAULT_ZOOM_STYLE],
): KeyframeTrack<number[]> {
  const panEase = style.panEase as NonNullable<Keyframe['ease']>
  const mapped = [...zoom]
    .sort((a, b) => a.in - b.in)
    .flatMap((z) => {
      const ext = spanOutputExtent(segments, z.in, z.out)
      return ext ? [{ z, tIn: ext.start, tOut: ext.end }] : []
    })

  // Monotonic emit: clamp into strictly-increasing time (skip exact no-ops).
  const { keyframes, push } = trackEmitter()

  let chained = false
  for (let i = 0; i < mapped.length; i++) {
    const { z, tIn, tOut } = mapped[i]
    const entry = [clampZoomLevel(z.level), z.cx, z.cy]
    // The camera's current state within the span — advanced by follow recenters.
    let cur = entry
    // Per-span transition speed: a multiplier on the style's ramps.
    // ×1 (absent/'smooth') is float-exact, so legacy tracks stay byte-identical.
    const m = transitionMult(z.transition)

    if (!chained) {
      // Rest until the ramp starts; scale in place around this span's focus
      // (level 1 renders identically for any focus, so the rest focus is free).
      const start = push(
        tIn - (style.rampIn - style.rampInOverlap) * m,
        [1, z.cx, z.cy],
        'none',
      )
      push(start + style.rampIn * m, entry, spanEase(z.ease, style.ease))
    }

    // Cursor-follow recenters (focusMode 'auto', baked by the lowering): hold
    // at the current focus, glide to the recentered one over the style's
    // recenter duration.
    for (const e of z.followEvents ?? []) {
      const eOut = sourceToTimeline(segments, e.t)
      if (eOut === null || eOut <= tIn || eOut >= tOut) continue
      const next = [cur[0], e.cx, e.cy]
      push(eOut, cur, 'none')
      push(Math.min(eOut + style.followRecenter, tOut), next, panEase)
      cur = next
    }

    // Pin the hold to the span's end — the exit transition starts here.
    push(tOut, cur, 'none')

    const next = mapped.at(i + 1)
    if (next && next.tIn - tOut <= style.chainGap) {
      // Connected zooms: pan straight to the next state. Adjacent spans still
      // get a real pan by letting it land up to rampInOverlap into the next.
      // The pan is the NEXT span's arrival, so its transition speed governs.
      const mNext = transitionMult(next.z.transition)
      const nextValue = [clampZoomLevel(next.z.level), next.z.cx, next.z.cy]
      push(
        Math.min(
          tOut + style.pan * mNext,
          next.tIn + style.rampInOverlap * mNext,
        ),
        nextValue,
        panEase,
      )
      chained = true
    } else {
      // Focus FREEZES for the zoom-out (Recordly's rule): the camera pulls
      // back from wherever the follow left it, no parting pan.
      push(
        tOut + style.rampOut * m,
        [1, cur[1], cur[2]],
        spanEase(z.ease, style.ease),
      )
      chained = false
    }
  }
  return { keyframes: sortKeyframes(keyframes) }
}

function sameVec(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6)
}

/**
 * Expand the doc's source-anchored tilt spans into an OUTPUT-time keyframe
 * track of [rx, ry] DEGREES (ON_FRAME converts to radians at the mesh):
 *
 *   flat ──ramp-in──▶ [rx,ry] ──hold──▶ span end ──ramp-out──▶ flat
 *
 * Rest is FLAT: there is no static card pose to return to (decided
 * 2026-08-03 — a lean is a moment on the timeline), which makes this the
 * exact analog of zoom's level-1 rest. Deliberate
 * differences from zoomTrackFromDoc: the pose is SETTLED at
 * span.in (ramp starts TILT_RAMP_IN before, no overlap-into-span), there are
 * no follow events, and ramps are fixed constants rather than the zoom
 * style's. Spans ≤ TILT_CHAIN_GAP apart in output time swing pose-to-pose
 * without flattening between (the connected-zoom rule). Transitions run in
 * output time so they never straddle a cut; keyframe times are strictly
 * increasing (dense spans compress rather than reorder).
 */
export function tiltTrackFromDoc(
  tilt: TiltSpan[],
  segments: Segment[],
  // Motion overrides from the camera style's tilt personality —
  // absent fields fall back to the TILT_* constants, so a bare call keeps
  // the house motion and a style like 'drift' can slow its leans down.
  motion: {
    rampIn?: number
    rampOut?: number
    chainGap?: number
    pan?: number
  } = {},
): KeyframeTrack<number[]> {
  const rampInDur = motion.rampIn ?? TILT_RAMP_IN
  const rampOutDur = motion.rampOut ?? TILT_RAMP_OUT
  const chainGap = motion.chainGap ?? TILT_CHAIN_GAP
  const panDur = motion.pan ?? TILT_PAN
  const panEase = TILT_PAN_EASE as NonNullable<Keyframe['ease']>
  const rest = [0, 0]
  const mapped = [...tilt]
    .sort((a, b) => a.in - b.in)
    .flatMap((z) => {
      const ext = spanOutputExtent(segments, z.in, z.out)
      return ext ? [{ z, tIn: ext.start, tOut: ext.end }] : []
    })

  const { keyframes, push } = trackEmitter()

  let chained = false
  for (let i = 0; i < mapped.length; i++) {
    const { z, tIn, tOut } = mapped[i]
    const pose = [clampTiltDeg(z.rx), clampTiltDeg(z.ry)]
    // Per-span transition speed — ×1 when absent, float-exact.
    const m = transitionMult(z.transition)

    if (!chained) {
      // Rest until the ramp starts; arrive settled exactly at the span start.
      const start = push(tIn - rampInDur * m, rest, 'none')
      push(start + rampInDur * m, pose, spanEase(z.ease, TILT_EASE))
    }

    // Pin the hold to the span's end — the exit transition starts here.
    push(tOut, pose, 'none')

    const next = mapped.at(i + 1)
    if (next && next.tIn - tOut <= chainGap) {
      // Connected tilts: swing straight to the next pose, landing by its
      // start — the next span's arrival, so its transition speed governs.
      const nextPose = [clampTiltDeg(next.z.rx), clampTiltDeg(next.z.ry)]
      push(
        Math.min(tOut + panDur * transitionMult(next.z.transition), next.tIn),
        nextPose,
        panEase,
      )
      chained = true
    } else {
      push(tOut + rampOutDur * m, rest, spanEase(z.ease, TILT_EASE))
      chained = false
    }
  }
  return { keyframes: sortKeyframes(keyframes) }
}

/**
 * The bubble's rest pose as [x, y, size] frame fractions, resolved through the
 * SAME oracle the picking layer uses (camBubbleRect) so the corner math can
 * never fork a third way (draw / pick / lowering). Fractions are resolution-
 * stable at a fixed aspect: the margin (24·s) and diameter (size·H) both
 * scale with s = H/1080, so the fraction depends only on the aspect ratio.
 */
export function camRestPose(cam: CamStyle, W: number, H = 1080): number[] {
  const r = camBubbleRect(cam, W, H)
  return [(r.x + r.size / 2) / W, (r.y + r.size / 2) / H, r.size / H]
}

/**
 * Expand the doc's source-anchored cam pose spans into an OUTPUT-time keyframe
 * track of [x, y, size] frame fractions (the third consumer of the
 * span→track seam):
 *
 *   rest ──ramp-in──▶ [x,y,size] ──hold──▶ span end ──ramp-out──▶ rest
 *
 * Rest is the doc's cam style resolved to fractions (camRestPose) — doc.cam IS
 * the rest pose, exactly as tilt's rest is flat. The pose is SETTLED at
 * span.in (ramp starts CAM_RAMP_IN before): a cam move frames what follows.
 * Spans ≤ CAM_CHAIN_GAP apart in output time morph pose-to-pose without
 * returning to rest (the connected-zoom rule). Absent pose fields inherit the
 * rest pose. Transitions run in output time so they never straddle a cut.
 */
export function camTrackFromDoc(
  cam: CamStyle,
  spans: CamPoseSpan[],
  segments: Segment[],
  W: number,
  H = 1080,
): KeyframeTrack<number[]> {
  const rest = camRestPose(cam, W, H)
  const poseOf = (z: CamPoseSpan): number[] => [
    z.x != null ? Math.min(1, Math.max(0, z.x)) : rest[0],
    z.y != null ? Math.min(1, Math.max(0, z.y)) : rest[1],
    z.size != null ? clampCamSize(z.size) : rest[2],
  ]
  const panEase = CAM_PAN_EASE as NonNullable<Keyframe['ease']>
  const mapped = [...spans]
    .sort((a, b) => a.in - b.in)
    .flatMap((z) => {
      const ext = spanOutputExtent(segments, z.in, z.out)
      return ext ? [{ z, tIn: ext.start, tOut: ext.end }] : []
    })

  const { keyframes, push } = trackEmitter()

  let chained = false
  for (let i = 0; i < mapped.length; i++) {
    const { z, tIn, tOut } = mapped[i]
    const pose = poseOf(z)
    // Per-span transition speed — 'instant' is the layout jump-cut.
    const m = transitionMult(z.transition)

    if (!chained) {
      // Rest until the ramp starts; arrive settled exactly at the span start.
      const start = push(tIn - CAM_RAMP_IN * m, rest, 'none')
      push(start + CAM_RAMP_IN * m, pose, spanEase(z.ease, CAM_EASE))
    }

    // Pin the hold to the span's end — the exit transition starts here.
    push(tOut, pose, 'none')

    const next = mapped.at(i + 1)
    if (next && next.tIn - tOut <= CAM_CHAIN_GAP) {
      // Connected moves: morph straight to the next pose, landing by its
      // start — the next span's arrival, so its transition speed governs.
      push(
        Math.min(tOut + CAM_PAN * transitionMult(next.z.transition), next.tIn),
        poseOf(next.z),
        panEase,
      )
      chained = true
    } else {
      push(tOut + CAM_RAMP_OUT * m, rest, spanEase(z.ease, CAM_EASE))
      chained = false
    }
  }
  return { keyframes: sortKeyframes(keyframes) }
}

/**
 * Pose fractions → the bubble square, mirroring ON_FRAME's pose branch (the
 * 40px floor and the rounded radius ride s, exactly like the static path).
 */
export function camRectFromPose(
  pose: readonly number[],
  cam: CamStyle,
  W: number,
  H = 1080,
): CamBubbleRect {
  const s = H / 1080
  const size = Math.max(40, pose[2] * H)
  return {
    x: pose[0] * W - size / 2,
    y: pose[1] * H - size / 2,
    size,
    radius: cam.shape === 'rounded' ? (cam.radius ?? 18) * s : size / 2,
  }
}

/**
 * The bubble rect at OUTPUT time t — the time-aware picking oracle.
 * With no motion spans it is exactly camBubbleRect at the doc's design layout;
 * with spans it samples the SAME track the lowering ships, so picking can
 * never drift from the paint (camDraw.test.ts pins both paths). Design space
 * is docCardLayout's (H = 1080, W from the output aspect).
 */
export function camBubbleRectAt(doc: ProjectDoc, t: number): CamBubbleRect {
  const { W, H } = docCardLayout(doc)
  if (!doc.camMotion || !doc.camMotion.length) {
    return camBubbleRect(doc.cam, W, H)
  }
  const track = camTrackFromDoc(
    doc.cam,
    doc.camMotion,
    ratedSegments(doc),
    W,
    H,
  )
  if (!track.keyframes.length) return camBubbleRect(doc.cam, W, H)
  return camRectFromPose(sample(track, t, lerpArray), doc.cam, W, H)
}

/** A resolved pose keyframe: clip-local time + full value vector. */
export interface MotionKey {
  at: number
  value: number[]
  ease?: string
}

/**
 * Bake resolved pose keyframes into a CLIP-LOCAL keyframe track.
 * The base vector holds until the first pose (a leading keyframe at 0 pins
 * it), values interpolate across each gap (ease-into per pose), and the last
 * pose holds to the clip's end (sample clamps). Same emitter, same
 * interpolator, same purity as the zoom/tilt/cam tracks.
 */
export function motionTrack(
  base: readonly number[],
  keys: MotionKey[],
  dur: number,
): KeyframeTrack<number[]> {
  const sorted = keys
    .filter((k) => Number.isFinite(k.at))
    .sort((a, b) => a.at - b.at)
  const first = sorted.at(0)
  if (!first) return { keyframes: [] }
  const { keyframes, push } = trackEmitter()
  if (first.at > 0.001) push(0, [...base], 'none')
  for (const k of sorted) {
    push(
      Math.min(Math.max(0, k.at), dur),
      k.value,
      spanEase(k.ease, MOTION_EASE),
    )
  }
  return { keyframes: sortKeyframes(keyframes) }
}

/** An overlay clip's base vector: [x, y, scale, rotation, opacityMul]. */
export function overlayMotionBase(o: OverlayClip): number[] {
  return [
    o.transform.x,
    o.transform.y,
    o.transform.scale || 1,
    o.transform.rotation || 0,
    1,
  ]
}

function overlayMotionKeys(o: OverlayClip, base: readonly number[]) {
  return (o.motion ?? []).map((p) => ({
    at: p.at,
    ease: p.ease,
    value: [
      p.x ?? base[0],
      p.y ?? base[1],
      p.scale ?? base[2],
      p.rotation ?? base[3],
      p.opacity ?? base[4],
    ],
  }))
}

/**
 * Effective [x, y, scale, rotation, opacityMul] of an overlay clip at
 * CLIP-LOCAL time t — the host-side mirror of ON_FRAME's sampling (the
 * picking layer substitutes it into the clip's transform so hit rects track
 * the animated element). Null = the clip has no motion.
 */
export function overlayMotionPoseAt(
  o: OverlayClip,
  t: number,
): number[] | null {
  if (!o.motion || !o.motion.length) return null
  const base = overlayMotionBase(o)
  const track = motionTrack(
    base,
    overlayMotionKeys(o, base),
    Math.max(OVERLAY_MIN_DURATION, o.duration),
  )
  if (!track.keyframes.length) return null
  return [...sample(track, t, lerpArray)]
}

/** An object clip's base vector: [x, y, z, rx, ry, rz, scale]. */
export function objectMotionBase(o: ObjectClip): number[] {
  const t = o.transform3d
  return [t.x, t.y, t.z, t.rx, t.ry, t.rz, t.scale || OBJECT_DEFAULT_SCALE]
}

function objectMotionKeys(o: ObjectClip, base: readonly number[]) {
  return (o.motion ?? []).map((p) => ({
    at: p.at,
    ease: p.ease,
    value: [
      p.x ?? base[0],
      p.y ?? base[1],
      p.z ?? base[2],
      p.rx ?? base[3],
      p.ry ?? base[4],
      p.rz ?? base[5],
      p.scale ?? base[6],
    ],
  }))
}

/**
 * Effective [x, y, z, rx, ry, rz, scale] of an object clip at CLIP-LOCAL
 * time t (from the span start; 0 when span-less over `clipDur`). Null = the
 * clip has no motion. The 3D mirror of overlayMotionPoseAt.
 */
export function objectMotionPoseAt(
  o: ObjectClip,
  t: number,
  clipDur: number,
): number[] | null {
  if (!o.motion || !o.motion.length) return null
  const base = objectMotionBase(o)
  const track = motionTrack(
    base,
    objectMotionKeys(o, base),
    o.span?.duration ?? clipDur,
  )
  if (!track.keyframes.length) return null
  return [...sample(track, t, lerpArray)]
}

// Load the recording as an HTMLVideoElement (any container/codec the browser plays).
// Warm-swap asset reuse: cache the decoded <video> by src on window.__vos__ so a
// program swap reuses the already-decoded element instead of reloading it — no
// flash. The cached element deliberately survives cleanup (it is not appended to the
// scene/DOM and content has no dispose), so it persists across warm LOADs.
//
// The @vosjs/timeline runtime IIFE is inlined first: it defines
// globalThis.__vosTimeline (sample/mapTime/easings) with EXACTLY the code the host
// evaluates, so keyframes/segments in ctx.data render identically on both sides.
const SETUP = `async (ctx) => {
  ;${timelineRuntimeCode}
  const ns = (window.__vos__ = window.__vos__ || {})
  // Paused/decode machinery (the engine's video-renderer contract). The studio has no element
  // renderers, so set it up here: the player bridge toggles isPaused on play/pause, and the
  // deterministic export loop awaits pendingDecodes via waitForVideosReady before capturing.
  if (ns.isPaused === undefined) ns.isPaused = true
  if (!ns.setGlobalPaused) ns.setGlobalPaused = (p) => { ns.isPaused = p }
  ns.pendingDecodes = ns.pendingDecodes || new Set()
  if (!ns.waitForVideosReady) ns.waitForVideosReady = async () => {
    if (ns.pendingDecodes.size) await Promise.all([...ns.pendingDecodes])
  }
  const cache = ns.videoCache || (ns.videoCache = new Map())
  // Server capture pages opt into BLOB-backed elements (data.videoFetchMode,
  // merged in by the render queue — never stored in a doc or config): a
  // detached, paused, network-backed video gets SUSPENDED by Chrome within
  // seconds (readyState drops to 0) and every later seek pays a ranged
  // re-fetch — the background-media rationale, applied to the
  // recording an export chunk seeks a hundred-plus times. Size-capped (a
  // page has a memory budget) and FAIL-OPEN: any fetch trouble degrades to
  // the plain network element, never a dead LOAD.
  const BLOB_FETCH_MAX = 400 * 1024 * 1024
  const toBlobUrl = async (src) => {
    const resp = await fetch(src)
    if (!resp.ok) throw new Error('[voila] blob fetch HTTP ' + resp.status)
    const len = Number(resp.headers.get('content-length') || 0)
    if (len > BLOB_FETCH_MAX) {
      try { if (resp.body) await resp.body.cancel() } catch (e) { void e }
      throw new Error('[voila] blob fetch over size cap')
    }
    const fetched = await resp.blob()
    // Keep the Blob itself: the WebCodecs provider demuxes the SAME
    // bytes (BlobSource) instead of paying a second network read.
    ;(ns.videoBlobs || (ns.videoBlobs = new Map())).set(src, fetched)
    return URL.createObjectURL(fetched)
  }
  const load = async (src, muted) => {
    let v = cache.get(src)
    if (v) return v
    let url = src
    if (ctx.data.videoFetchMode === 'blob') {
      try { url = await toBlobUrl(src) }
      catch (e) { console.warn('[voila] blob fetch failed, using network src', e) }
    }
    v = document.createElement('video')
    v.src = url
    v.crossOrigin = 'anonymous'
    v.muted = muted
    v.playsInline = true
    v.preload = 'auto'
    await new Promise((res, rej) => {
      v.oncanplay = () => res()
      // The MediaError rides along: code 4 is an unreadable/unsupported source
      // (a dead blob URL, a 404), code 3 a decode failure, code 2 a network
      // stall. A bare "failed to load" gave the fleet log nothing to act on.
      v.onerror = () => rej(new Error('[voila] video failed to load' + (v.error ? ' (' + v.error.code + (v.error.message ? ': ' + v.error.message : '') + ')' : '')))
      v.load()
    })
    cache.set(src, v)
    return v
  }
  // Shots: the "video" is a still image — drawImage accepts it directly and the
  // whole compositor (frame, browser bar, zoom) applies unchanged.
  const loadImage = (src) => {
    const hit = cache.get(src)
    if (hit) return Promise.resolve(hit)
    return new Promise((res, rej) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => { cache.set(src, img); res(img) }
      img.onerror = () => rej(new Error('[voila] image failed to load'))
      img.src = src
    })
  }
  // Capture pages only: a WebCodecs sequential frame provider for the
  // screen recording. Element seeks cost up to 250ms/frame under the settle
  // cap and currentTime is audio-clock-backed (not frame-accurate by spec);
  // sink-driven sequential decode delivers frames at decode speed and BY
  // PTS. The pull queue feeds canvasesAtTimestamps so the capture walk's
  // monotonic timestamps keep mediabunny's decode-each-packet-once fast
  // path. FAIL-OPEN at every step: a null provider leaves the element path
  // exactly as it was; preview/scrub never sets the flag.
  const makeWcProvider = async (src) => {
    if (!window.VideoDecoder) return null
    const MB = await import('https://esm.sh/mediabunny@1.27.3?target=es2022')
    const wcBlob = ns.videoBlobs && ns.videoBlobs.get(src)
    const input = new MB.Input({
      formats: MB.ALL_FORMATS,
      source: wcBlob ? new MB.BlobSource(wcBlob) : new MB.UrlSource(src),
    })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (!track || !(await track.canDecode())) { input.dispose(); return null }
      // VideoSampleSink, NOT CanvasSink — CanvasSink converts EVERY
      // decoded source frame to a canvas, and that per-source-frame paint
      // lost 41% on the SwiftShader fleet (job 4f1e99ab), multiplied by
      // rate-N spans (N source frames decoded per output frame). Samples
      // skipped in rated spans now CLOSE unconverted; only the DISPLAYED
      // frame draws, straight into the card via sample.draw (crop-capable).
      //
      // Sequential walk: drive samples() (pre-decoding, each packet decoded
      // once) and advance to the frame CONTAINING each requested timestamp.
      // NOT samplesAtTimestamps — its pipeline prefetches the timestamp
      // iterable ahead of yielding frames, which deadlocks a demand-driven
      // feed. The iterator starts AT THE FIRST REQUESTED TIMESTAMP and
      // RE-SEEKS on any jump beyond WC_JUMP — samples(t) begins at the
      // preceding keyframe, which is chunk cold-seek semantics; starting at
      // 0 and grinding forward decoded the whole source prefix before a
      // mid-timeline chunk's first frame (job 639dd24c: startup grew
      // linearly with chunk index).
      const sink = new MB.VideoSampleSink(track)
      const WC_JUMP = 3
      let iter = null
      let cur = null
      const wcClose = (s) => { if (s) { try { s.close() } catch (e) { void e } } }
      const advanceTo = async (t) => {
        if (
          !iter ||
          (cur && t < cur.timestamp) ||
          (cur && t > cur.timestamp + cur.duration + WC_JUMP)
        ) {
          // Dispose the old walk so its in-flight pre-decoded samples close
          // (an abandoned iterator leaks VideoSamples — pool stall risk).
          if (iter && iter.return) { try { void iter.return() } catch (e) { void e } }
          wcClose(cur)
          iter = sink.samples(t)
          cur = null
        }
        for (;;) {
          if (cur && cur.timestamp + cur.duration > t) return
          const nx = await iter.next()
          if (nx.done || !nx.value) return
          wcClose(cur) // skipped (rated spans) or superseded — never converted
          cur = nx.value
        }
      }
      let chain = Promise.resolve()
      const provider = {
        req: -1,
        width: track.displayWidth,
        height: track.displayHeight,
        duration: await input.computeDuration(),
        seek(t) {
          provider.req = t
          chain = chain
            .then(() => advanceTo(t))
            .catch((e) => { console.warn('[voila] webcodecs frame failed', e) })
          return chain
        },
        // Draw the CURRENT frame into the card. Returns false (element path
        // draws instead) until the first seek resolves or after any failure.
        draw(c2, crp2, dx2, dy2, dw2, dh2) {
          if (!cur) return false
          if (crp2) cur.draw(c2, crp2.x, crp2.y, crp2.w, crp2.h, dx2, dy2, dw2, dh2)
          else cur.draw(c2, dx2, dy2, dw2, dh2)
          return true
        },
      }
      return provider
    } catch (e) {
      input.dispose()
      throw e
    }
  }
  // Mic recordings carry audio → unmute the screen video so it plays back during native
  // playback. (Export pulls audio from the source blob separately; the seek path is silent.)
  const video = ctx.data.isImage
    ? await loadImage(ctx.data.videoSrc)
    : await load(ctx.data.videoSrc, !ctx.data.hasAudio)
  if (!ctx.data.isImage && ctx.data.videoDecodeMode === 'webcodecs') {
    try {
      const wcProvider = await makeWcProvider(ctx.data.videoSrc)
      // The provider's canvases must be drop-in for the element at the draw
      // sites (crop rects are capture-pixel space) — dimension mismatch
      // (rotation metadata, anamorphic) keeps the element path.
      if (
        wcProvider &&
        (!video.videoWidth ||
          (wcProvider.width === video.videoWidth &&
            wcProvider.height === video.videoHeight))
      ) {
        video.__voilaWc = wcProvider
      } else if (wcProvider) {
        console.warn('[voila] webcodecs dims mismatch — element path keeps the frame')
      }
    } catch (e) {
      console.warn('[voila] webcodecs provider unavailable, seeks stay html5', e)
    }
  }
  // The webcam is a separate recording (video-only) drawn as an editable bubble overlay.
  const cam = ctx.data.camSrc ? await load(ctx.data.camSrc, true) : null
  // The mic is a separate AUDIO sidecar (AT split): an off-DOM element driven by
  // the same sync as the screen video (source-anchored, so element time == the
  // video's). Unmuted — syncVid's autoplay net re-mutes on policy rejection.
  const mic = ctx.data.micSrc ? await load(ctx.data.micSrc, false) : null
  // Background media (frame.backgroundMedia): warm-load so the first paint is
  // complete. FAIL-OPEN — a bad key degrades to the CSS fill underneath, never
  // a dead LOAD (unlike the recording, which is the comp's reason to exist).
  const bgm = ctx.data.frame && ctx.data.frame.backgroundMedia
  if (bgm && bgm.key) {
    try {
      if (bgm.kind === 'image') await loadImage(bgm.key)
      else (await load(bgm.key, true)).loop = true
    } catch (e) { console.warn('[voila] background media failed to load', e) }
  }
  return { video: video, cam: cam, mic: mic }
}`

// Compositor v2 — a three-layer mesh stack under ONE perspective camera.
// Each layer is a plane
// perpendicular to the camera axis, centered on it, sized to exactly FILL the
// frustum at its depth (stage.ts planeSizeAtDepth), so it projects to the whole
// viewport regardless of depth:
//
//   overlay quad (z ${OVERLAY_Z})   screen-space   cam bubble + overlays
//   card mesh    (z ${CARD_Z})   world-space    the card painting — TILTS
//   background   (z ${BACKGROUND_Z})   screen-space   CSS fill + vos loop
//
// Painter's order is renderOrder (0/1/2) with depthTest off, so depth is free —
// the card's tilt never z-fights. At tilt = 0 the card plane fills the viewport
// exactly like the pre-v2 ortho quad ⇒ pixel-identical. LinearFilter/no-mipmaps
// matches the old quad (1:1 texel↔pixel at tilt 0); mipmaps + anisotropy switch
// on only when the card tilts (ON_FRAME), where minification would shimmer.
const CREATE_CONTENT = `(ctx, setupData) => {
  const THREE = ctx.THREE
  const gl = ctx.renderer && ctx.renderer.domElement
  const res = ctx.resolution
  const W0 = Math.max(2, Math.floor((gl && gl.width) || res.drawingBufferWidth || res.width || 1280))
  const H0 = Math.max(2, Math.floor((gl && gl.height) || res.drawingBufferHeight || res.height || 720))
  const aspect = W0 / H0
  // Own the perspective camera's aspect (ON_FRAME keeps it in sync on resize),
  // so the frustum-filling planes never distort regardless of what the engine
  // initialised. Camera sits at the origin looking down −z; the planes are in
  // front at negative z.
  const cam = ctx.camera
  if (cam && cam.isPerspectiveCamera) { cam.aspect = aspect; cam.updateProjectionMatrix() }
  const planeH = (z) => 2 * Math.abs(z) * Math.tan(${CARD_FOV} * Math.PI / 180 / 2)
  const makeLayer = (z, order) => {
    const canvas = document.createElement('canvas')
    canvas.width = W0
    canvas.height = H0
    const c2d = canvas.getContext('2d')
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    const h = planeH(z)
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(h * aspect, h),
      // transparent so each layer alpha-composites over the one behind (the card
      // padding, the overlay's blank area). depthTest off + renderOrder = the
      // painter's order that keeps a tilted card a single coherent layer.
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
    )
    mesh.position.set(0, 0, z)
    mesh.frustumCulled = false
    mesh.renderOrder = order
    ctx.scene.add(mesh)
    return { canvas: canvas, c2d: c2d, texture: texture, mesh: mesh }
  }
  const bg = makeLayer(${BACKGROUND_Z}, 0)
  const card = makeLayer(${CARD_Z}, 1)
  const ov = makeLayer(${OVERLAY_Z}, 2)
  return {
    objects: [bg.mesh, card.mesh, ov.mesh],
    refs: {
      bg: bg, card: card, ov: ov,
      // flat aliases = the card layer, so stub-context tests (which build only
      // { c2d, canvas, texture }) drive the card and let bg/overlay fall back.
      canvas: card.canvas, c2d: card.c2d, texture: card.texture,
      video: setupData.video, cam: setupData.cam, mic: setupData.mic,
    },
  }
}`

// Pure duration carrier (the interpreter pattern): the timeline exists only to
// define duration and drive ctx.time — per-frame state derives from
// ctx.time + ctx.data in onFrame. Duration comes from ctx.data so trims are
// data edits; vosCarrier opts into the engine's setDuration (T2.5) capability.
const CREATE_TIMELINE = `(ctx, content, duration) => {
  const tl = ctx.gsap.timeline()
  tl.to({}, { duration: (ctx.data && ctx.data.duration) || duration || 1, ease: 'none' })
  tl.data = { vosCarrier: true }
  return tl
}`

// The compositor. Deterministic: a pure function of ctx.time + ctx.data.
const ON_FRAME = `(ctx, content, dt) => {
  var r = content.refs
  // Three layers (compositor v2). Stub-context tests build only the flat
  // { c2d, canvas, texture } — those fall back to the card layer, so bg/overlay
  // draw to the SAME c2d and the merged call log stays in draw order.
  var card = r.card || r, bg = r.bg || r, ov = r.ov || r
  var c = card.c2d, cv = card.canvas, video = r.video
  if (!c || !video) return
  var bgC = bg.c2d || c, ovC = ov.c2d || c
  var res = ctx.resolution
  // Track the LIVE renderer canvas size (resize-aware); ctx.resolution is stale.
  var gl = ctx.renderer && ctx.renderer.domElement
  var W = Math.max(2, Math.floor((gl && gl.width) || res.drawingBufferWidth || res.width || cv.width))
  var H = Math.max(2, Math.floor((gl && gl.height) || res.drawingBufferHeight || res.height || cv.height))
  // Resizing a backing canvas requires disposing its CanvasTexture (THREE keeps
  // the GPU texture allocated at the original dims and re-uploads the new canvas
  // against stale dims → stretch/duplicate; dispose() forces a full realloc) and
  // rebuilding each frustum-filling plane at the new aspect + syncing the camera.
  if (cv.width !== W || cv.height !== H) {
    var THREE = ctx.THREE
    var aspect = W / H
    var cm = ctx.camera
    if (cm && cm.isPerspectiveCamera) { cm.aspect = aspect; cm.updateProjectionMatrix() }
    var lyr = [[bg, ${BACKGROUND_Z}], [card, ${CARD_Z}], [ov, ${OVERLAY_Z}]]
    for (var Li = 0; Li < lyr.length; Li++) {
      var Ly = lyr[Li][0], Lz = lyr[Li][1]
      if (Ly.canvas) { Ly.canvas.width = W; Ly.canvas.height = H }
      if (Ly.texture && Ly.texture.dispose) Ly.texture.dispose()
      if (Ly.mesh && THREE) {
        if (Ly.mesh.geometry && Ly.mesh.geometry.dispose) Ly.mesh.geometry.dispose()
        var Lh = 2 * Math.abs(Lz) * Math.tan(${CARD_FOV} * Math.PI / 180 / 2)
        Ly.mesh.geometry = new THREE.PlaneGeometry(Lh * aspect, Lh)
      }
    }
  }
  var d = ctx.data || {}
  var frame = d.frame || {}
  var TL = globalThis.__vosTimeline
  // Output-timeline seconds (engine-fed master clock) → source seconds on screen.
  var t = ctx.time || 0
  var srcT = TL.mapTime(d.segments || [], t)
  var s = H / 1080 // scale design-px controls to comp px

  // Play natively while playing (smooth); seek precisely otherwise (paused, scrubbing,
  // export). isPaused is the source of truth (bridge toggles it; export forces it true);
  // playing => let the video advance, else step to the exact frame. During a seek we
  // register a decode promise so the deterministic export loop can await the exact frame.
  var ns = window.__vos__ || {}
  var playing = ns.isPaused === false
  // Speed spans: the rate of the segment under the playhead. Natural playback
  // mirrors the remap with playbackRate (clamped to the browser's supported
  // range); the paused/seek path needs nothing — mapTime already lands srcT.
  var srcRate = TL.rateAt ? TL.rateAt(d.segments || [], t) : 1
  var playRate = Math.min(16, Math.max(0.0625, srcRate))
  // Drive a <video> to the on-screen SOURCE moment: play natively while playing (drift
  // correction covers cut-boundary jumps), else step to the exact frame (registering a
  // decode promise so the deterministic export awaits it). Shared by the screen video
  // and the webcam so both stay frame-accurate and in sync.
  function syncVid(vid) {
    try {
      if (playing) {
        if (vid.playbackRate !== playRate) {
          vid.playbackRate = playRate
          // Resampled (tape-style) speed, matching the export's offline mix.
          if (vid.preservesPitch !== false) vid.preservesPitch = false
          // Rate switches land LATE on the media clock — worst with an audio
          // track, where the element resyncs on the audio clock (~300ms of
          // source error at 4×, measured) — so a span's END plays the wrong
          // content moment. Resync position at the switch when it has already
          // drifted (an unconditional seek costs more than it fixes when the
          // media clock is tight, e.g. muted video-only playback).
          if (Math.abs(vid.currentTime - srcT) > 0.06) vid.currentTime = srcT
        } else if (Math.abs(vid.currentTime - srcT) > (srcRate !== 1 ? 0.12 : 0.3)) {
          // Tighter leash inside rated spans: at N× a given source drift is N×
          // more visible in content terms; a rare micro-seek there is not.
          vid.currentTime = srcT
        }
        if (vid.paused) {
          var p = vid.play()
          if (p && p.catch) p.catch(function (err) {
            // Autoplay policy: an UNMUTED play() without user activation
            // rejects (the studio tab opens programmatically, so there is no
            // gesture yet). Without this fallback the element never plays and
            // "playback" degrades to drift-correction seeks — a silent ~3fps
            // slideshow until the user's first scrub. Muted playback is always
            // allowed: play muted now, unmute below once the host reports a
            // user gesture (d.audioUnlocked; the player iframe carries
            // allow="autoplay" so the top frame's activation counts here).
            if (!vid.muted && err && err.name === 'NotAllowedError') {
              vid.muted = true
              vid.__voilaAutoMuted = true
              var p2 = vid.play()
              if (p2 && p2.catch) p2.catch(function () {})
            }
          })
        } else if (vid.__voilaAutoMuted && d.audioUnlocked) {
          // First user gesture happened — lift the policy fallback. If the
          // browser still objects it pauses the element, and the paused branch
          // above self-heals (re-mute + resume) on the next frame.
          vid.muted = false
          vid.__voilaAutoMuted = false
        }
      } else {
        if (!vid.paused) vid.pause()
        // A WebCodecs provider (capture pages) services the frame by
        // PTS at decode speed — no element seek, no 250ms settle cap. The
        // element stays paused as the dimension source and fallback.
        var wcp = vid.__voilaWc
        if (wcp) {
          var wcT = Math.min(srcT, wcp.duration || srcT)
          if (wcp.req !== wcT) {
            var wdp = wcp.seek(wcT)
            if (ns.pendingDecodes) {
              ns.pendingDecodes.add(wdp)
              wdp.finally(function () { ns.pendingDecodes.delete(wdp) })
            }
          }
          return
        }
        var target = Math.min(srcT, vid.duration || srcT)
        if (vid.readyState >= 1 && Math.abs(vid.currentTime - target) > 0.02) {
          if (ns.pendingDecodes) {
            var dp = new Promise(function (resolve) {
              var done = function () { vid.removeEventListener('seeked', done); resolve() }
              vid.addEventListener('seeked', done)
              setTimeout(done, 250) // fallback so a missed 'seeked' can't hang the export
            })
            ns.pendingDecodes.add(dp)
            dp.finally(function () { ns.pendingDecodes.delete(dp) })
          }
          vid.currentTime = target
        }
      }
    } catch (e) {}
  }
  if (video.play) syncVid(video) // stills (HTMLImageElement) have nothing to sync
  if (r.cam) syncVid(r.cam)
  if (r.mic) syncVid(r.mic)
  // Gain routing (live via SET_DATA). With a mic sidecar (AT split) the
  // recording <video> carries SYSTEM audio — its volume is the system fader —
  // and the sidecar element is the voice (micGain). Legacy takes have one
  // mixed track on the <video>, governed by micGain as before.
  if (video.play && video.volume !== undefined) {
    var vidG = r.mic
      ? (d.sysGain != null ? d.sysGain : 1)
      : (d.micGain != null ? d.micGain : 1)
    if (Math.abs(video.volume - vidG) > 0.001) video.volume = vidG
  }
  if (r.mic && r.mic.volume !== undefined) {
    var micG = d.micGain != null ? d.micGain : 1
    if (Math.abs(r.mic.volume - micG) > 0.001) r.mic.volume = micG
  }

  // background — the BACKGROUND layer (screen-space plane, never tilts). Painted
  // to bgC (its own canvas at runtime; the card c2d under stub tests). Redraw +
  // re-upload ONLY when the signature changed or the media layer can paint a
  // FRESH frame (a ready video advances every frame). A static gradient thus
  // uploads once, so the common case steady-states at the card texture ALONE —
  // SwiftShader-fleet perf, compositor v2 risk #1.
  var bgSigM = frame.backgroundMedia
  var bgSig = (frame.background || '') + '|' + (bgSigM && bgSigM.key ? bgSigM.kind + ':' + bgSigM.key + ':' + (bgSigM.dim || 0) + ':' + (bgSigM.blur || 0) + ':' + (frame.parallax || 0) : '') + '|' + W + 'x' + H

  // --- background media: a baked vos loop
  // or still, cover-fit over the CSS fill, under the card, OUTSIDE the zoom
  // transform. Video time is OUTPUT-anchored modulo the loop (bgT = t % dur) —
  // pure f(t), so chunk cold-seeks land correctly and trims/speed never retime
  // ambience. Locals bg-prefixed (one var scope). Lazy element acquisition
  // keeps background SWAPS live SET_DATA edits (no LOAD): the element is
  // created + cached on first sight, and until it can paint the CSS fill shows
  // through (fail-open, never black). Acquisition + time-sync run EVERY frame
  // (even when the repaint below is skipped) so scrub seeks land and playback
  // stays locked to the modulo clock.
  var bgm = frame.backgroundMedia
  var bgEl = null, bgIsImg = !!(bgm && bgm.kind === 'image'), bgReady = false
  if (bgm && bgm.key && ns.videoCache) {
    bgEl = ns.videoCache.get(bgm.key)
    if (!bgEl) {
      if (bgIsImg) {
        bgEl = new Image()
        bgEl.crossOrigin = 'anonymous'
        bgEl.src = bgm.key
      } else {
        bgEl = document.createElement('video')
        bgEl.crossOrigin = 'anonymous'
        bgEl.muted = true
        bgEl.playsInline = true
        bgEl.preload = 'auto'
        bgEl.loop = true
        if (bgm.key.indexOf('blob:') === 0 || bgm.key.indexOf('data:') === 0) {
          bgEl.src = bgm.key
          bgEl.load()
        } else {
          // URL-backed loops (assets.vos.so bakes, /api proxies, take-dir
          // keys): fetch to a BLOB first — the render-page pattern. A
          // detached, paused, network-backed video gets SUSPENDED by Chrome
          // within seconds (readyState drops to 0, media resources released),
          // and the next seek then needs a full network reload — that's the
          // "official-vos background vanishes on scrub and pops in seconds
          // late" bug. Blob-backed elements seek instantly and never suspend.
          // Fail-open to the direct URL if the fetch dies; baked loops are
          // ≤~200KB so the buffer cost is trivial.
          ;(function (el, url) {
            fetch(url).then(function (r) { return r.ok ? r.blob() : Promise.reject(new Error('' + r.status)) })
              .then(function (b) { el.src = URL.createObjectURL(b); el.load() })
              .catch(function () { el.src = url; el.load() })
          })(bgEl, bgm.key)
        }
      }
      // Cache immediately (readiness gates drawing): the export settle guards
      // scan videoCache, so a still-loading background is waited on, not raced.
      ns.videoCache.set(bgm.key, bgEl)
    }
    if (!bgIsImg && bgEl.play) {
      var bgDur = bgm.duration || bgEl.duration || 0
      var bgT = bgDur > 0 ? t % bgDur : 0
      try {
        if (playing) {
          if (bgEl.playbackRate !== 1) bgEl.playbackRate = 1
          // Free-run on the element's native loop; drift-correct against the
          // modulo clock. Near the wrap the raw delta spans ~bgDur — treat
          // wrap-adjacent as in sync so every loop boundary isn't a seek.
          var bgDrift = Math.abs(bgEl.currentTime - bgT)
          if (bgDur > 0 && !bgEl.seeking && bgDrift > 0.3 && bgDur - bgDrift > 0.3) bgEl.currentTime = bgT
          if (bgEl.paused) { var bgP = bgEl.play(); if (bgP && bgP.catch) bgP.catch(function () {}) }
        } else {
          if (!bgEl.paused) bgEl.pause()
          var bgTarget = Math.min(bgT, bgEl.duration || bgT)
          // COALESCE seeks: a scrub moves t every frame, and re-assigning
          // currentTime ABORTS the in-flight seek — on a remote (assets.vos.so)
          // source that keeps the element mid-seek for the whole drag, so no
          // frame ever decodes and the background pops in seconds late. Issue
          // a seek only when none is in flight; the frame after 'seeked' fires
          // corrects toward the latest target, so seeks run serially and
          // converge on the release point.
          if (bgEl.readyState >= 1 && !bgEl.seeking && Math.abs(bgEl.currentTime - bgTarget) > 0.02) {
            if (ns.pendingDecodes) {
              var bgDp = new Promise(function (resolve) {
                var bgDone = function () { bgEl.removeEventListener('seeked', bgDone); resolve() }
                bgEl.addEventListener('seeked', bgDone)
                setTimeout(bgDone, 250) // fallback so a missed 'seeked' can't hang the export
              })
              ns.pendingDecodes.add(bgDp)
              bgDp.finally(function () { ns.pendingDecodes.delete(bgDp) })
            }
            bgEl.currentTime = bgTarget
          }
        }
      } catch (e) {}
    }
    bgReady = bgIsImg ? !!(bgEl.complete && bgEl.naturalWidth) : bgEl.readyState >= 2
  }

  // Repaint on signature change, or when the media can paint a FRESH frame.
  // A video's readyState drops below HAVE_CURRENT_DATA while a seek is in
  // flight, and a scrub issues a new seek every frame — repainting then would
  // flash the CSS fill through until the drag ends (the background-vanishes-
  // while-scrubbing bug). Skipping the repaint keeps the LAST uploaded frame,
  // matching the card video's retained frame mid-seek (and the cam bubble's
  // sticky-readiness fix below). A sig change still repaints immediately —
  // fail-open to the CSS fill until the new medium decodes.
  var bgDirty = bg.sig !== bgSig || bgReady
  if (bgDirty) {
  bgC.clearRect(0, 0, W, H)
  // A KNOWN ground first: assigning an unpaintable string to fillStyle is a
  // silent no-op in canvas, so the layer would keep whatever colour the last
  // draw happened to leave — a backdrop the document never asked for and
  // nothing on screen explains.
  bgC.fillStyle = '#0b0b0c'
  bgC.fillStyle = (function () {
    var bgcss = frame.background || '#0b0b0c'
    if (typeof bgcss === 'string' && bgcss.indexOf('linear-gradient') === 0) {
      var inner = bgcss.substring(bgcss.indexOf('(') + 1, bgcss.lastIndexOf(')'))
      var parts = inner.split(',').map(function (x) { return x.trim() })
      var ang = 135, cols = []
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].indexOf('deg') >= 0) ang = parseFloat(parts[i])
        else cols.push(parts[i])
      }
      if (cols.length < 2) cols = [cols[0] || '#000', cols[0] || '#000']
      var rad = (ang - 90) * Math.PI / 180
      var ux = Math.cos(rad), uy = Math.sin(rad)
      var g = bgC.createLinearGradient(W / 2 - ux * W / 2, H / 2 - uy * H / 2, W / 2 + ux * W / 2, H / 2 + uy * H / 2)
      g.addColorStop(0, cols[0]); g.addColorStop(1, cols[cols.length - 1])
      return g
    }
    // Radial: 'radial-gradient([circle|ellipse] [at X% Y%,] A, B)'. Canvas
    // cannot take the string, so it is built here like the linear one, with
    // CSS's own default extent (farthest corner) so the second colour lands
    // exactly where a browser would put it.
    if (typeof bgcss === 'string' && bgcss.indexOf('radial-gradient') === 0) {
      var rin = bgcss.substring(bgcss.indexOf('(') + 1, bgcss.lastIndexOf(')'))
      var rps = rin.split(',').map(function (x) { return x.trim() })
      var rcx = 0.5, rcy = 0.5, rcols = []
      for (var ri = 0; ri < rps.length; ri++) {
        var rp = rps[ri]
        if (rp.indexOf('circle') === 0 || rp.indexOf('ellipse') === 0 || rp.indexOf('at ') === 0) {
          var rat = /at\\s+([\\d.]+)%\\s+([\\d.]+)%/.exec(rp)
          if (rat) { rcx = parseFloat(rat[1]) / 100; rcy = parseFloat(rat[2]) / 100 }
        } else rcols.push(rp)
      }
      if (rcols.length < 2) rcols = [rcols[0] || '#000', rcols[0] || '#000']
      var rpx = rcx * W, rpy = rcy * H
      var rr = Math.max(
        Math.sqrt(rpx * rpx + rpy * rpy),
        Math.sqrt((W - rpx) * (W - rpx) + rpy * rpy),
        Math.sqrt(rpx * rpx + (H - rpy) * (H - rpy)),
        Math.sqrt((W - rpx) * (W - rpx) + (H - rpy) * (H - rpy))
      )
      var rg = bgC.createRadialGradient(rpx, rpy, 0, rpx, rpy, rr)
      rg.addColorStop(0, rcols[0]); rg.addColorStop(1, rcols[rcols.length - 1])
      return rg
    }
    return bgcss
  })()
  bgC.fillRect(0, 0, W, H)

  if (bgEl && bgReady) {
      var bgW = (bgIsImg ? bgEl.naturalWidth : bgEl.videoWidth) || 16
      var bgH = (bgIsImg ? bgEl.naturalHeight : bgEl.videoHeight) || 9
      // Parallax: the media counter-pans a touch as the zoom camera moves —
      // a depth cue. Pure f(t): offset from the SAME zoom-track sample the card
      // uses; over-scan the cover fit so the pan never reveals an edge.
      var bgPar = Math.min(1, Math.max(0, frame.parallax || 0))
      var bgOx = 0, bgOy = 0
      if (bgPar > 0 && d.zoomTrack && d.zoomTrack.keyframes && d.zoomTrack.keyframes.length) {
        var bgZ = TL.sample(d.zoomTrack, t, TL.lerpArray)
        var bgAmp = bgPar * (bgZ[0] - 1) * 0.08
        bgOx = -(bgZ[1] - 0.5) * bgAmp * W
        bgOy = -(bgZ[2] - 0.5) * bgAmp * H
      }
      var bgOver = 1 + (bgPar > 0 ? 0.1 : 0)
      var bgS = Math.max(W / bgW, H / bgH) * bgOver // cover-fit (+ parallax slack)
      var bgDw = bgW * bgS, bgDh = bgH * bgS
      // Clamp the pan into the cover slack so edges never show.
      var bgSlackX = (bgDw - W) / 2, bgSlackY = (bgDh - H) / 2
      bgOx = Math.max(-bgSlackX, Math.min(bgSlackX, bgOx))
      bgOy = Math.max(-bgSlackY, Math.min(bgSlackY, bgOy))
      // Blur: softens the media behind the card (design px × s).
      var bgBlur = bgm.blur || 0
      if (bgBlur > 0 && bgC.filter !== undefined) bgC.filter = 'blur(' + bgBlur * s + 'px)'
      try { bgC.drawImage(bgEl, (W - bgDw) / 2 + bgOx, (H - bgDh) / 2 + bgOy, bgDw, bgDh) } catch (e) {}
      if (bgBlur > 0 && bgC.filter !== undefined) bgC.filter = 'none'
      var bgDim = bgm.dim || 0
      if (bgDim > 0) {
        bgC.fillStyle = 'rgba(0,0,0,' + Math.min(1, bgDim) + ')'
        bgC.fillRect(0, 0, W, H)
      }
  }
  bg.sig = bgSig
  if (bg.texture) bg.texture.needsUpdate = true
  }

  // The CARD layer canvas starts transparent each frame — the padding around
  // the contain-fit card shows the background layer through the plane's alpha.
  c.clearRect(0, 0, W, H)

  // video destination rect (contain within the padded area). The optional browser-bar
  // strip is part of the card: it takes barH from the available height and the video
  // sits below it — bar + video share the rounded clip and zoom together.
  var pad = (frame.padding || 0) * s
  // Per-side placement (frame.inset: fractions of the frame, a negative side
  // bleeds the card past the edge) overrides the symmetric padding on the
  // sides it names; absent sides keep pad, so the old math falls out.
  var ipIns = frame.inset || {}
  var ipL = ipIns.left == null ? pad : ipIns.left * W
  var ipR = ipIns.right == null ? pad : ipIns.right * W
  var ipT = ipIns.top == null ? pad : ipIns.top * H
  var ipB = ipIns.bottom == null ? pad : ipIns.bottom * H
  var bar = frame.browserBar || {}
  // Window takes carry a viewport crop (drawImage source rect, capture px) that
  // removes the real browser chrome — the card's source dims are then the CROP
  // dims (meta/cursor were rewritten into crop space at doc build).
  var crp = d.crop || null
  var vw = crp ? crp.w : (video.videoWidth || video.naturalWidth || 16)
  var vh = crp ? crp.h : (video.videoHeight || video.naturalHeight || 9)
  // Card-chrome scale: everything that belongs to the CARD (browser bar +
  // internals, corner radius, border, card shadow, cursor dot, click effects)
  // scales with the CARD, not the frame. When the frame is NARROWER than the
  // footage the card is width-limited and shrinks by frameAspect/videoAspect;
  // frame-relative sizing (s alone) was calibrated for native aspect and made
  // the chrome read giant on a small card ("the 9:16 huge browser bar" bug).
  // At native/wider aspects cf = 1 exactly, so nothing changes. MIRRORED by
  // computeCardLayout — change them together.
  // Cover fit: the CARD rect and the VIDEO rect separate. Under
  // contain (default, byte-identical for every existing doc) the card IS the
  // fitted video; under cover the card is the padded area itself and the
  // footage cover-fills it, cropped around frame.focus (normalized video
  // fractions, the zoom cx/cy convention; clamped so no gap ever shows).
  // Chrome under cover scales by s alone (cf = 1): the card is as wide as
  // the frame allows, which is the case cf existed to protect against.
  var fitCover = frame.fit === 'cover'
  var cf = fitCover ? 1 : Math.min(1, (W / H) / (vw / vh))
  var s2 = s * cf
  // current zoom — a standard keyframe track in OUTPUT time (hold + arrival pairs
  // expanded by the lowering), sampled with the shared deterministic interpolator.
  // Sampled here, before the rect math, so a cover crop can follow it.
  var lvl = 1, zx = 0.5, zy = 0.5
  var zt = d.zoomTrack
  if (zt && zt.keyframes && zt.keyframes.length) {
    var z = TL.sample(zt, t, TL.lerpArray)
    lvl = z[0]; zx = z[1]; zy = z[2]
  }
  var barH = bar.kind && bar.kind !== 'none' ? (bar.height || 44) * s2 : 0
  var availW = Math.max(1, W - ipL - ipR), availH = Math.max(1, H - ipT - ipB - barH)
  var sc, dw, dh, dx, dy, cardX, cardY, cardW, cardH
  if (fitCover) {
    sc = Math.max(availW / vw, availH / vh)
    dw = vw * sc; dh = vh * sc
    cardX = ipL; cardY = ipT; cardW = availW; cardH = availH + barH
    var fcv = frame.focus || {}
    var fcx = fcv.cx == null ? 0.5 : Math.max(0, Math.min(1, fcv.cx))
    var fcy = fcv.cy == null ? 0.5 : Math.max(0, Math.min(1, fcv.cy))
    // focusFollow: the crop keeps the camera's focus in frame (a 9:16 cut).
    if (frame.focusFollow === 'camera' && zt && zt.keyframes && zt.keyframes.length) { fcx = zx; fcy = zy }
    var vTop = ipT + barH
    dx = Math.min(cardX, Math.max(cardX + availW - dw, cardX + availW / 2 - fcx * dw))
    dy = Math.min(vTop, Math.max(vTop + availH - dh, vTop + availH / 2 - fcy * dh))
  } else {
    sc = Math.min(availW / vw, availH / vh)
    dw = vw * sc; dh = vh * sc
    // Centred inside the inset area (equal to (W - dw) / 2 when no side is
    // inset, the old formula).
    dx = ipL + (availW - dw) / 2; dy = ipT + barH + (availH - dh) / 2
    cardX = dx; cardY = dy - barH; cardW = dw; cardH = dh + barH
  }
  var radius = (frame.radius || 0) * s2
  var shadow = frame.shadow || 0
  // The shadow's colour (a #rrggbb; the strengths are its alpha) and the
  // optional tight CONTACT layer that makes a light card sit on a light
  // ground.
  var shC = frame.shadowContact || 0
  var shRgb = '0,0,0'
  var shHex = frame.shadowColor
  if (typeof shHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(shHex)) {
    shRgb = parseInt(shHex.slice(1, 3), 16) + ',' + parseInt(shHex.slice(3, 5), 16) + ',' + parseInt(shHex.slice(5, 7), 16)
  }

  function rr(x, y, w, h, rd, cx) {
    var cc = cx || c
    if (cc.roundRect) { cc.beginPath(); cc.roundRect(x, y, w, h, rd) }
    else { cc.beginPath(); cc.rect(x, y, w, h) }
  }

  c.save()
  // d.zoomSuppressed = editor aiming mode: the host merges it into ctx.data
  // while the focus overlay is up so the full frame renders. Never persisted.
  // ceZs = the zoom transform's device scale, for the two values below that
  // are sized in DEVICE pixels inside a scaled user space.
  var ceZs = 1
  if (lvl > 1.001 && !d.zoomSuppressed) {
    var fx = dx + zx * dw, fy = dy + zy * dh
    c.translate(fx, fy); c.scale(lvl, lvl); c.translate(-fx, -fy)
    ceZs = lvl
  }
  // The card's shadows are cast by a body drawn OFF-CANVAS and brought back
  // by shadowOffsetX alone. Shadow offsets are device space, untouched by
  // the transform, so the body moves by shD / ceZs in user space and the
  // offset is shD; shD clears the canvas by the card's own device size, so
  // no part of the body lands on it at any zoom. Painting the body in place
  // (opaque black under the footage) left a 1px dark seam along every
  // straight card edge at a fractional coordinate: the fill's anti-aliased
  // rim showed through where the clipped footage did not cover it, and the
  // corners, drawn by the clip alone, hid theirs inside the arc.
  var shD = ceZs * (cardW + cardH) + 2 * (W + H)
  var shX = cardX - shD / ceZs
  // soft shadow behind the card (bar strip + video)
  if (shadow > 0) {
    c.save()
    c.shadowColor = 'rgba(' + shRgb + ',' + shadow + ')'
    c.shadowBlur = 60 * s2; c.shadowOffsetX = shD; c.shadowOffsetY = 24 * s2
    c.fillStyle = '#000'
    rr(shX, cardY, cardW, cardH, radius); c.fill()
    c.restore()
  }
  // contact shadow: tight and close, over the ambient layer
  if (shC > 0) {
    c.save()
    c.shadowColor = 'rgba(' + shRgb + ',' + shC + ')'
    c.shadowBlur = 10 * s2; c.shadowOffsetX = shD; c.shadowOffsetY = 3 * s2
    c.fillStyle = '#000'
    rr(shX, cardY, cardW, cardH, radius); c.fill()
    c.restore()
  }
  // The footage and the bar fill overdraw the clip by one device pixel
  // (CARD_EDGE_OVERDRAW) so the clip is the only edge: a destination rect
  // that lands exactly on the clip path anti-aliases the edge twice at a
  // fractional coordinate and leaves a half-covered seam pixel.
  var ceOv = ${CARD_EDGE_OVERDRAW} / ceZs
  var ceX = dx - ceOv, ceY = dy - ceOv, ceW = dw + 2 * ceOv, ceH = dh + 2 * ceOv
  // video, then bar, clipped to the card's rounded corners. The bar draws
  // AFTER the footage: under cover the video rect can overflow ABOVE the
  // bar strip (a vertical crop), and bar-first let the footage paint over
  // it (found by eye on the padded marquee check — the stub geometry tests
  // have no z-order). Contain never overlaps, so the order is free there.
  c.save()
  rr(cardX, cardY, cardW, cardH, radius); c.clip()
  try {
    // The provider draws the current sample directly (crop-capable,
    // dimension-checked at attach); false ⇒ element path (pre-first-seek,
    // or the provider never attached).
    var wcp3 = video.__voilaWc
    if (!(wcp3 && wcp3.draw(c, crp, ceX, ceY, ceW, ceH))) {
      if (crp) c.drawImage(video, crp.x, crp.y, crp.w, crp.h, ceX, ceY, ceW, ceH)
      else c.drawImage(video, ceX, ceY, ceW, ceH)
    }
  } catch (e) {}
  if (barH > 0) {
    var dark = bar.kind.indexOf('dark') >= 0
    var minimal = bar.kind === 'minimal'
    // minimal-bar theme: resolved colors from ctx.data (MINIMAL_BAR_THEMES);
    // absent = the built-in graphite look
    var thm = (minimal && bar.theme) || null
    c.fillStyle = minimal ? (thm ? thm.bar : '#141417') : dark ? '#2a2a2e' : '#e9e9eb'
    c.fillRect(cardX - ceOv, cardY - ceOv, cardW + 2 * ceOv, barH + ceOv)
    c.fillStyle = dark || (minimal && !(thm && thm.light)) ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
    c.fillRect(cardX, cardY + barH - s2, cardW, s2) // hairline above the video
    var midY = cardY + barH / 2
    if (bar.showControls !== false && !minimal) {
      if (bar.kind.indexOf('mac') === 0) {
        var lights = ['#ff5f57', '#febc2e', '#28c840']
        for (var li = 0; li < 3; li++) {
          c.fillStyle = lights[li]
          c.beginPath(); c.arc(cardX + (20 + li * 20) * s2, midY, 6 * s2, 0, Math.PI * 2); c.fill()
        }
      } else {
        c.strokeStyle = dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)'
        c.lineWidth = 1.5 * s2
        var g = 4.5 * s2, gx = cardX + cardW - 22 * s2 // close ✕, then ▢, then — leftward
        c.beginPath()
        c.moveTo(gx - g, midY - g); c.lineTo(gx + g, midY + g)
        c.moveTo(gx + g, midY - g); c.lineTo(gx - g, midY + g)
        c.stroke()
        c.strokeRect(gx - 28 * s2 - g, midY - g, g * 2, g * 2)
        c.beginPath()
        c.moveTo(gx - 56 * s2 - g, midY); c.lineTo(gx - 56 * s2 + g, midY)
        c.stroke()
      }
    }
    if (bar.showUrl !== false && bar.url) {
      var pillW = Math.min(cardW * 0.5, Math.max(200 * s2, cardW * 0.34))
      var pillH = barH - 16 * s2
      var px0 = cardX + (cardW - pillW) / 2, py0 = cardY + 8 * s2
      c.fillStyle = minimal ? (thm ? thm.pill : '#26262b') : dark ? '#1d1d20' : '#ffffff'
      rr(px0, py0, pillW, pillH, pillH / 2); c.fill()
      c.fillStyle = minimal ? (thm ? thm.text : '#9a9aa1') : dark ? '#a1a1a6' : '#5f5f64'
      c.font = 13 * s2 + 'px -apple-system, system-ui, sans-serif'
      c.textAlign = 'center'; c.textBaseline = 'middle'
      var label = String(bar.url)
      var maxTextW = pillW - 28 * s2
      if (c.measureText(label).width > maxTextW) {
        while (label.length > 1 && c.measureText(label + '\\u2026').width > maxTextW) label = label.slice(0, -1)
        label += '\\u2026'
      }
      c.fillText(label, px0 + pillW / 2, py0 + pillH / 2)
      c.textAlign = 'start'; c.textBaseline = 'alphabetic'
    }
  }
  c.restore()
  // border around the card, drawn OUTWARD like a CSS outline: the path is
  // expanded by half the width so the stroke's inner edge lands on the card's
  // own edge and never covers footage (inset, a 24px width ate 24px of the
  // recording). Outer corner radius grows with the width, the CSS-border rule;
  // a square card stays square. frame.border is the ALPHA (0 = off) and rides
  // globalAlpha, so borderColor takes any CSS colour notation without this
  // having to parse one. Card chrome, so it scales by s2.
  if (frame.border) {
    var bdW = (frame.borderWidth > 0 ? frame.borderWidth : ${FRAME_BORDER_WIDTH_DEFAULT}) * s2
    var bdH = bdW / 2
    c.save()
    c.globalAlpha = Math.min(1, frame.border)
    c.strokeStyle = frame.borderColor || '${FRAME_BORDER_COLOR_DEFAULT}'
    c.lineWidth = bdW
    rr(cardX - bdH, cardY - bdH, cardW + bdW, cardH + bdW, radius > 0 ? radius + bdH : 0)
    c.stroke()
    c.restore()
  }
  // Cover crop: click effects and the cursor dot are video-anchored, so a
  // cropped-out moment must not paint over the padding — clip them to the
  // card. Contain never needs it (the video rect IS the card).
  if (fitCover) { c.save(); rr(cardX, cardY, cardW, cardH, radius); c.clip() }
  // cursor coordinate space + drawn radius (shared by click effects + the dot)
  var space = d.cursorSpace || { w: vw, h: vh }
  var curSize = ((d.cursorStyle && d.cursorStyle.size) || 24) * s2 * 0.5

  // click effects — pure f(t): d.clicks are
  // OUTPUT-anchored records baked at lowering (sorted by ot; re-baked on every
  // edit, so they can't go stale), drawn UNDER the cursor and inside the zoom
  // transform so they scale with the camera. Locals are ck-prefixed (one var
  // scope). Effects anchor at the click point, never the smoothed cursor.
  var cks = d.clicks || []
  var ckF = d.clickFx || {}
  var ckPress = 1
  if (cks.length) {
    var ckK = ckF.k || 1
    var ckPre = ${CLICK_FX_PRE}
    var ckRD = ${CLICK_RIPPLE_DUR} * (ckF.dur || 1)
    var ckPD = ${CLICK_PULSE_DUR} * (ckF.dur || 1)
    // 'highlight' keeps the ripple window too: clicks whose element rect
    // failed the lowering gates (huge/absent) fall back to a ripple per click
    var ckWin = ckF.style === 'pulse' ? ckPD : ckF.style === 'none' ? 0 : ckRD
    var ckCol = ckF.col || 0
    var ckDip = Math.min(0.3, 0.18 * ckK)
    for (var ci = 0; ci < cks.length; ci++) {
      var ck = cks[ci]
      if (ck.ot - 0.08 > t) break // sorted: nothing later is active yet
      var ckEnd = ck.ot - ckPre + ckWin
      if (ckF.style === 'highlight' && ck.r && ck.up + ${CLICK_HIGHLIGHT_FADE} > ckEnd) ckEnd = ck.up + ${CLICK_HIGHLIGHT_FADE}
      if (ckF.press && ck.up + 0.16 > ckEnd) ckEnd = ck.up + 0.16
      if (t > ckEnd) continue
      // cross-cut guard: the on-screen source moment must still be near the
      // click's source moment, or an effect near a cut would keep painting
      // over the NEXT segment's unrelated footage
      if (Math.abs(srcT - ck.st) > 2) continue
      var ckAx = dx + (ck.x / (space.w || vw)) * dw
      var ckAy = dy + (ck.y / (space.h || vh)) * dh
      // press dip: smoothstep down around the real mousedown (80 ms lead —
      // anticipation is what makes effects feel synced), hold through the real
      // down→up span (drags dip long), easeOutBack rebound with a slight
      // overshoot. Feeds the cursor dot's radius below.
      if (ckF.press) {
        var ckPs = 1
        if (t < ck.ot + 0.05) {
          var ckU = (t - (ck.ot - 0.08)) / 0.13
          if (ckU > 0) {
            if (ckU > 1) ckU = 1
            ckU = ckU * ckU * (3 - 2 * ckU)
            ckPs = 1 - ckDip * ckU
          }
        } else if (t <= ck.up) {
          ckPs = 1 - ckDip
        } else {
          var ckV = (t - ck.up) / 0.16
          if (ckV < 1) {
            var ckW2 = ckV - 1
            ckPs = 1 - ckDip + ckDip * (1 + 4 * ckW2 * ckW2 * ckW2 + 3 * ckW2 * ckW2)
          }
        }
        ckPress = ckPs
      }
      var ckStyle = ckF.style === 'highlight' && !ck.r ? 'ripple' : ckF.style
      if (ckStyle === 'ripple') {
        // expanding ring: cubic-out expansion, cubic fade, thinning stroke
        var ckU2 = (t - (ck.ot - ckPre)) / ckRD
        if (ckU2 >= 0 && ckU2 <= 1) {
          var ckFade = (1 - ckU2) * (1 - ckU2) * (1 - ckU2)
          var ckR = curSize * 0.8 + (1 - ckFade) * 44 * s2 * ckK
          var ckA = Math.min(1, ckFade * 0.65 * ckK)
          var ckLw = Math.max(1.5 * s2, 3 * s2 * (1 - ckU2))
          c.save()
          if (ckCol) {
            c.strokeStyle = 'rgba(' + ckCol[0] + ',' + ckCol[1] + ',' + ckCol[2] + ',' + ckA + ')'
            c.lineWidth = ckLw
            c.beginPath(); c.arc(ckAx, ckAy, ckR, 0, Math.PI * 2); c.stroke()
            // thin white outline so accent colors read on dark content too
            c.strokeStyle = 'rgba(255,255,255,' + ckA * 0.5 + ')'
            c.lineWidth = Math.max(1, s2)
            c.beginPath(); c.arc(ckAx, ckAy, ckR + ckLw * 0.8, 0, Math.PI * 2); c.stroke()
          } else {
            // auto: the cursor dot's dual-stroke trick — dark rim under a
            // white ring, legible on any content
            c.strokeStyle = 'rgba(0,0,0,' + ckA * 0.35 + ')'
            c.lineWidth = ckLw + 2 * s2
            c.beginPath(); c.arc(ckAx, ckAy, ckR, 0, Math.PI * 2); c.stroke()
            c.strokeStyle = 'rgba(255,255,255,' + ckA + ')'
            c.lineWidth = ckLw
            c.beginPath(); c.arc(ckAx, ckAy, ckR, 0, Math.PI * 2); c.stroke()
          }
          c.restore()
        }
      } else if (ckStyle === 'pulse') {
        // soft filled orb: parabola opacity (in fast, out soft), cubic-out bloom
        var ckU3 = (t - (ck.ot - ckPre)) / ckPD
        if (ckU3 >= 0 && ckU3 <= 1) {
          var ckE3 = 1 - (1 - ckU3) * (1 - ckU3) * (1 - ckU3)
          var ckR3 = Math.max(1, 34 * s2 * ckK * (0.35 + 0.65 * ckE3))
          var ckA3 = Math.min(1, 4 * ckU3 * (1 - ckU3) * 0.45 * ckK)
          var ckC3 = ckCol ? ckCol[0] + ',' + ckCol[1] + ',' + ckCol[2] : '255,255,255'
          var ckG = c.createRadialGradient(ckAx, ckAy, 0, ckAx, ckAy, ckR3)
          ckG.addColorStop(0, 'rgba(' + ckC3 + ',' + ckA3 + ')')
          ckG.addColorStop(1, 'rgba(' + ckC3 + ',0)')
          c.save()
          c.fillStyle = ckG
          c.beginPath(); c.arc(ckAx, ckAy, ckR3, 0, Math.PI * 2); c.fill()
          c.restore()
        }
      } else if (ckStyle === 'highlight') {
        // element glow (unique to DOM capture): rounded-rect around the
        // clicked element's rect — fast smoothstep in, hold while pressed,
        // quadratic fade after release
        var ckIn = (t - (ck.ot - ckPre)) / 0.08
        if (ckIn > 0) {
          if (ckIn > 1) ckIn = 1
          ckIn = ckIn * ckIn * (3 - 2 * ckIn)
          var ckOut = 1
          if (t > ck.up) {
            var ckV2 = (t - ck.up) / ${CLICK_HIGHLIGHT_FADE}
            ckOut = ckV2 >= 1 ? 0 : (1 - ckV2) * (1 - ckV2)
          }
          var ckA4 = Math.min(1, ckIn * ckOut * 0.9 * ckK)
          if (ckA4 > 0.004) {
            var ckRX = dx + (ck.r[0] / (space.w || vw)) * dw
            var ckRY = dy + (ck.r[1] / (space.h || vh)) * dh
            var ckRW = (ck.r[2] / (space.w || vw)) * dw
            var ckRH = (ck.r[3] / (space.h || vh)) * dh
            var ckRad = Math.min(10 * s2, ckRH / 2)
            var ckC4 = ckCol ? ckCol[0] + ',' + ckCol[1] + ',' + ckCol[2] : '255,255,255'
            c.save()
            // dark rim under the glowing stroke — legible on light content too
            c.strokeStyle = 'rgba(0,0,0,' + ckA4 * 0.35 + ')'
            c.lineWidth = 4 * s2
            rr(ckRX, ckRY, ckRW, ckRH, ckRad); c.stroke()
            c.shadowColor = 'rgba(' + ckC4 + ',' + ckA4 * 0.4 + ')'
            c.shadowBlur = 12 * s2
            c.strokeStyle = 'rgba(' + ckC4 + ',' + ckA4 + ')'
            c.lineWidth = 2 * s2
            rr(ckRX, ckRY, ckRW, ckRH, ckRad); c.stroke()
            c.restore()
          }
        }
      }
    }
  }

  // cursor (SOURCE-anchored samples, read at the on-screen source moment).
  // The dot is the only thing cursorStyle.visible hides — the track still drives
  // cursor-follow zoom, and click effects draw above on their own switch.
  // Undefined reads as visible so pre-toggle docs are unchanged.
  var cur = d.cursor || []
  if (cur.length && !(d.cursorStyle && d.cursorStyle.visible === false)) {
    var px = cur[0].x, py = cur[0].y
    for (var j = 0; j < cur.length; j++) { if (cur[j].t <= srcT) { px = cur[j].x; py = cur[j].y } }
    var ax = dx + (px / (space.w || vw)) * dw
    var ay = dy + (py / (space.h || vh)) * dh
    // Idle fade: a sparse SOURCE-time opacity curve baked by cursorIdleFade.
    // Linear between keys — opacity needs no easing, and the ramps are already
    // shaped by where the keys sit. Absent/empty = the cursor never dwells.
    var cuA = 1, cuK = d.cursorFade
    if (cuK && cuK.length) {
      if (srcT <= cuK[0].t) cuA = cuK[0].a
      else if (srcT >= cuK[cuK.length - 1].t) cuA = cuK[cuK.length - 1].a
      else {
        for (var cuJ = 1; cuJ < cuK.length; cuJ++) {
          if (cuK[cuJ].t >= srcT) {
            var cuB = cuK[cuJ - 1], cuC = cuK[cuJ]
            cuA = cuB.a + (cuC.a - cuB.a) * ((srcT - cuB.t) / ((cuC.t - cuB.t) || 1))
            break
          }
        }
      }
    }
    if (cuA > 0.01) {
      c.save()
      c.fillStyle = 'rgba(255,255,255,' + (0.95 * cuA) + ')'
      c.strokeStyle = 'rgba(0,0,0,' + (0.4 * cuA) + ')'
      c.lineWidth = 2 * s2
      c.beginPath(); c.arc(ax, ay, curSize * ckPress, 0, Math.PI * 2); c.fill(); c.stroke()
      c.restore()
    }
  }
  if (fitCover) c.restore()
  c.restore()

  // --- OVERLAY layer (screen-space plane, never tilts): the cam bubble, the
  // recording's own footage. Text/image/video overlay CLIPS are the studio
  // stack entry's (studioEntry.ts): they paint on their own layer in
  // ctx.overlayScene, above this one. Painted to ovC (its own canvas at
  // runtime; the card c2d under stubs). Redraw + re-upload only while the
  // bubble is active (a video → every frame), on resize, or once when it turns
  // off (to clear) — so a cam-less take never uploads the overlay after frame 1.
  var camV = r.cam, camS = d.cam || {}
  var camOn = !camS.window || (srcT >= camS.window.in && srcT <= camS.window.out)
  // Readiness is STICKY: readyState drops to HAVE_METADATA while a seek is in
  // flight, so gating each frame on it makes the bubble vanish on every scrub
  // step (the screen video is drawn ungated and just shows its retained frame).
  // Wait only for the FIRST decoded frame, then keep drawing through seeks.
  if (camV && camV.readyState >= 2) r.camHasFrame = true
  var camActiveNow = !!(camV && camOn && camS.visible !== false && r.camHasFrame)
  var ovSig = W + 'x' + H
  var ovDirty = ov.sig !== ovSig || camActiveNow || ov.active
  if (ovDirty) {
  ovC.clearRect(0, 0, W, H)
  // webcam bubble — pinned to the frame corner regardless of card tilt/zoom.
  if (camActiveNow) {
    // Cam pose track: [x, y, size] frame fractions sampled at t — wins
    // over the static pose while spans exist. camPoseOverride is ephemeral
    // editor state (the zoomSuppressed seam): the selected span's settled
    // pose while paused, merged by the host, never persisted.
    var camP = d.camPoseOverride || null
    var camTk = d.camTrack
    if (!camP && camTk && camTk.keyframes && camTk.keyframes.length) camP = TL.sample(camTk, t, TL.lerpArray)
    var diam = Math.max(40, (camP ? camP[2] : (camS.size || 0.25)) * H)
    var mg = 24 * s
    var pos = camS.position || 'bottom-left'
    // Free placement: x/y are the bubble CENTER as frame fractions and
    // win over the corner anchor when present; a sampled pose wins over both.
    var bx = camP ? camP[0] * W - diam / 2 : camS.x != null ? camS.x * W - diam / 2 : pos.indexOf('right') >= 0 ? W - mg - diam : mg
    var by = camP ? camP[1] * H - diam / 2 : camS.y != null ? camS.y * H - diam / 2 : pos.indexOf('top') >= 0 ? mg : H - mg - diam
    // The bubble's look is three knobs with the old paint as every default
    // (decided 2026-08-24: the defaults must stay editable): radius
    // (rounded only, 18), shadow ('soft'), border (3px white at 0.9).
    var rd = camS.shape === 'rounded' ? (camS.radius != null ? camS.radius : 18) * s : diam / 2
    var cw = camV.videoWidth || 16, ch = camV.videoHeight || 9
    var sc2 = Math.max(diam / cw, diam / ch)
    var sw = cw * sc2, sh = ch * sc2
    var sx = bx + (diam - sw) / 2, sy = by + (diam - sh) / 2
    var camShadow = camS.shadow || 'soft'
    if (camShadow !== 'none') {
      ovC.save()
      ovC.shadowColor = camShadow === 'strong' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.4)'
      ovC.shadowBlur = (camShadow === 'strong' ? 60 : 30) * s
      ovC.shadowOffsetY = (camShadow === 'strong' ? 20 : 10) * s
      ovC.fillStyle = '#000'
      rr(bx, by, diam, diam, rd, ovC); ovC.fill()
      ovC.restore()
    }
    ovC.save()
    rr(bx, by, diam, diam, rd, ovC); ovC.clip()
    if (camS.mirror) { ovC.translate(bx * 2 + diam, 0); ovC.scale(-1, 1) } // mirror about bubble center
    try { ovC.drawImage(camV, sx, sy, sw, sh) } catch (e) {}
    ovC.restore()
    var camBW = camS.border ? camS.border.width : 3
    if (camBW > 0) {
      ovC.save()
      ovC.strokeStyle = (camS.border && camS.border.color) || 'rgba(255,255,255,0.9)'; ovC.lineWidth = camBW * s
      rr(bx, by, diam, diam, rd, ovC); ovC.stroke()
      ovC.restore()
    }
  }
  ov.sig = ovSig
  ov.active = camActiveNow
  if (ov.texture) ov.texture.needsUpdate = true
  }

  // --- card presentation (compositor v2): the card's pose is the TILT
  // TRACK and nothing else (decided 2026-08-03 — a lean is a moment in time,
  // so it lives on the timeline; the static rest pose, entrance, exit, float
  // and glow are gone with the Card panel). No spans ⇒ no track ⇒ identity,
  // which is pixel-identical to the pre-v2 fullscreen quad. Mipmaps and
  // anisotropy switch on when the card actually tilts (minification would
  // otherwise shimmer). d.tiltSuppressed is pure editor ui state (the
  // zoomSuppressed seam): on-canvas edit overlays mirror UNtilted card
  // geometry, so edit views need the flat card.
  if (card.mesh) {
    var rx = 0, ry = 0
    var tk = d.tiltTrack
    if (tk && tk.keyframes && tk.keyframes.length && !d.tiltSuppressed) {
      var tkv = TL.sample(tk, t, TL.lerpArray)
      rx = tkv[0] * Math.PI / 180
      ry = tkv[1] * Math.PI / 180
    }
    card.mesh.rotation.x = rx
    card.mesh.rotation.y = ry
    // The card's pose through an entrance or an end card: [scale, dy,
    // opacity]; absent = the rest pose, exactly as before the track existed.
    var cpk = d.cardPoseTrack
    var cpH = card.mesh.geometry && card.mesh.geometry.parameters ? card.mesh.geometry.parameters.height : 0
    if (cpk && cpk.keyframes && cpk.keyframes.length && card.mesh.scale && card.mesh.position) {
      var cpv = TL.sample(cpk, t, TL.lerpArray)
      card.mesh.scale.x = cpv[0]; card.mesh.scale.y = cpv[0]
      card.mesh.position.y = cpv[1] * cpH
      if (card.mesh.material) card.mesh.material.opacity = cpv[2]
    } else if (card.mesh.scale && card.mesh.position && ((card.mesh.scale.x !== undefined && card.mesh.scale.x !== 1) || (card.mesh.position.y !== undefined && card.mesh.position.y !== 0))) {
      card.mesh.scale.x = 1; card.mesh.scale.y = 1
      card.mesh.position.y = 0
      if (card.mesh.material) card.mesh.material.opacity = 1
    }
    var tilted = rx * rx + ry * ry > 1e-6
    if (card.texture && card.texture.generateMipmaps !== tilted) {
      var THREE2 = ctx.THREE
      card.texture.generateMipmaps = tilted
      card.texture.minFilter = tilted && THREE2 ? THREE2.LinearMipmapLinearFilter : (THREE2 ? THREE2.LinearFilter : card.texture.minFilter)
      if (tilted && ctx.renderer && ctx.renderer.capabilities && card.texture.anisotropy !== undefined) {
        card.texture.anisotropy = ctx.renderer.capabilities.getMaxAnisotropy ? ctx.renderer.capabilities.getMaxAnisotropy() : 1
      }
      card.texture.needsUpdate = true
    }
  }

  // The card layer redraws every frame (dynamic content); bg/overlay uploads are
  // gated inside their blocks (dirty-tracking above).
  if (card.texture) card.texture.needsUpdate = true

  // verification hook (no-op unless the harness sets window.__VOILA_DEBUG__).
  // cv = the CARD 2D canvas; bgCv/ovCv are the background/overlay layers (v2).
  if (typeof window !== 'undefined' && window.__VOILA_DEBUG__) {
    window.__voilaDebug = { cv: cv, bgCv: bg.canvas, ovCv: ov.canvas, W: W, H: H, glW: gl && gl.width, glH: gl && gl.height, t: t, canvases: document.querySelectorAll('canvas').length }
  }
}`

/**
 * The shared layers as the studio entry's data: overlay clips (presets resolved
 * to plain values HERE, ON_FRAME reads no registry), 3D props (numbers resolved
 * HERE), the extra font faces SETUP awaits. Every key is omitted when its layer
 * is absent — data byte parity for docs that never touched it. Both anchors
 * call this with their own output duration.
 */
export function studioLayerData(
  layers: {
    overlays?: OverlayClip[]
    objects?: ObjectClip[]
    audio?: AudioClip[]
  },
  duration: number,
): Record<string, unknown> {
  return {
    // Music/SFX clips with their gain envelopes baked (shared truth for the
    // preview scheduler and the export's offline mix). `duckEnv` (the mic-derived
    // duck multiplier curve) is merged in asynchronously by useComposition — it
    // needs a decoded recording, which a sync lowering can't produce.
    audio: (layers.audio ?? []).map((c) => ({
      key: c.key,
      start: round(c.start),
      in: round(c.in),
      out: round(c.out),
      gain: round(c.gain),
      loop: !!c.loop,
      len: round(clipLength(c)),
      duck: !!c.duck,
      env: clipEnvelope(c).map((p) => ({ t: round(p.t), g: round(p.g) })),
    })),
    // Object clips: numbers resolved HERE; shapes are the drafted engine spec.
    ...(layers.objects && layers.objects.length
      ? {
          objects: layers.objects.map((o) => ({
            id: o.id,
            asset:
              o.asset.kind === 'primitive'
                ? {
                    kind: 'primitive',
                    shape: o.asset.shape,
                    color: o.asset.color ?? '#e4e4e7',
                  }
                : o.asset.kind === 'text3d'
                  ? resolveText3dAsset(o.asset)
                  : { kind: 'gltf', key: o.asset.key },
            ...(o.span
              ? {
                  span: {
                    start: round(o.span.start),
                    duration: round(o.span.duration),
                  },
                }
              : {}),
            x: round(o.transform3d.x),
            y: round(o.transform3d.y),
            z: round(o.transform3d.z),
            rx: round(o.transform3d.rx),
            ry: round(o.transform3d.ry),
            rz: round(o.transform3d.rz),
            scale: round(o.transform3d.scale || OBJECT_DEFAULT_SCALE),
            anim: o.animation ?? null,
            // Pose keyframes: clip-local [x,y,z,rx,ry,rz,scale] track,
            // sampled at t − span.start. Omitted when absent — parity.
            ...(() => {
              if (!o.motion || !o.motion.length) return {}
              const mb = objectMotionBase(o)
              const track = motionTrack(
                mb,
                objectMotionKeys(o, mb),
                o.span?.duration ?? duration,
              )
              return track.keyframes.length ? { track } : {}
            })(),
          })),
        }
      : {}),
    // Text overlays: presets resolved to plain values HERE (ON_FRAME reads
    // no registry). Omitted when absent/empty — byte parity for docs without them.
    // Full face list for SETUP's cold-load await (export parity). Baked only
    // when overrides add faces beyond the base three — old-doc data parity;
    // SETUP falls back to the base literal.
    ...(layers.overlays &&
    overlayFontFaces(layers).length > OVERLAY_FONT_FACES.length
      ? { overlayFonts: overlayFontFaces(layers) }
      : {}),
    ...(layers.overlays && layers.overlays.length
      ? {
          overlays: layers.overlays.map((o) => {
            const base = {
              id: o.id,
              kind: o.kind,
              start: round(o.start),
              dur: round(Math.max(OVERLAY_MIN_DURATION, o.duration)),
              x: round(o.transform.x),
              y: round(o.transform.y),
              scale: round(o.transform.scale || 1),
              rot: round(o.transform.rotation || 0),
              enter: o.enter ?? 'rise',
              exit: o.exit ?? 'fade',
              // Pose keyframes: a CLIP-LOCAL [x, y, scale, rot, opacity]
              // track, sampled in ON_FRAME at t − start. Omitted when the clip
              // has no motion — data byte parity.
              ...(() => {
                if (!o.motion || !o.motion.length) return {}
                const mb = overlayMotionBase(o)
                const track = motionTrack(
                  mb,
                  overlayMotionKeys(o, mb),
                  Math.max(OVERLAY_MIN_DURATION, o.duration),
                )
                return track.keyframes.length ? { track } : {}
              })(),
            }
            if (o.kind !== 'text') {
              // Media overlay: sized by frame-width fraction; corners in design
              // px; video time is clip-local (ON_FRAME seeks el to t − start).
              return {
                ...base,
                key: o.key,
                w: round(o.width ?? OVERLAY_MEDIA_DEFAULT_WIDTH),
                radius: o.radius ?? OVERLAY_MEDIA_DEFAULT_RADIUS,
                opacity: o.opacity ?? 1,
                loop: !!o.loop,
                // Emitted only when SET, so a doc without the
                // fields lowers byte-identically (ON_FRAME defaults absent
                // shadow to 'soft' — the baked look docs predating the field render).
                ...(o.shadow ? { shadow: o.shadow } : {}),
                ...(o.border && o.border.width > 0
                  ? {
                      border: {
                        width: round(o.border.width),
                        color: o.border.color,
                      },
                    }
                  : {}),
              }
            }
            const st = resolveOverlayStyle(o)
            const bx = resolveOverlayBox(o)
            return {
              ...base,
              text: o.text,
              lines: overlayLines(o.text),
              fs: st.size,
              weight: st.weight,
              stack: st.stack,
              color: st.color,
              shadow: st.shadow,
              // Style-v2 fields bake only when non-default (byte parity for
              // older docs); ON_FRAME reads them unconditionally.
              ...(st.fontStyle === 'italic' ? { sty: 'italic' } : {}),
              ...(o.maxWidth ? { mw: round(o.maxWidth) } : {}),
              ...(st.letterSpacing ? { ls: round(st.letterSpacing) } : {}),
              ...(st.lineHeight !== OVERLAY_LINE_HEIGHT
                ? { lh: round(st.lineHeight) }
                : {}),
              ...(st.align !== 'center' ? { align: st.align } : {}),
              ...(st.stroke
                ? { stroke: { c: st.stroke.color, w: round(st.stroke.width) } }
                : {}),
              // Hosted face behind an override: ON_FRAME lazy-loads it so a
              // live family/weight edit paints without a LOAD (SETUP only
              // runs on cold load).
              ...(() => {
                const face = overlayFaceFor(o)
                return face
                  ? { face: { f: face.family, w: face.weight, u: face.url } }
                  : {}
              })(),
              // Background pill, resolved to design px at fs (absent = none;
              // conditional spread keeps box-less docs' data byte-identical).
              ...(bx
                ? {
                    box: {
                      c: bx.color,
                      o: round(bx.opacity),
                      px: round(bx.padX),
                      py: round(bx.padY),
                      r: round(bx.radius),
                    },
                  }
                : {}),
              // Entrance animation: segmentation + timing normalized
              // HERE (deterministic doc-derived data) — ON_FRAME interprets
              // per-unit progress as pure f(t). Absent = data byte parity.
              ...(() => {
                const olFx = resolveOverlayFx(
                  o,
                  Math.max(OVERLAY_MIN_DURATION, o.duration),
                )
                return olFx ? { fx: olFx } : {}
              })(),
            }
          }),
        }
      : {}),
  }
}

export function lowerToComposition(input: ProjectDoc): LoweredComposition {
  // The end card expands first: it adds a hold and three overlays, and the
  // hold changes the duration every track below is laid out against.
  const before = durationSec(input, ratedSegments(input))
  const expanded = expandEndCard(input, before)
  const doc = expanded.doc
  const rated = ratedSegments(doc)
  const duration = durationSec(doc, rated)
  // clickSnap only when effects are on, so an effects-off doc's path (and its
  // lowered data) stays byte-identical to the pre-click-effects lowering.
  const fx = doc.cursor.clickFx
  const smoothed = smoothCursor(doc.source.cursor, {
    factor: doc.cursor.smoothing,
    clickSnap: fx.style !== 'none' || fx.press,
  })
  // Idle fade (SOURCE-anchored, so trims/cuts/speed inherit it). Skipped when
  // the dot is hidden outright, and empty when nothing dwells long enough —
  // either way no `cursorFade` key is emitted and the data stays as it was.
  const cursorFade =
    doc.cursor.hideWhenIdle !== false && doc.cursor.visible !== false
      ? cursorIdleFade(doc.source.cursor, {
          space: { w: doc.source.meta.width, h: doc.source.meta.height },
          sourceDuration: (doc.source.meta.durationMs || 0) / 1000,
        })
      : []
  // Clamp each span's focus so the zoomed card always covers the canvas —
  // focusBounds is the same function the aiming overlay/inspector uses, so what
  // the editor shows and what renders can't disagree. Auto-focus spans get
  // their entry focus + dead-zone recenters baked from the cursor track
  // (followFocusEvents clamps internally).
  const layout = docCardLayout(doc)
  const meta = doc.source.meta
  const zoomStyle = resolveZoomStyle(doc.zoomStyle, doc.zoomParams)
  const zoomSpans: LoweredZoomSpan[] = doc.zoom.map((z) => {
    if (z.focusMode === 'auto') {
      const f = followFocusEvents(
        z,
        doc.source.cursor,
        { w: meta.width, h: meta.height },
        layout,
        {
          safeRatio: zoomStyle.followSafeRatio,
          recenter: zoomStyle.followRecenter,
          lookahead: zoomStyle.followLookahead,
        },
      )
      if (f.entry)
        return { ...z, cx: f.entry.cx, cy: f.entry.cy, followEvents: f.events }
    }
    return { ...z, ...clampFocus(z.cx, z.cy, clampZoomLevel(z.level), layout) }
  })

  const data = {
    videoSrc: doc.source.videoKey,
    isImage: doc.source.sourceKind === 'image',
    // Viewport crop for window takes (drawImage source rect; null = full frame).
    crop: doc.source.crop ?? null,
    camSrc: doc.source.camKey ?? null,
    cam: doc.cam,
    // Cam pose spans: OUTPUT-time [x, y, size] fraction track built at
    // the doc's design layout (fractions are aspect-stable, so the track holds
    // at any render size). Omitted when the doc has no spans or no cam track —
    // byte parity with pre-MO docs.
    ...(doc.camMotion && doc.camMotion.length && doc.source.camKey
      ? {
          camTrack: camTrackFromDoc(doc.cam, doc.camMotion, rated, layout.W),
        }
      : {}),
    // Mic sidecar (AT split) — conditional spread keeps legacy docs' data
    // byte-identical; ON_FRAME reads both keys guarded.
    ...(doc.source.micKey
      ? { micSrc: doc.source.micKey, sysGain: doc.systemGain ?? 1 }
      : {}),
    hasAudio: !!doc.source.meta.hasAudio,
    duration,
    // Rated segments (speed spans pre-intersected): ON_FRAME's mapTime and the
    // export's audio splice read the rate straight off each segment.
    segments: rated.map((seg) => ({
      in: round(seg.in),
      out: round(seg.out),
      ...(seg.rate !== undefined && seg.rate !== 1
        ? { rate: round(seg.rate) }
        : {}),
    })),
    frame: doc.frame,
    micGain: doc.micGain ?? 1,
    cursor: smoothed.map((p) => ({
      t: round(p.t),
      x: round(p.x),
      y: round(p.y),
    })),
    cursorStyle: doc.cursor,
    cursorSpace: { w: doc.source.meta.width, h: doc.source.meta.height },
    ...(cursorFade.length ? { cursorFade } : {}),
    // Click effects: OUTPUT-anchored click records + resolved styling (named
    // intensities/colors become numbers HERE — ON_FRAME reads no registry).
    ...clickFxData(doc, rated),
    // Rated segments so zoom spans land at their speed-adjusted output times.
    // A pull-out entrance writes the track's head.
    zoomTrack: prependEntrance(
      zoomTrackFromDoc(zoomSpans, rated, zoomStyle),
      entranceZoomKeyframes(doc.frame.entrance),
    ),
    // Tilt spans: OUTPUT-time [rx, ry] degree track. The rest pose is
    // FLAT — there is no static card tilt any more — and the motion constants
    // come from the camera style's tilt personality ('drift' slows its
    // leans, 'keynote' matches the zoom ramps). Omitted when the doc has no
    // spans and no tilt-in entrance — byte parity. The entrance is a
    // producer of this track, never a second pose.
    ...(() => {
      const head = entranceTiltKeyframes(doc.frame.entrance)
      const spans =
        doc.tilt && doc.tilt.length
          ? tiltTrackFromDoc(doc.tilt, rated, zoomStyle.tilt)
          : undefined
      const track = prependEntrance(spans, head)
      return track ? { tiltTrack: track } : {}
    })(),
    // The card's pose through the entrance and the end card: [scale, dy,
    // opacity] in output seconds. Absent when neither exists.
    ...(() => {
      const track = cardPoseTrack(
        doc.frame.entrance,
        expanded.endStart,
        expanded.seconds,
      )
      return track ? { cardPoseTrack: track } : {}
    })(),
  }

  // The studio stack entry's OWN ctx.data (E0): the shared layers. The
  // recording anchor lights its props itself (`lights`); a program anchor's
  // entry carries no lights, its scene has its own.
  const entryData: Record<string, unknown> = {
    lights: true,
    ...studioLayerData(doc, duration),
  }

  const config: Record<string, unknown> = {
    version: 2,
    // Placeholder — the carrier timeline reads ctx.data.duration, so the program
    // string stays constant across trims (see the interpreter-pattern note above).
    duration: PROGRAM_DURATION,
    // Compositor v2: a perspective camera so the world-space card plane can
    // TILT with real foreshortening. Every layer plane is sized to fill this
    // frustum (stage.ts), so tilt = 0 projects pixel-identically to the pre-v2
    // ortho 'fullscreen' quad. Camera sits at the origin looking down −z.
    camera: {
      preset: 'perspective',
      fov: CARD_FOV,
      near: CAMERA_NEAR,
      far: CAMERA_FAR,
    },
    data,
    setup: SETUP,
    createContent: CREATE_CONTENT,
    createTimeline: CREATE_TIMELINE,
    onFrame: ON_FRAME,
    stack: [studioEntry(entryData)],
  }

  return { config, data, stack: { [STUDIO_ENTRY_ID]: entryData }, duration }
}

/**
 * Click-effect slice of ctx.data: extracted OUTPUT-anchored clicks + the
 * doc's named style resolved to numbers (k/dur multipliers, [r,g,b] color).
 * With effects fully off the click list is skipped so the doc lowers as light
 * as before the feature.
 */
function clickFxData(doc: ProjectDoc, rated: Segment[]) {
  const fx = doc.cursor.clickFx
  const on = fx.style !== 'none' || fx.press
  const meta = doc.source.meta
  const level = CLICK_FX_INTENSITY[fx.intensity]
  return {
    clicks: on
      ? extractClicks(doc.source.cursor, rated, {
          rects: fx.style === 'highlight',
          space: { w: meta.width, h: meta.height },
        })
      : [],
    clickFx: {
      style: fx.style,
      press: fx.press,
      k: level.k,
      dur: level.dur,
      col: fx.color === 'auto' ? 0 : (hexToRgbTriplet(fx.color) ?? 0),
    },
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}
