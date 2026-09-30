---
'@vosjs/core': patch
'@vosjs/elements': patch
---

Text written in a frame is in that frame. A text element's raster writes (`props.content`, `color`, font and stroke props) were applied on a microtask after the frame had drawn, so text written in `onFrame` landed one frame late in every export and showed the previous words in every still. The compiled frame now flushes each element's queued raster (`ElementInstance.flushRaster`) after `onFrame` and the stack, before it draws; the microtask stays as the fallback for a write outside a frame. A stored program gains it the next time it compiles.

A re-raster keeps the offset a tween or a drag added to `props.x` / `props.y`, moving the element to its new layout plus that offset, instead of snapping it back to the config position.

`ElementProps` states its units: `x` and `y` are render pixels from the frame centre with y down, `rotation` degrees counter-clockwise.
