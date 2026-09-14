---
'@vosjs/studio-core': patch
---

The stage camera's slide and scale are one motion. The centring (how far the focus is pulled to the frame's centre) now rides the zoom track as a fourth component, 0 at rest and 1 at an apex, interpolated by the same ease as the level; keyed to the level over a fixed band it landed in the first frames of any ease and the card's corner then drifted back out as the scale caught up, a visible twitch. The default camera's arrival ease is `css-bezier(0.25, 0.1, 0.25, 1)` (CSS `ease`, which the measured reference follows) instead of the front-loaded `(0.16, 1, 0.3, 1)`. `zoomView`, `zoomViewport` and `focusForViewportCentre` take an explicit `centring`; a three-component track lowered before the component existed falls back to the level band.
