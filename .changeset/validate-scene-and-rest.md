---
'@vosjs/cli': patch
---

`vos validate` says when a layer anchored to one media's step starts over another media's footage, with the segment it lands in and where its own footage ended: a step caption lands after its gesture, and a trim after that step leaves it speaking over the next scene. A replay's note now names an earlier pass that rests the camera (a cold open marked `camera: "rest"`, replayed by the main play): it said a zoom over those seconds plays in every occurrence, which the lowering does not do.

The framing check (a caption over the thing being clicked) reads an anchored layer where it plays: it read the `start` field, which on an anchored layer is only the fallback, stale after a trim or absent, so it judged an anchored caption at the wrong second or skipped it.
