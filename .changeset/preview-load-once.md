---
'@vosjs/cli': patch
---

`vos preview` sends LOAD once. It used to repeat LOAD every 400 ms until the program reported ready, and every LOAD restarts the program, so one whose setup took longer (models, fonts or sound downloading) was restarted until it gave up. A missed BRIDGE_READY is now found with a read-only probe.
