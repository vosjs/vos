---
'@vosjs/elements': minor
'@vosjs/core': minor
---

`{$data: key}` bindings for text element props. `content`, `font.family` and
`font.color` may now be a `{$data: 'key'}` reference: the value resolves from
the host's data object at render time and re-resolves on `setData`, so a
bound headline or font swap is a pure data edit — the element re-rasters in
place with no re-init. Bindings live in the elements config (part of the
compiled program), so hosts classify bound-value changes as SET_DATA by
construction. Split text resolves bindings at boot only (per-unit meshes and
timeline segment bindings make live content changes structural); every fresh
boot — export, server render, preview — resolves correctly. New element
system API: `updateData(elementMap, data)` plus per-instance `updateData`,
wired from the compiled module's `setData`.
