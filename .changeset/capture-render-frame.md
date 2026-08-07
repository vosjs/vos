---
'@vosjs/core': minor
---

Capture fast path: compiled programs expose `renderFrame()` — one synchronous engine tick (sync objects, publish the clock, run per-frame code, draw all render groups) — and the capture-video template drives frames through it instead of waiting for the compositor's vsync-locked rAF, removing a 1–2 frame-interval floor per captured frame. The template stops the internal rAF loop before driving frames (or every captured frame renders twice). Older compiled artifacts without `renderFrame` keep the rAF path. Measured: ~3.3× capture throughput on both GPU and SwiftShader hosts. The base64 fallback handoff also builds its string in 32K slices instead of per-byte concatenation.
