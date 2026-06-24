---
'@vosjs/elements': minor
'@vosjs/core': minor
---

Add a frame-accurate video source (WebCodecs + mp4box).

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
