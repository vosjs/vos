---
'@vosjs/elements': minor
'@vosjs/core': patch
---

A split text element bound to data follows a data edit. `content`, `font.family` and `font.color` bound with `{ $data }` on a `split` element used to resolve once at boot, so a knob on a per-letter word changed nothing until a reload. The element now rebuilds its units from the new values (`segments` and `props` are replaced), the new `takeStructural(elements)` on the element system reports it, and the compiled `setData` rebuilds content and timeline so the per-letter tweens run over the new letters, whatever rung the program would otherwise take. A program compiled before this still shows the new word, unanimated, until its next compile.
