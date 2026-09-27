---
'@vosjs/render-core': patch
---

The clock-driven motion loops (`clockMotion`, `clockTyping`) yield a tick when a sample cost no clock time. On a Cloudflare Worker `Date.now()` advances only across I/O, so a scroll tick that owed no pixels yet awaited nothing, read the same instant, computed a zero wait and spun on a frozen clock for good: the fleet's first three clock-driven scrolls each held a session until they were canceled by hand. The pointer never hit it because its every sample awaits a mouse move. Pinned by a test on a clock that moves only while sleeping.
