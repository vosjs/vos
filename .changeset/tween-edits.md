---
'@vosjs/tween': minor
---

`RecordingTimeline.applyEdits(edits)` — serializable timing/ease overrides
(`TweenEdit`: entry index → startTime/duration/ease) applied to the recorded
entries with the master footprint recomputed and the sampler invalidated.
This is the editor retiming seam: replay the original `createTimeline`
through the recorder, then apply the overlay — works for opaque tweens
(onUpdate/modifier bodies) too, since edits address timing, not values.
