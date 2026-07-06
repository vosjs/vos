# @vosjs/elements

## 0.3.0

### Minor Changes

- 9e2f189: feat: audio element — `{ type: 'audio', src, gain?, loop?, startTime? }` plays a sound file synced to the master clock. Drive it like an html5 video (set `playing`, animate `currentTime` in createTimeline); playback honors the global pause/seek transport state, and the new animatable `gain` element prop (0-1) maps to volume for fades. Audio elements render no pixels: they carry an invisible mesh, are skipped by editor hit-testing, and report `visible: false` in element rects. Audio files participate in asset preloading (fetched to a blob URL and cached like video).

## 0.2.1

### Patch Changes

- 7d265b8: Harden frame-accurate video: graceful fallback + robust demux.

  - When the WebCodecs path fails (non-MP4 container, unsupported codec, decode
    error), the video element now falls back to the HTMLVideoElement path instead
    of throwing — a black/failed video is never an acceptable outcome. Applies to
    both `frameSource: 'auto'` and `'webcodecs'`.
  - mp4box demux now settles on the track's sample count (or shortly after flush)
    instead of a single microtask, fixing spurious "no samples extracted" when
    mp4box delivers samples across tasks.

## 0.2.0

### Minor Changes

- 2431af7: Add a frame-accurate video source (WebCodecs + mp4box).

  Video elements gain an optional `frameSource: 'auto' | 'webcodecs' | 'html5'`. The
  `webcodecs` path decodes the **exact** frame at the requested presentation time via
  `VideoDecoder` + mp4box (decode-order GOP decode, output selected by PTS — correct
  for B-frames) and draws it to a `CanvasTexture`, replacing `HTMLVideoElement.currentTime`
  sync, which is not frame-accurate. This makes deterministic export/scrub of recorded
  video possible.

  `waitForVideosReady()` is now real: elements register their in-flight decode via
  `window.__vos__.registerDecode`, and the export/scrub loop awaits the exact frame before
  capturing. The legacy `html5` path is unchanged and remains the default. mp4box is loaded
  from esm.sh at runtime (keeps the injectable elements bundle lean). Requires a secure
  context with WebCodecs; `auto` falls back to `html5` when unavailable.
