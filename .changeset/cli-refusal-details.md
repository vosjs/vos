---
'@vosjs/cli': patch
---

A refused request prints why. Every vos.so verb (push, claim, asset, folder, delete and the rest) prints the issues behind a generic `Invalid input` on the lines below it, path and message, where before it printed only the two words. `vos delete <id>` also unlinks the working directory when its `vos.json` tracks that vos, as deleting by directory already did, so the next push no longer aims at a vos in Trash.
