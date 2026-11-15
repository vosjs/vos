---
'@vosjs/cli': patch
---

`vos preview` plays a program's video and sound natively. Its page loads with `autoplay`, which started the clock and left every media element paused, sought on every frame instead of played. The fix is in `@vosjs/core`'s player document.
