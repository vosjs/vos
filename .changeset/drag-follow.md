---
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

Drags are followed. A press that travels before its release (a slider thumb, a scrubber, a thing moved across a canvas; `dragsFromTrack`, ≥ 1.5 % of the frame width over ≥ 0.2 s) plans one follow span at the style's new `dragLevel` (`g{n}`, `focusMode: 'auto'`) from the press to the release, and its press leaves the click clusters. Inside any follow span the lowering bakes a path sample every 0.1 s at the pointer's smoothed position for the whole press (`FollowEvent.path`), and the zoom track pans through them linearly after a glide into the first, so the camera moves with the pointer instead of waiting for it to leave the dead zone; the dead-zone follow resumes from the release. Under the stage camera the path is clamped to the cover band like any focus.
