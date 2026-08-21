---
'@vosjs/core': minor
---

`setData` now keeps every program live. A program that reads `ctx.data` in `onFrame` keeps the cheap path (the data is swapped and the next frame reads it). A program without `onFrame` used to render the new data only after a full re-init, because its `createContent` had already snapshotted the old values; the compiled instance now rebuilds its content in place on `setData` — disposes the old content, re-runs `createContent` and the layer assignment against the new data, re-creates the timeline and restores the playhead, play state, rate and the host's progress callback — with no module re-import and no blank frame. A program can also opt into the cheapest path by returning `onData(data)` from `createContent`; when present it is called instead of a rebuild. `timeline` on the instance is now a live getter.
