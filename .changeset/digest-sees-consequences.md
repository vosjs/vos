---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

The digest sees consequences. After every click and typing run, `vos digest` samples the frame at the step's end and a few beats after it and names the region of the page that answered as a `changed` moment: its `rect` is the changed region, its `focus` the centre, `seed` the click or typing moment it answers, `at` the sample that changed most, and `activity` the fraction of the frame that moved. A dialog opening, a 200 landing, a panel re-laying out and a card going dark become moments a cut can hold on and a zoom can frame; a change under 2% of the frame is no moment, and what moves on its own (an animated background) is discounted: a sample a beat before the press gives each cell its own drift, and only what moved past it counts. The pure half (`changedRegion`, `pickChange`) is exported from `@vosjs/studio-core`.
