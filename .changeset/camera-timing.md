---
'@vosjs/studio-core': minor
---

The default camera (`glide`) is re-timed against a measured reference: a zoom-in of 0.55 s on a heavy ease-out that starts 0.35 s before the click and lands 0.2 s after it (it started 0.75 s before and took 1.1 s), a zoom-out of 0.5 s, a pan of 0.55 s, a 1.2 s hold after a beat's last click and a 3 s chain gap. A cursor-follow span now enters at the span's own focus (the clicked element's rect) instead of the cursor's position before the click, so a click zoom lands on its target and the follow steers from there. New takes export at 60 fps. Existing documents keep their spans and focus; their camera moves take the new timing when they are next lowered.
