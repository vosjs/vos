---
'@vosjs/cli': patch
---

`vos still` checks the frame it wrote: a fully transparent still (every pixel alpha 0, what a custom blend that clears the destination alpha leaves, which most viewers show as black while the live preview draws over its page) and a single flat colour are said as `warn:` lines and in the `--json` done event, and an uncaught exception the page threw is said on a still or a render that otherwise succeeded, not only on a timeout.

`vos render`, `vos still` and `vos check` given a program's `config.json` read the program document beside it (`doc.json` without `source`), as they do for the directory: a render of `program/config.json` used to leave out the document's sound and layers without a word.
