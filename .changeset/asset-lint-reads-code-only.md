---
'@vosjs/core': patch
'@vosjs/cli': patch
---

`vos check` no longer warns that a program "reads assets.vos, which config.assets does not declare" when nothing reads the manifest at all.

The manifest lint scanned a function string for `assets.<name>` anywhere in it, so a URL on a host named `assets.` (every hosted font is one) and a local array called `assets` were both reported as reads of `ctx.assets`. A program with studio layers printed seven of these on every check and every push.

It now scans code only: the text of a string, a template, a comment or a regex is not a read, while a template's `${ … }` still is. A property of a local declared as `const assets = …` is its own, unless the local is given the manifest (`const assets = ctx.assets`). A name mentioned only in a comment no longer counts as a read of its declaration either.
