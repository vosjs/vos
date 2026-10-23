---
'@vosjs/render-core': minor
'@vosjs/studio-core': patch
'@vosjs/cli': minor
---

`actions.json` steps take a `zoom` mark. On a gesture (click, drag, type, paste, press, hover), `"zoom": true` marks the step as its beat's payoff, the step `vos plan --zooms per-beat` keeps its zoom on, and `"zoom": false` means never zoom here. `validateActions` checks it, the recorder keeps it on `meta.steps[].zoom`, the pushed script carries it and `vos fetch` writes it back, and `vos actions script` says where the cut zooms in. A plain `vos plan` rejects the planner's proposal on a `false` step for good, and names a `true` step it proposed nothing for: a mark never invents a zoom. A mark is read from actions.json first, so one added after recording takes effect on the next plan without recording again.
