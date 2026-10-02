---
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

A zoom can hold its target to one side: `zoom[].screen` (`{ x, y }`, fractions of the frame) is where the target lands at the apex under the stage camera, instead of the centre, so a deep zoom can keep its subject at the left third with the ground open beside it for a caption. A placed span is the author's composition, so the stage camera's cover band does not clamp it; a span that follows the cursor ignores it, and the magnifier has no use for it. ON_FRAME, `zoomView`, `zoomViewport` and its inverse `focusForViewportCentre`, `focusBounds`/`clampFocus`, the pin projection and the framing lint (`zoomWindow`/`zoomCoversRect`) all take the point; the track carries it as two more components only when some span is placed, so every other document lowers its four-component track byte-identically. `vos validate` and the doc schema take `screen`, refuse pixels in words, and warn when it cannot act.
