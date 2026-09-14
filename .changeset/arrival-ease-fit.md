---
'@vosjs/studio-core': patch
---

The default camera's arrival is fitted to the reference: `css-bezier(0.36, 0, 0.4, 1)` over 0.6 s (a gentle start, half the move at about 245 ms, 90 % at about 425 ms, a long settle), matching a 60 fps corner trace of a Cursorful zoom-in at its three measured points; CSS `ease` over 0.55 s reached the midpoint 70 ms earlier and read a touch fast. The pan between chained spans takes the same curve.
