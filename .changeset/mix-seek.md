---
'@vosjs/core': patch
---

`mixAudio` treats a jump in source position between two plan points as a seek, not a sweep: a loop wrapping back to its start, or a `currentTime` set, plays on from the first point at native rate and lands at the second, the way an element seeks. It used to sweep through the source in one step, an audible click at every loop boundary.
