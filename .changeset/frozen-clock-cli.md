---
'@vosjs/cli': patch
---

`vos record`'s clock-driven motion yields a tick when a sample cost no clock time, so a take on a runtime whose clock moves only across I/O (a Worker) no longer spins in its scroll.
