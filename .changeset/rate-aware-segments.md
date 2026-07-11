---
'@vosjs/timeline': minor
---

Rate-aware time remapping (speed changes). `Segment` gains an optional `rate` field (source seconds per output second): `mapTime`, `sourceToTimeline`, and `totalDuration` now evaluate rated segments, so speed-ups contract the output timeline and slow-downs stretch it. New `SpeedSpan` type + `splitBySpeed(segments, speeds)` intersect footage-anchored speed spans with a segment list into rated segments, `rateAt(segments, t)` reports the rate under the playhead (for mirroring with `video.playbackRate`), and `segmentRate(segment)` exposes the effective rate. Segment-editing helpers (`splitSegments`, `trimSegment`) preserve rates and scan in output time. Backward compatible: rate-less segments behave exactly as before, and the runtime bundle (`__vosTimeline`) picks the new math up transparently.
