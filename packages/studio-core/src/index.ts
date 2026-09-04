/**
 * @vosjs/studio-core — the studio's app-level editing opinions.
 *
 * The generic editing mechanisms (patch store, edit classifier, editor-bridge
 * client, element-edit helpers, timeline view-model) were extracted to the
 * open-source `@vosjs/editor` — import them from there. What remains here is
 * the studio's product IP: the ProjectDoc schema, the element-aware auto-zoom
 * planner + cursor smoothing, the ProjectDoc→composition lowering, and the
 * studio lane adapters. Pure logic — no DOM/UI, no vos-render dependency.
 */
export * from './types'
export {
  CAPTURE_COVERAGE_MIN,
  WINDOW_FOCUS_MIN,
  deriveViewportCrop,
  docToCropSpace,
  docToFullSpace,
  normalizeCaptureSpace,
} from './capture'
export type { CaptureNormalization } from './capture'
export { projectFromArtifact } from './ingest'
export type { IngestOptions } from './ingest'
export { DOC_SCHEMA_VERSION, migrateHostedDoc } from './docVersion'
export { anchorKindOf, isProgramDoc, isRecordingDoc } from './doc/studioDoc'
export type {
  AnchorKind,
  ProgramAnchorDoc,
  ProgramTweenEdit,
  StudioDoc,
} from './doc/studioDoc'
export { smoothCursor } from './planner/smoothing'
export type { SmoothPoint, SmoothOptions } from './planner/smoothing'
export { planAutoZoom } from './planner/autoZoom'
export type { PlanOptions } from './planner/autoZoom'
export {
  TILT_AUTO_DEAD_ZONE,
  TILT_AUTO_MIN,
  planAutoTilt,
} from './planner/autoTilt'
export type { PlanTiltOptions } from './planner/autoTilt'
export {
  DEFAULT_SPEED_PARAMS,
  PLAYBACK_ACTIVITY,
  idleGaps,
  isPlayback,
  planAutoSpeed,
  scrollRuns,
} from './planner/autoSpeed'
export { DRAG_FIT_LEVEL } from './planner/autoZoom'
export type { SpeedParams } from './planner/autoSpeed'
export { momentsFromDoc, planForDigest } from './digest/moments'
export type {
  DigestPlan,
  Moment,
  MomentKind,
  MomentsOptions,
  NormRect,
  TranscriptSegment,
} from './digest/moments'
export { SCENE_MOTION, SCENE_QUIET, sceneChanges } from './digest/scenes'
export { zoomCoversRect, zoomWindow } from './digest/framing'
export type { ZoomWindow } from './digest/framing'
export { STYLE_FIELDS, copyStyle, pickStyle } from './digest/style'
export type { StyleField } from './digest/style'
export {
  CROP_MAX_PX,
  CROP_MIN_FRAC,
  CROP_MIN_PX,
  CROP_PAD,
  DIGEST_CROP_MAX,
  DIGEST_FULL_MAX,
  MOTION_DELTA,
  cropBox,
  expectedFrameSize,
  frameGeometry,
} from './digest/geometry'
export type { FrameGeometry, PxRect } from './digest/geometry'
export { DIGEST_VERSION, buildDigest, outputDurationOf } from './digest/build'
export type {
  BuildDigestInput,
  Digest,
  DigestImageRef,
  DigestTakeFacts,
} from './digest/build'
export {
  outputRangeToSource,
  removeSourceRange,
  removeSpeedInRange,
  setSpeedInRange,
  zoomSpanForRange,
} from './timeline/rangeActions'
export {
  DEFAULT_ZOOM_STYLE,
  ZOOM_STYLES,
  ZOOM_STYLE_OPTIONS,
  resolveZoomStyle,
} from './zoomStyle'
export type {
  TiltPersonality,
  ZoomStyleName,
  ZoomStyleParams,
} from './zoomStyle'
export {
  CAM_CHAIN_GAP,
  CAM_EASE,
  CAM_PAN,
  CAM_PAN_EASE,
  CAM_RAMP_IN,
  CAM_RAMP_OUT,
  TILT_CHAIN_GAP,
  TILT_EASE,
  TILT_PAN,
  TILT_PAN_EASE,
  TILT_RAMP_IN,
  TILT_RAMP_OUT,
  ZOOM_CHAIN_GAP,
  ZOOM_EASE,
  ZOOM_PAN,
  ZOOM_PAN_EASE,
  ZOOM_RAMP_IN,
  ZOOM_RAMP_IN_OVERLAP,
  ZOOM_RAMP_OUT,
  camBubbleRectAt,
  camRectFromPose,
  camRestPose,
  camTrackFromDoc,
  motionTrack,
  objectMotionBase,
  objectMotionPoseAt,
  overlayMotionBase,
  overlayMotionPoseAt,
  lowerToComposition,
  ratedSegments,
  spanOutputExtent,
  tiltTrackFromDoc,
  zoomTrackFromDoc,
} from './lower/lowerToComposition'
export type { LoweredComposition } from './lower/lowerToComposition'
export { studioLayerData } from './lower/lowerToComposition'
export {
  PROGRAM_RETIME,
  lowerProgramDoc,
  lowerStudioDoc,
  programDuration,
  wrapProgramLength,
} from './lower/lowerStudioDoc'
export { anchorSourceDuration } from './doc/studioDoc'
export {
  CHANNEL_SPECS_HASH,
  CHANNEL_SPECS_VERIFIED,
  DESTINATIONS,
  destinationById,
  destinationsForChannel,
} from './destinations'
export type { Destination } from './destinations'
export type { LowerProgramOptions } from './lower/lowerStudioDoc'
export { STUDIO_ENTRY_ID, studioEntry } from './lower/studioEntry'
export { AUDIO_PLAN_STEP, envelopeAt, studioAudioPlan } from './lower/audioPlan'
export type {
  AudioPlanPoint,
  AudioPlanTrack,
  LoweredAudioClip,
  StudioAudioPlan,
} from './lower/audioPlan'
export type { StudioEntry } from './lower/studioEntry'
export type { LoweredZoomSpan } from './lower/lowerToComposition'
export type { MotionKey } from './lower/lowerToComposition'
export {
  camBubbleRect,
  clampFocus,
  computeCardLayout,
  docCardLayout,
  focusBounds,
  levelForFocusFraction,
  recommendedExportResolution,
} from './layout'
export type { CamBubbleRect, CardLayout, FocusBounds } from './layout'
export {
  DARK_GROUND,
  HOUSE_GRADIENT,
  LOOK_KINDS,
  PLATE_GROUND,
  applyLook,
  cardInset,
  houseLook,
  isLookKind,
  lookFromBrand,
  lookKindForGround,
} from './look'
export type { Look, LookBrand, LookKind, LookPlacement } from './look'
export {
  END_CARD_SECONDS,
  ENTRANCE_SECONDS,
  cardPoseTrack,
  entranceSeconds,
  expandEndCard,
  withHolds,
} from './lower/motion'
export {
  BACKGROUND_Z,
  CAMERA_FAR,
  CAMERA_NEAR,
  CARD_FOV,
  CARD_Z,
  OVERLAY_Z,
  cardPointToScreen,
  planeSizeAtDepth,
} from './stage'
export type { PlaneSize } from './stage'
export {
  OVERLAY_FONT_FACES,
  OVERLAY_SIZE_MAX,
  OVERLAY_SIZE_MIN,
  TEXT_PRESETS,
  overlayFaceFor,
  overlayFontFaces,
  overlayFontString,
  overlayHit,
  overlayLines,
  overlayRect,
  resolveOverlayBox,
  resolveOverlayStyle,
} from './overlayText'
export type {
  OverlayFontFace,
  OverlayPresetStyle,
  OverlayRect,
  ResolvedOverlayBox,
  ResolvedOverlayStyle,
} from './overlayText'
export {
  TEXT3D_DEPTH_DEFAULT,
  TEXT3D_DEPTH_MAX,
  TEXT3D_DEPTH_MIN,
  resolveText3dAsset,
} from './text3d'
export type { BakedText3dAsset, BakedText3dMaterial } from './text3d'
export {
  FOLLOW_RECENTER,
  FOLLOW_SAFE_RATIO,
  followFocusEvents,
} from './lower/cursorFollow'
export type { FollowEvent, FollowOptions } from './lower/cursorFollow'
export {
  CURSOR_IDLE_EPS_FRAC,
  CURSOR_IDLE_FADE_IN,
  CURSOR_IDLE_FADE_OUT,
  CURSOR_IDLE_HOLD,
  cursorIdleFade,
} from './lower/cursorIdle'
export type { CursorFadeKey, CursorIdleOptions } from './lower/cursorIdle'
export {
  CLICK_FX_PRE,
  CLICK_HIGHLIGHT_FADE,
  CLICK_PAIR_MAX,
  CLICK_PULSE_DUR,
  CLICK_RECT_MAX_FRAC,
  CLICK_RIPPLE_DUR,
  CLICK_SYNTH_RELEASE,
  extractClicks,
  hexToRgbTriplet,
} from './lower/extractClicks'
export type { ExtractClickOptions, LoweredClick } from './lower/extractClicks'
export {
  audioLane,
  camLane,
  camMoveLane,
  effectiveSegments,
  micLane,
  objectsLane,
  overlaysLane,
  parsePoseId,
  speedLane,
  tiltLane,
  videoLane,
  zoomLane,
} from './timeline/lanes'
export { computePeaks } from './waveform'
export { DEFAULT_DUCK, computeMicRms, duckCurve } from './lower/duckCurve'
export type { DuckOptions, MicRms } from './lower/duckCurve'
export { clipEnvelope, envelopeValueAt } from './lower/audioEnvelope'
export type { EnvelopePoint } from './lower/audioEnvelope'
export {
  docOutputDuration,
  isMusicBed,
  musicBedClip,
  refillAudioBeds,
  voiceKey,
} from './audioBeds'
export type { MusicBedInput } from './audioBeds'

export { backdropMedia, withBackdrop } from './backdrop'
export type { Backdrop } from './backdrop'

export {
  REJECT_OVERLAP,
  isRejected,
  overlapFraction,
  rejectSpan,
  withoutRejected,
} from './rejected'
export type { RejectedLane, RejectedSpan } from './types'
