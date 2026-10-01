---
'@vosjs/tween': patch
---

A `from()` with a relative value now starts off the target's value and lands on it, as GSAP's does: `tl.from(props, { y: '-=500' })` starts 500 above and ends where the element is. The recorder read the relative value as a `to` delta, so the tween ENDED 500 off and the element left the frame for good (the element was on screen before the tween and gone after it). It is recorded as `fromRelative` now, and before the tween starts the target shows its start value (`immediateRender`), as an absolute `from` already did. Held to GSAP in the differential parity suite.
