---
'@vosjs/editor': minor
'@vosjs/cli': patch
---

Knobs stay honest.

- `@vosjs/editor`: retyping or recolouring a text element whose `content`, `font.family` or `font.color` is bound to data (`{ $data: key }`) now writes `data[key]` and keeps the binding. It used to write a literal over the binding, so the knob and any later data patch stopped reaching that text. New export `boundDataKey`.
- `@vosjs/cli`: `vos check` warns about every knob or Look vos.so would drop (past 12 knobs or 8 Looks, or a field over its limit), and `vos push` prints the warnings the platform returns.
