---
'@vosjs/shared': minor
'@vosjs/cli': minor
---

A knob can swap a file. A param of kind `asset` is bound to a name in `config.assets`: its value is that entry's `ref`, and committing it writes the manifest, so the new file is declared, uploaded by `vos push` and served like the one it replaced. `accept` lists the kinds of file the knob takes; without it the knob takes the declared file's own `kind`.

`@vosjs/shared/params` gains `paramData` (the knob values a running program reads from `ctx.data`, file knobs left out), `applyAssetParam` and `assetParamIssues`. `vos check` warns about a file knob that would do nothing: a name the manifest does not declare, a list of files, a file the program never reads, or no kind.
