---
'@vosjs/cli': patch
---

The library surface exports the take server (`startTakeServer`, `waitForPageDone`, the `TakeServer` type) and `RECORDING_NAME`, so a script that serves a take directory to a render page the way `vos open` does no longer needs the package's internals.
