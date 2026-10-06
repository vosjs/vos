---
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

Every text layer is laid out by one module. A plain layer (one style throughout) now takes the same layout and painter a styled one does, so the wrap, the per-unit entrance, the pill and the picking box all read one function, and the second wrap and measure code is gone.

- A text layer is measured once, when its words, font or width change. A plain layer that moves, or reveals word by word, no longer measures its lines and units on every frame.
- An entrance's units are cut from the laid-out lines on the page. The baked entrance no longer carries the words a second time (`units` and `n` are gone from `BakedOverlayFx`), which shrinks what a keystroke sends for a layer with a per-character entrance.
- `textRunsOf(clip)` is what the layout takes for any text layer; `overlayRect` reads it.
- Spaces at the start of a line are kept where the line wraps and under a per-word entrance. Both used to drop them, so such a line sat a few pixels to the left of where it sits without a wrap or an entrance.
