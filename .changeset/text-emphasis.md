---
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

A text layer can mix weights. Emphasis is OPT-IN per clip: with `emphasis` set (`{}` is enough), `*words between asterisks*` are set in the emphasis weight (the family's bold step, or `emphasis.weight`) and colour (`emphasis.color`), so a light line can carry bold words, the two-weight caption, and a word-by-word or char-by-char reveal keeps every word in its own weight; `\*` is a literal asterisk there. Without `emphasis`, asterisks are text as typed, so no existing caption changes. The markers become two control characters around every emphasized word at lowering (`parseEmphasis`, `overlayDisplayText`, `stripEmphasis`); ON_FRAME measures and draws run by run, switching fonts at them, and the host's picking rect and wrap measure through `measureEmphasized`, its mirror. The emphasis face loads with the rest, so the first frame has it. `vos validate` checks `emphasis` and says so when a clip has marked words but emphasis is off; the doc schema documents both.
