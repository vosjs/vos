---
'@vosjs/studio-core': minor
---

A held zoom can keep moving: the camera style gains `holdDrift` (a fraction of the level per second of hold, set per document through `zoomParams`). Through a span's hold the level pushes in linearly from the landing to the span's end, capped at `HOLD_DRIFT_MAX` (15%) of the landed level, so a long beat under a caption reads as a camera still travelling rather than a still; the exit, a pan or the zoom-out, leaves from where the drift arrived. A span that follows the cursor never drifts, whether or not its pointer baked a recenter. No style carries a drift, so every existing track is byte-identical.
