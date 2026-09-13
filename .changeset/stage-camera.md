---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

The stage camera: `frame.camera: 'stage'` makes a take's zoom a camera instead of a magnifier. The card scales and slides so the zoom's focus lands at the frame's centre (blended in over the first 0.3 of level, so level 1 stays the identity), the focus is clamped only so the card still covers the central 80 % of the frame, and past the card's edge the frame shows the ground, radius and shadow. New takes open on it (`BASE_FRAME_STYLE`); a document without the field keeps the clamped magnifier it was cut with, byte-identically. `zoomView`, `zoomViewport`, `focusForViewportCentre`, `cameraModel` and `cameraCentring` are the camera-aware layout helpers; `focusBounds`, `clampFocus`, the digest's `zoomWindow` / `zoomCoversRect` and the CLI's framing lint take the model. The doc schema and `vos validate` know the field.
