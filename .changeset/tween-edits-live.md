---
'@vosjs/core': minor
'@vosjs/editor': minor
'@vosjs/tween': patch
---

Retime the tweens, live. Bridge protocol 8: `SET_TWEEN_EDITS { edits }` applies a tween-timing overlay (`@vosjs/tween`'s `TweenEdit[]`) to the running program's recorded timeline — the frame under the playhead repaints, an `UPDATE` carries the new duration, and the overlay survives a warm `LOAD` (or rides one as `LOAD.tweenEdits`). `READY.canRetimeTweens` says the timeline honors it (the vos backend); on gsap a host bakes the overlay and loads instead. `VosTimeline.applyEdits?` names the optional surface.

`@vosjs/editor`'s `classifyEdit` sends `SET_TWEEN_EDITS` when `LoweredProgram.tweenEdits` changes by reference, so a retime never changes the program string.

`@vosjs/tween`: `RecordingTimeline.applyEdits` applies from the RECORDING every time (the specs are snapshotted on the first call), so re-applying a whole overlay is exact and an empty overlay restores the recording. It used to merge onto the previous overlay.
