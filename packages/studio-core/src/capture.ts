/**
 * Capture-space normalization — the single seam that makes window/monitor
 * recordings look like tab recordings to everything downstream.
 *
 * Tab captures record the viewport, so CursorEvent.x/y (viewport CSS px) IS the
 * cursor space and meta.width/height describes it. For window/monitor captures
 * the viewport is only part of the frame, so events are mapped into capture
 * pixels here — once, at doc-build time — using each event's screen coords
 * (sx/sy) and the geometry sampled at record start. After normalization the
 * planner, lowering, and composition consume the doc unchanged.
 *
 * Window takes additionally get a VIEWPORT CROP when the geometry is clean
 * (deriveViewportCrop): the real browser
 * chrome is cut out of the footage at the drawImage seam, the cursor/meta are
 * rewritten into crop space, and the synthetic browser bar becomes available
 * exactly as on tab takes. Fail-closed: a wrong crop (chrome sliver, cut page
 * edge) reads far worse than no crop, so any geometry doubt → no crop.
 */
import type {
  CursorEvent,
  CursorTrack,
  ProjectDoc,
  RecordingMeta,
  Rect,
} from './types'

export interface CaptureNormalization {
  cursor: CursorTrack
  meta: RecordingMeta
  /**
   * Fraction of mapped events that landed inside the captured frame (1 for tab
   * captures). Low coverage means the user shared a different window/display
   * than the one hosting the recorded tab — the app should skip auto-zoom and
   * cursor overlay rather than render them at wrong positions.
   */
  coverage: number
  /**
   * Window takes with clean geometry: the viewport's rect inside the capture
   * frame (capture px) — the drawImage source crop that removes the real
   * browser chrome. When present, the returned cursor/meta are already in
   * crop space. Absent = render the full frame.
   */
  crop?: Rect
}

/** Plausible top-chrome height (tab strip + toolbar), CSS px. Outside → geometry is lying. */
const CHROME_TOP_MIN = 20
const CHROME_TOP_MAX = 220
/** Event-offset vs window-geometry agreement tolerance, CSS px. */
const CROP_TOLERANCE = 16
/** Minimum agreeing events before the event-derived viewport origin is trusted. */
const CROP_MIN_EVENTS = 3

/**
 * Derive the viewport crop for a window take: where the page viewport sits
 * inside the captured window frame, in capture px.
 *
 * Two independent estimators cross-check each other:
 * 1. event-derived (primary): each event's own viewport→screen offset
 *    (sx − x, sy − y) — exact wherever the chrome actually is, but needs events;
 * 2. window-derived: windowRect vs meta.viewport under the chrome-on-top
 *    assumption (side insets split evenly) — no events needed, but wrong for
 *    docked devtools / exotic decorations.
 *
 * Only offsets agreeing with (2) are kept — this simultaneously validates the
 * chrome-on-top assumption AND rejects cross-origin-iframe events, whose
 * offsets are the IFRAME's origin, not the top viewport's. Returns null
 * (no crop) on any doubt — see the fail-closed matrix in the analysis doc.
 */
