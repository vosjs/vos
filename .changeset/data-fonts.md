---
'@vosjs/core': minor
'@vosjs/elements': minor
---

Data-carried webfonts. `data.fonts` accepts the same `{family, url,
weight?, style?}` entries as `config.fonts`, registered through one
dedup'd registrar: boot faces (both sources) are awaited before first
render (capped, fail-open); faces arriving via `setData` load lazily and
re-raster text elements when they land, so the real face replaces the
fallback without a recompile — font swaps become pure data edits. New
element-system API: `rerasterAll(elementMap)` plus per-instance
`refreshRaster()` (re-draw with unchanged values).
