---
'@vosjs/core': patch
---

A resized canvas scales its elements instead of cropping them. The overlay camera kept following the new pixel size on resize while element meshes stayed where the first frame placed them, so a player that shrank (a docked panel, a side-by-side view) showed its text at the old size, cut off at the edges. The overlay frustum now holds the height it was laid out at and follows the new aspect, so the whole overlay scales with the canvas.
