---
'@vosjs/cli': patch
---

`vos record` scrolls the container under the cursor inside the page, by the clock, instead of sending wheel events: a take on a fleet's background tab no longer stalls in its scroll, and a slow machine records every frame of the travel.
