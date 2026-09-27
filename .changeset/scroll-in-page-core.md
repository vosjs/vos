---
'@vosjs/render-core': patch
---

A scroll step moves the page's own scroll container by the clock, inside the page: each tick evaluates a `scrollBy` on the first scrollable ancestor under the cursor (else the window), which returns at once. Not wheel events, whose CDP dispatch waits for the renderer to handle them and never returns from a tab that paints no frame for a small delta, which a connected fleet browser's background tab is; not `requestAnimationFrame`, which such a tab never fires; not a page timer, which it throttles to once a second. Under a software-rasterized browser the same scroll now records every frame of its travel (44 distinct frames where the chunked wheel gave 16) and no torn composite, because a layout moved by `scrollTo` composites whole.
