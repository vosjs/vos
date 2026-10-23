---
'@vosjs/cli': minor
---

`vos join … --keep-edits` carries a re-recorded input's edits onto its new footage instead of dropping them. A take whose footage changed at the same path, or a take at a new path that recorded the same script, is re-timed by its steps with the mapping `vos plan --reuse` uses: its trims take the old ones' place, its manual spans and rejections follow the steps they sat on, its captions stay anchored to the steps it still has, a layer placed over its footage keeps its place in the scene, and the planner's fresh proposals fill in only where nothing was kept or rejected. What cannot be placed is dropped and named in the done line. The step map behind `--reuse` now also finds an unnamed step by its place beside the nearest named one, so a step added to a script no longer loses the spans on the unnamed steps after it.
