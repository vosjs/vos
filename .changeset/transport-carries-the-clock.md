---
'@vosjs/core': patch
---

`window.__vos__.transport` carries `time`: the clock itself, in output seconds, as of the last update. A follower that is not handed the time each frame (a `video` or `audio` element left to play) measures against it.
