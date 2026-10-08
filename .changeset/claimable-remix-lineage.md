---
'@vosjs/cli': patch
---

`vos push --claimable` now credits the program it was remixed from: `--remix-of <id>` when given, else the vos the directory was fetched from, sent as `remixOfId`. A fetch, an edit and a claimable push need no flag to keep the lineage.
