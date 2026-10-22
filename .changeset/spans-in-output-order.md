---
'@vosjs/studio-core': patch
---

Zoom, tilt and cam spans in a take of several media now play in output order: a span on a later media no longer clamps away the primary's spans that play before it, and a connected pan never carries the camera through a transition window.
