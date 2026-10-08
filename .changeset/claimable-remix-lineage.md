---
'@vosjs/cli': minor
---

`vos push --claimable` now credits the program it was remixed from: `--remix-of <id>` when given, else the vos the directory was fetched from, sent as `remixOfId`. A fetch, an edit and a claimable push need no flag to keep the lineage.

`vos push <take> --claimable` pushes a remix of a public take with no account. `vos fetch <url> --media` now records in `vos.json` which hosted file each downloaded file came from and its sha256, and the claimable take push names those originals instead of uploading anything; a file that is new or changed since the fetch is refused before anything is sent.
