---
'@vosjs/cli': minor
---

A program push lands where `vos.json` says. A directory that tracks a vos now ITERATES it, so the loop the contract describes — fetch, edit, `vos check`, push, pull — finally needs no flags, and `--remix-of` is the one door that makes something separate. Before this, a bare `vos push config.json` read the tracked id as LINEAGE rather than as a target: the second push in a directory created a fresh vos remixed from the first, the third remixed the second, and a shelf filled up with "… remix remix" siblings while the vos anyone was actually editing never changed. `--vos <id>` still names a target outright, for a directory that tracks nothing or tracks something else. Create-only flags (`--title`, `--slug`) against a tracked directory are refused in words naming both doors, rather than being dropped on the floor — the ambiguity is real, and guessing at it is what caused the original defect. The decision is pure and tested (`programPushTarget`).
