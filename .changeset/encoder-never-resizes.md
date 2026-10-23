---
'@vosjs/render-core': patch
'@vosjs/cli': patch
---

The encoder draws every frame at its own size and refuses, in words, a take whose frames changed size mid-take, instead of stretching them onto the first frame's size.
