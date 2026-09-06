---
'@vosjs/core': patch
'@vosjs/studio-core': patch
'@vosjs/render-core': patch
'@vosjs/cli': patch
---

mediabunny moves from 1.27.3 to 1.55.7 everywhere it is pinned: the capture-video template's importmap, the recording composition's WebCodecs provider, the render harness's mux and the CLI's render and encode pages. Explicit bitrates render as before; a subjective quality (`QUALITY_HIGH` and friends) now means constant quality, which halves a screen recording's file for the same picture.
