---
'@vosjs/cli': patch
---

`vos port scaffold` places the source's score. Run on a folder (`vos port inventory .`), the inventory stored the folder's bare name, so the scaffold looked for `assets/score.wav` one level too deep, wrote `doc.json` with no audio, and its report still said the score was a track. The inventory now records the source's absolute folder (`root`) and the scaffold resolves media against it; the report names the score only when it placed one. `vos check` no longer lints the studio's own layer code that a program document composes in: its five timer and network warnings pointed at lines the author never wrote.
