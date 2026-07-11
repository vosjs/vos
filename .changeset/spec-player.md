---
'@vosjs/tween': minor
---

`createSpecPlayer(resolve)` + `contextResolver(ctx, content)` — data-driven
timeline playback: evaluate serializable `TweenSpec[]` (carried in a program's
`ctx.data`) against live targets each frame. `setSpecs` memoizes by array
identity (frozen SET_DATA snapshots invalidate for free) and preserves
original base values across rebuilds, so implicit starts stay correct when
specs are live-swapped mid-playback. The interpreter-pattern foundation for
data-driven animation editing. Exposed in the runtime bundle.
