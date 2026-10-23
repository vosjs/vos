---
'@vosjs/cli': minor
---

`vos plan <take> --zooms per-beat` (and `vos join … --zooms per-beat`) keeps at most one zoom per beat: the beats are the captioned steps of actions.json, each running until the next one starts, plus the opening before the first. Within a beat the zoom on the beat's action stays and is promoted to manual: of the proposals that overlap the captioned step's own span, the one that overlaps it most. A beat where none does, and the opening, keeps no zoom. Every other proposal goes into `doc.rejected` like a person deleting it, so no re-plan brings it back. A beat with a manual zoom keeps only its manual ones. A media with no captioned step keeps its zooms as planned. The done line names the beats left with no zoom.
