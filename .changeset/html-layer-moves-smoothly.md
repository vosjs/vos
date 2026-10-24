---
'@vosjs/studio-core': patch
---

An HTML layer that moves (it has `motion` poses, or a pin) glides instead of stepping: it is drawn from one raster of each picture, made at twice the largest size its track reaches and capped at 4096 x 4096 pixels of area, and moved by resampling that raster. Drawn directly, the browser re-rasterized the picture at every pose and placed its text on whole device pixels, so text under a slow move or scale held still and then jumped a pixel while the shapes beside it glided. A layer that does not move is drawn exactly as before.
