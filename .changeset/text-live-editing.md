---
'@vosjs/elements': minor
'@vosjs/core': minor
'@vosjs/editor': minor
---

Live text editing. `ElementInstance.setContent` is real (previously a warn stub): non-split text elements re-measure, re-raster and swap geometry/texture IN PLACE — the mesh keeps its identity, so scene membership, render order and timeline bindings stay valid — then reposition to config truth. The props proxy gains raster-prop setters (`content`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `letterSpacing`, `color`, `strokeColor`, `strokeWidth`), coalesced on a microtask so a burst of writes re-rasters once. Bridge protocol bumps to 4: `SET_ELEMENT_PROPS` values may now be strings, enabling live content/color/family previews from editors. `@vosjs/editor` adds the matching durable commits, `setTextContentRecipe` and `setTextStyleRecipe` (font fields + stroke, null stroke removes). Split text stays structural (one mesh per unit); `setContent` on a split element warns and defers to a reload.
