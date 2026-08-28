---
'@vosjs/core': minor
'@vosjs/elements': patch
---

Bridge protocol 6: `SET_MUTED` and `OBJECT_BOUNDS`.

`SET_MUTED { muted }` mutes or unmutes every media element of the instance (video and audio) without touching their gain or the transport, and survives a warm `LOAD`: `window.__vos__.setGlobalMuted` sits beside `setGlobalPaused`, and the media props proxy applies `element.muted = own || global` on creation and on every global callback. A compare pane, a muted preview, a second player on one page.

`OBJECT_BOUNDS { id }` (editor mode) answers `OBJECT_RECT` with a declarative object's world bounding box projected through the main camera into viewport CSS px — the sibling of `GET_ELEMENT_RECTS` for the 3D scene, so a host can draw a transform box around a prop.