export function deriveViewportCrop(
  cursor: CursorTrack,
  meta: RecordingMeta,
): Rect | null {
  if ((meta.captureSurface ?? 'tab') !== 'window') return null
  const win = meta.windowRect
  const vp = meta.viewport
  const capW = meta.captureWidth ?? 0
  const capH = meta.captureHeight ?? 0
  if (
    !win ||
    !vp ||
    win.w <= 0 ||
    win.h <= 0 ||
    vp.w <= 0 ||
    vp.h <= 0 ||
    capW <= 0 ||
    capH <= 0
  )
    return null
  // Any mid-take geometry drift invalidates the single static crop.
  if (
    meta.windowMovedDuringTake ||
    meta.viewportChangedDuringTake ||
    meta.resizedDuringTake
  )
    return null
  // Browser window unfocused for most of the take ⇒ the user was driving a
  // different window — the SHARED surface is probably not this browser window,
  // and the crop would cut unrelated pixels (see windowFocusedFrac).
  if ((meta.windowFocusedFrac ?? 1) < WINDOW_FOCUS_MIN) return null
  // Page zoom breaks CSS px == DIPs for event x/y — deferred (a later fold-in).
  if (Math.abs((meta.zoom || 1) - 1) > 0.001) return null

  const scaleX = capW / win.w
  const scaleY = capH / win.h
  // A clean window capture scales both axes identically; disagreement means the
  // captured surface isn't this window (or the rect is stale).
  if (Math.abs(scaleX / scaleY - 1) > 0.05) return null

  // Window-derived estimate (chrome on top, side insets split evenly).
  const estX = win.x + (win.w - vp.w) / 2
  const estY = win.y + (win.h - vp.h)

  const xs: number[] = []
  const ys: number[] = []
  for (const e of cursor) {
    if (e.sx === undefined || e.sy === undefined) continue
    const ox = e.sx - e.x
    const oy = e.sy - e.y
    if (
      Math.abs(ox - estX) <= CROP_TOLERANCE &&
      Math.abs(oy - estY) <= CROP_TOLERANCE
    ) {
      xs.push(ox)
      ys.push(oy)
    }
  }
  if (xs.length < CROP_MIN_EVENTS) return null
  const vx = median(xs)
  const vy = median(ys)

  const topChrome = vy - win.y
  if (topChrome < CHROME_TOP_MIN || topChrome > CHROME_TOP_MAX) return null

  const crop: Rect = {
    x: Math.round((vx - win.x) * scaleX),
    y: Math.round((vy - win.y) * scaleY),
    w: Math.round(vp.w * scaleX),
    h: Math.round(vp.h * scaleY),
  }
  // Must sit inside the capture (rounding slack only) and be most of it.
  if (
    crop.x < -2 ||
    crop.y < 0 ||
    crop.x + crop.w > capW + 2 ||
    crop.y + crop.h > capH + 2
  )
    return null
  crop.x = Math.max(0, crop.x)
  crop.w = Math.min(crop.w, capW - crop.x)
  crop.h = Math.min(crop.h, capH - crop.y)
  if (crop.w * crop.h < 0.5 * capW * capH) return null
  return crop
}

/**
 * Map a cursor track into the capture's pixel space. Identity for tab captures
 * (or when geometry is missing). For window/monitor captures the returned meta
 * has width/height set to the capture pixel dimensions (the new cursor space)
 * and dpr/zoom reset to 1 — cursor space and video pixels now coincide. When a
 * window take yields a viewport crop, cursor space is the CROPPED frame and
 * meta dims are the crop dims (downstream layout/planner/zoom need no crop
 * awareness — only drawImage reads the rect).
 */
export function normalizeCaptureSpace(
  cursor: CursorTrack,
  meta: RecordingMeta,
): CaptureNormalization {
  const surface = meta.captureSurface ?? 'tab'
  if (surface === 'tab') return { cursor, meta, coverage: 1 }
  const anchor = surface === 'window' ? meta.windowRect : meta.screenRect
  const capW = meta.captureWidth ?? 0
  const capH = meta.captureHeight ?? 0
  if (!anchor || anchor.w <= 0 || anchor.h <= 0 || capW <= 0 || capH <= 0) {
    // A display take we CANNOT map (missing geometry or capture dims — e.g. a
    // recorder that read track settings after the source ended). Never pass the
    // raw viewport-space track through as if it were frame space: the cursor
    // would render at unrelated positions. Report coverage 0 so the app drops
    // the track with its normal notice.
    return { cursor, meta, coverage: 0 }
  }

  // Independent axis scales: outerHeight vs captured height can disagree by a
  // title-bar's worth of chrome, so a single uniform scale would drift.
  const scaleX = capW / anchor.w
  const scaleY = capH / anchor.h

  const crop = deriveViewportCrop(cursor, meta) ?? undefined
  const cropX = crop?.x ?? 0
  const cropY = crop?.y ?? 0
  const frameW = crop?.w ?? capW
  const frameH = crop?.h ?? capH

  let inFrame = 0
  const mapped: CursorEvent[] = []
  for (const e of cursor) {
    if (e.sx === undefined || e.sy === undefined) continue // unmappable (old capture) — drop
    const x = (e.sx - anchor.x) * scaleX - cropX
    const y = (e.sy - anchor.y) * scaleY - cropY
    if (x >= 0 && x <= frameW && y >= 0 && y <= frameH) inFrame++
    // Element rects are viewport-relative; this event's own viewport→screen
    // offset transforms them without any window-geometry guesswork.
    let rect: Rect | undefined
    if (e.rect) {
      const dx = e.sx - e.x
      const dy = e.sy - e.y
      rect = {
        x: (e.rect.x + dx - anchor.x) * scaleX - cropX,
        y: (e.rect.y + dy - anchor.y) * scaleY - cropY,
        w: e.rect.w * scaleX,
        h: e.rect.h * scaleY,
      }
    }
    mapped.push({ ...e, x, y, rect })
  }

  return {
    cursor: mapped,
    meta: {
      ...meta,
      width: frameW,
      height: frameH,
      ...(crop ? { captureWidth: frameW, captureHeight: frameH } : {}),
      dpr: 1,
      zoom: 1,
    },
    coverage: mapped.length ? inFrame / mapped.length : 0,
    crop,
  }
}

