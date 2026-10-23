---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

A segment may play seconds of its media an earlier segment already played (a cold open of the final state, then the recording from its start, from one file). Every source-anchored span over replayed seconds plays in each occurrence: the zoom, tilt and cam tracks, click effects, freezes and speed spans, with a follow zoom recentering within its own pass. `spanOutputExtents` and `momentOutputs` return every occurrence and `spanOutputExtent` the first, which the lanes draw and anchors, digests and callouts read; `replayFlags` says which pieces replay. `vos validate` accepts overlapping segments (still within their footage) and notes each replay; `vos frames --at-zooms` stills every occurrence. A cut that plays each media's seconds in order lowers byte for byte as before.
