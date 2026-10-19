---
'@vosjs/core': minor
'@vosjs/studio-core': patch
---

Bridge protocol 11, so a host can frame the player on another origin: `LOAD` carries the manifest the host resolved (`assets`, handed to the program as `deps.assets`, kept across warm loads) and Blobs for the `blob:` keys its data names (`blobs`, re-minted as the document's own object URLs on `LOAD` and `SET_DATA`); `CAPTURE_FRAME` answers `FRAME` with the drawn canvas as a Blob; the bridge takes commands from the framing window (or its own scripts) and from no other. studio-core's peer range admits core 0.30.
