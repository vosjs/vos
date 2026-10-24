---
'@vosjs/cli': minor
---

`vos record --reuse` (and `vos create --reuse`) records again into a take and puts its cut onto the new footage in the same command. Without it, a re-record's last line and done event (`previousCut`, `next_step`) say where the kept cut is and how to apply it, a rehearsal of a take with a cut suggests `--reuse`, and recording again over a plan nobody edited keeps the cut already in `doc.prev.json` instead of replacing it.
