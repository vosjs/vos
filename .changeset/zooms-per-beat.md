---
'@vosjs/cli': minor
---

`vos plan <take> --zooms per-beat` (and `vos join … --zooms per-beat`) keeps at most one zoom per beat: the beats are the captioned steps of actions.json, each running until the next one starts, plus the opening before the first. Within a beat the zoom the cut plays longest stays and is promoted to manual; every other proposal goes into `doc.rejected` like a person deleting it, so no re-plan brings it back. A media with no captioned step keeps its zooms as planned, and the done line says so.
