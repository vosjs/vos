---
'@vosjs/cli': minor
---

`vos plan <take> --zooms per-beat` (and `vos join … --zooms per-beat`) keeps at most one zoom per beat: the beats are the captioned steps of actions.json, each running until the next one starts, plus the opening before the first. A step marked `"zoom": true` in actions.json is its beat's payoff: the beat keeps, for each marked step, the proposal that overlaps it most (never two that overlap), promoted to manual, and a beat with no marked step keeps no zoom. When no step of the take is marked, each beat's last click, drag, type or paste stands in, the opening keeps none, and the done line says so. A step marked `"zoom": false` is never zoomed on. Every other proposal goes into `doc.rejected` like a person deleting it, so no re-plan brings it back. A beat with a manual zoom keeps only its manual ones. A media with no captioned step keeps its zooms as planned. The done line names each beat, the step it zoomed on and the span it kept.
