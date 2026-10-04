---
'@vosjs/studio-core': minor
---

A video backdrop decodes through the WebCodecs provider on capture pages.

Under `videoDecodeMode: 'webcodecs'` the background loop (`frame.backgroundMedia`, kind `video`) now gets its own sequential provider, the way the footage does. Before, the loop was stepped by an `HTMLVideoElement` seek on every captured frame, and each seek decoded from the previous keyframe while the capture waited: a take with an animated backdrop exported at about 14 fps where the same take on a gradient exported at 240. With the provider the same take exports at about 280 fps, and the frames match the element path (RMS under 1 on 8-bit RGB).

Fail-open at every step: no `VideoDecoder`, an undecodable track or a dimension mismatch keeps the element seek. Playback and scrubbing are unchanged.

Setup also writes `window.__vos__.voilaDecode` (`{ recording, backdrop }`, each `provider`, `element` or `none`), so a host can report which path decoded a capture.
