---
'@vosjs/core': minor
---

A capture can say how often it wants a key frame. `capture.encoder.keyFrameInterval` (seconds) reaches mediabunny's video config, and is left alone by default, so nothing changes for a capture that does not ask.

The interval is what a SEEK costs: a key frame decodes on its own and every frame after one decodes the chain back to it. Measured on a 3 s 720p vp9 capture of the same busy content, seeking around the clip: 74 ms per seek with a single key frame, 38 ms at the 2 s default, 15 ms at 0.5 s, while the file stayed within 1% of its size across all three, because busy content produces heavy delta frames either way. The size tradeoff the interval is usually weighed against did not show up.

So a capture that will be SCRUBBED (a hover preview, a thumbnail strip) can buy cheap seeks for nothing, and a capture that will be watched start to finish has no reason to pay for seekability it never uses. Every capture still starts on a key frame whatever the interval says, so the segment invariant that range-based renders rely on is untouched. A negative or non-finite value is refused where it is written, rather than inside the page where it reads as a dead render.
