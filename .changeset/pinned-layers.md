---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

Pinned layers: an overlay clip may name its referent (`pin: { step | press | rect, side?, gap?, mark?, leader?, color? }`) and is placed beside it, following it as the camera moves. The lowering resolves the referent (a recorder step's element rect, the press nearest a source second, or a rect in video fractions) through the frame's camera into the clip's motion track, chooses the side once (the first of right, left, below, above that fits through the layer's life) and clamps the layer inside the frame; the layer keeps its screen size. A `mark` (`ring` or `underline`) is painted on the referent inside the card's zoom transform; a `leader` draws a hairline from the layer's near edge to the referent. `transform.x/y` stay the fallback for a pin that cannot resolve.

The recorder keeps every hover, click, type and drag step's element rect on `meta.steps[].rect`; an older take resolves a step pin from the presses inside the step's window. `vos validate` refuses a pin that names nothing (an unknown or skipped step, a step that touched nothing, a pin naming two referents, a rect in pixels) and warns when a scroll or navigation inside the layer's window may have moved the referent, or when the frame has no room beside it. The framing warning about a layer sitting over the clicked element now tests the layer's box against the element as the camera shows it, for every layer kind, and names the fix.
