---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

Camera styles re-founded on the stage camera at 60 fps. `focus`, `cinema`, `snappy` and `cut` are re-timed in the default's traced curve family with two structural rules: a chain gap never sits below its pump-free floor (`pumpFreeChainGap`; `resolveZoomStyle` raises an override that does), and the lowering fits a ramp longer than its span to the room it has, never below `RAMP_FLOOR` (0.14 s), instead of compressing it into a one-millisecond cut. Levels come down to the reference field (snappy 2.5 → 2.2, focus and cut 2.2 → 2.0), holds gain a beat, and every style's tilt track moves at its own zoom tempo so a lean lands with its zoom. `keynote` and `drift` are retired names: they resolve to `glide` + medium tilt and `cinema` + subtle tilt, `migrateHostedDoc` (docSchemaVersion 5) rewrites a stored document onto the pair, and `vos validate` warns. `none` spells its camera as the default's, never a frozen copy. The planner never dwells on the opening run (the cursor parked before its first move), which had opened six of eight real takes on a corner zoom at the ceiling.
