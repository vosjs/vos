---
'@vosjs/studio-core': minor
---

The card shadow is layered: three shadows whose blur and offset grow while each stays at a low alpha share `frame.shadow`, so the card reads as lifted a little off the ground instead of sitting in a dark pool (the house looks are retuned for it and carry no contact layer). A frame that bleeds the card past an edge (a negative `frame.inset` side) overscans the card layer's canvas and plane (`CARD_OVERSCAN`), so a tilt that turns the bled edge back toward the viewer shows card there, not the texture's edge. Footage draws with the high-quality resampler, so a large downscale no longer aliases. A text clip takes `shadow` as a strength (0 = none); the end card's words carry none.
