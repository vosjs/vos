---
'@vosjs/cli': patch
---

Captions from `vos plan --motion` and `--captions steps` never overlap: each gives way to the next and leaves before its clip (and the end card) begins, and a caption with too little room to be read is dropped and named in the plan's skipped list instead of sharing the screen.
