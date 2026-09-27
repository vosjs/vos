---
'@vosjs/cli': patch
---

`vos record` scrolls by the clock: a scroll step's wheel deltas are paced over the travel with a paint between them, so a fleet or a slow machine records intermediate positions instead of jumps, and the pace report counts the travel as a gesture rather than overhead.
