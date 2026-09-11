---
'@vosjs/core': patch
'@vosjs/render-core': patch
---

An EMPTY timeline under a declared `duration` is a carrier of that length. A program whose `createTimeline` returns a bare timeline (a ground under studio layers, a scene that only reads `ctx.time`) had a 0 s timeline the play driver never wrapped, so the studio's transport counted past the duration forever with the playhead pinned at the end. The compiled program now pads such a timeline to `duration` and marks it `vosCarrier`, so playback wraps at the duration like every program and a duration edit retimes live. render-core's `@vosjs/core/audio` pin moves with the release.
