/**
 * Artifact → ProjectDoc ingest — the seam every recorder (extension, CLI)
 * funnels through. Moved from the web app so non-browser producers (the vos
 * CLI) run the exact same ingest as the studio.
 */
import {
  DEFAULT_CAM_STYLE,
  DEFAULT_CURSOR_STYLE,
  DEFAULT_FRAME_STYLE,
  pageDisplayUrl,
  platformBarKind,
} from './types'
import {
  CAPTURE_COVERAGE_MIN,
  WINDOW_FOCUS_MIN,
  normalizeCaptureSpace,
} from './capture'
import type { ProjectDoc, RecordingArtifact } from './types'

/** Build a ProjectDoc from a RecordingArtifact handed off by a recorder. */
export function projectFromArtifact(
  artifact: RecordingArtifact,
  videoUrl: string,
): { doc: ProjectDoc; videoUrl: string } {
  // Window/monitor takes: map cursor events into capture px (normalizeCaptureSpace);
  // low coverage means the user shared a surface other than the one hosting the
  // recorded tab (or the mapping anchors are unusable) — drop the track rather
  // than draw the cursor at wrong positions. A window that moved mid-take
  // invalidates its anchor the same way.
  const surface = artifact.meta.captureSurface ?? 'tab'
  const norm = normalizeCaptureSpace(artifact.cursor, artifact.meta)
  const { cursor, meta } = norm
  // Entire-screen takes: the cursor is only trackable INSIDE browser pages —
  // the moment the pointer leaves the browser (other apps, desktop, dock) the
  // track goes blind while the video keeps showing the real cursor, so the
  // synthetic cursor/zoom would be wrong for exactly the footage people record
  // screens for. Policy: no cursor effects for monitor takes (the record page
  // says so up front).
  // Wrong-window tell: cursor events come from the recorded tab, so their
  // geometry is self-consistent even when a DIFFERENT window was shared —
  // coverage can't catch it. A browser window that was unfocused for most of
  // the take means the user was driving another window (the one they shared).
  const unfocused =
    surface === 'window' &&
    (artifact.meta.windowFocusedFrac ?? 1) < WINDOW_FOCUS_MIN
  const coverage =
    surface === 'monitor' || artifact.meta.windowMovedDuringTake || unfocused
      ? 0
      : norm.coverage
  if (artifact.cursor.length > 0 && coverage < CAPTURE_COVERAGE_MIN) {
    console.warn(
      '[voila/studio] dropping cursor track —',
      surface === 'monitor'
        ? 'entire-screen takes have no cursor effects (untrackable outside browser pages)'
        : artifact.meta.windowMovedDuringTake
          ? 'window moved/resized during the take'
          : unfocused
            ? `browser window focused only ${Math.round((artifact.meta.windowFocusedFrac ?? 0) * 100)}% of the take — a different window was likely shared`
            : `coverage ${norm.coverage.toFixed(2)} (wrong surface shared, or unusable capture geometry)`,
    )
  }
  const doc: ProjectDoc = {
    source: {
      videoKey: videoUrl,
      cursor: coverage >= CAPTURE_COVERAGE_MIN ? cursor : [],
      meta,
      camKey: artifact.camKey,
      micKey: artifact.audioKey,
      // Tab takes are known-good MP4 → frame-accurate WebCodecs. Display takes
      // encode WebM (surface resizes break MP4) → robust HTMLVideoElement path.
      // CLI takes encode WebM too — same robust path.
      frameSource:
        surface === 'tab' && artifact.meta.producer !== 'cli'
          ? 'webcodecs'
          : 'html5',
      // Window takes with clean geometry: crop the real browser chrome out of the
      // footage (cursor/meta are already in crop space — see normalizeCaptureSpace).
      crop: norm.crop,
      // Keep the derivation + full capture dims so the "Original" frame mode can
      // remap the doc between crop/full space losslessly (docToFullSpace).
      chromeCrop: norm.crop
        ? {
            rect: norm.crop,
            frameW: artifact.meta.captureWidth ?? artifact.meta.width,
            frameH: artifact.meta.captureHeight ?? artifact.meta.height,
          }
        : undefined,
    },
    segments: [{ in: 0, out: artifact.meta.durationMs / 1000 }], // canonical full-source span
    zoom: [], // planner runs once the doc is loaded (editor) or planned (CLI)
    audio: [],
    cursor: { ...DEFAULT_CURSOR_STYLE },
    cam: { ...DEFAULT_CAM_STYLE },
    frame: {
      ...DEFAULT_FRAME_STYLE,
      browserBar: {
        ...DEFAULT_FRAME_STYLE.browserBar,
        // Chrome-free footage (tab takes, cropped window takes) opens with the
        // OS-matched realistic frame — the Screen-Studio first render; Hidden is
        // one click away. Footage that still contains real chrome gets none.
        kind:
          surface === 'tab' || norm.crop
            ? platformBarKind(artifact.meta.platform)
            : 'none',
        // Pre-fill the address pill from the recorded page.
        url: pageDisplayUrl(artifact.meta.pageUrl),
      },
    },
    export: { resolution: '1080p', fps: 30, format: 'mp4' },
  }
  return { doc, videoUrl }
}
