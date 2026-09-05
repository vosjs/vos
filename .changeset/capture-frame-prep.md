---
'@vosjs/core': minor
'@vosjs/studio-core': minor
---

Capture harnesses paint each frame once. A program can register frame-prep hooks (`window.__vos__.framePrep`, a Map by id) that a capture loop runs right after seeking the timeline and before the paint, so the decodes a frame needs are requested up front and awaited with `waitForVideosReady`; the capture-video template runs them by default (`capture.prepareFrame: false` keeps the two-phase settle for A/B measurement). studio-core's recording composition registers one: it asks the WebCodecs provider (or seeks the element, the webcam and the background loop) for the frame's source moment before ON_FRAME runs, and the paused step it uses is the same source ON_FRAME's `syncVid` runs, so the paint finds its target met and registers nothing. Every take frame used to paint twice, once with the previous footage and again after the decode, on every harness.
