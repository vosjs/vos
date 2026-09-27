---
'@vosjs/render-core': patch
---

The recorder's scroll travels by the clock, like the pointer: each tick sends the wheel delta the eased position owes (0.9 ms per px, a 240 ms floor, a 1000 ms cap) and waits for the page to paint a frame before the next, so every captured frame is a settled composite and the motion is paced by the clock rather than by whatever the browser's own smooth scroll manages to draw. On a software-composited browser the old 120 px chunks with a 40 ms sleep landed as five jumps held by the encoder, with a torn frame where the sticky nav and the content were captured at different offsets. The travel now counts as gesture time in the pace report.
