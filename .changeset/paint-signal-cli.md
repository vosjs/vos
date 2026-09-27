---
'@vosjs/cli': patch
---

`vos record`'s scroll waits for the screencast's next frame between deltas (capped), not for `requestAnimationFrame`, so a take recorded in a background tab no longer stalls inside its scroll.
