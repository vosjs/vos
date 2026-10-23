---
'@vosjs/studio-core': patch
---

A zoom on any media but the primary renders under the take's camera. The camera is a frame-wide field, but the render read it from the media's own card, which carries only card fields, so under the stage camera every other media was drawn by the magnifier: the zoomed footage landed up to a few hundred pixels from where pinned layers, the framing lint and the caption-over-the-click check placed it. A span on another media is also clamped against that media's own card, and a follow span on it follows that media's cursor, with its recenters timed on that media.