/** Coverage below this → treat the cursor track as unusable (skip auto-zoom + overlay). */
export const CAPTURE_COVERAGE_MIN = 0.5

/**
 * Window takes whose browser window was focused for less than this fraction of
 * the take are treated as wrong-window shares: cursor track dropped, no
 * viewport crop (see RecordingMeta.windowFocusedFrac).
 */
export const WINDOW_FOCUS_MIN = 0.5

/**
 * Crop-space ↔ full-space doc remaps — the "Original" frame mode (show the
 * user's real browser chrome on a cropped window take). The footage always
 * holds the full frame, so the toggle is a LOSSLESS coordinate remap of the
 * doc (cursor events/rects, zoom focus points, meta dims) driven by the
 * chromeCrop record kept from ingest — one undoable patch-store edit, program
 * string untouched (everything involved lowers into ctx.data). Time-based
 * state (segments, speed, audio, cam window) is space-independent.
 *
 * Both helpers MUTATE a draft doc (call inside the store's edit()) and are
 * no-ops when the doc is already in the requested space or has no chromeCrop.
 */

/** Remap a crop-space doc to full-capture space (show the original chrome). */
export function docToFullSpace(d: ProjectDoc): void {
  const cc = d.source.chromeCrop
  if (!cc || !d.source.crop) return
  const { rect, frameW, frameH } = cc
  d.source.crop = undefined
  d.source.cursor = d.source.cursor.map((e) => ({
    ...e,
    x: e.x + rect.x,
    y: e.y + rect.y,
    rect: e.rect
      ? { ...e.rect, x: e.rect.x + rect.x, y: e.rect.y + rect.y }
      : undefined,
  }))
  d.source.meta = {
    ...d.source.meta,
    width: frameW,
    height: frameH,
    captureWidth: frameW,
    captureHeight: frameH,
  }
  d.zoom = d.zoom.map((z) => ({
    ...z,
    cx: (rect.x + z.cx * rect.w) / frameW,
    cy: (rect.y + z.cy * rect.h) / frameH,
  }))
}

/** Remap a full-space doc back into crop space (hide the chrome again). */
export function docToCropSpace(d: ProjectDoc): void {
  const cc = d.source.chromeCrop
  if (!cc || d.source.crop) return
  const { rect, frameW, frameH } = cc
  d.source.crop = { ...rect }
  d.source.cursor = d.source.cursor.map((e) => ({
    ...e,
    x: e.x - rect.x,
    y: e.y - rect.y,
    rect: e.rect
      ? { ...e.rect, x: e.rect.x - rect.x, y: e.rect.y - rect.y }
      : undefined,
  }))
  d.source.meta = {
    ...d.source.meta,
    width: rect.w,
    height: rect.h,
    captureWidth: rect.w,
    captureHeight: rect.h,
  }
  // A focus aimed at chrome pixels clamps to the crop edge (the lowering's
  // clampFocus refines against the real card layout).
  d.zoom = d.zoom.map((z) => ({
    ...z,
    cx: clamp01((z.cx * frameW - rect.x) / rect.w),
    cy: clamp01((z.cy * frameH - rect.y) / rect.h),
  }))
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
