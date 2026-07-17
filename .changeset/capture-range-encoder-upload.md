---
'@vosjs/core': minor
---

capture-video templates gain segment-friendly capture controls:

- `capture.range?: { startFrame, endFrame }` — render only a sub-range of the composition as an independent segment (frames evaluate at global composition time; output timestamps start at 0), enabling distributed or resumable rendering with external concatenation.
- `capture.encoder?: { codec?, bitrate? }` — pin encoder settings explicitly so every segment of one render shares a single configuration (defaults unchanged: avc/vp9 by format, QUALITY_HIGH).
- `capture.uploadUrl?` — PUT the finished bytes to a URL instead of embedding base64 in `__renderComplete` (fail-open: on upload failure the bytes are embedded with an `uploadError` field).
- structured `window.__renderProgress = { framesDone, totalFrames }` during the capture loop.
- deterministic video handling in the capture loop: `__vos__.isPaused = true` plus the two-phase `waitForVideosReady` settle (matching the client exporter), so compositions with video sources capture frame-accurately.
