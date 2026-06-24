---
'@vosjs/core': minor
---

Add a `data` input pass-through (`ctx.data`).

`VosConfigJson` (and `VosConfig`) gain an optional `data` field, exposed to every
function (`setup`, `createContent`, `createTimeline`, `onFrame`) as `ctx.data`.
vos imposes no shape on it — it is passed through verbatim. The value is sourced
from `config.data` (baked as the default) and can be overridden at runtime via
`initVos(container, deps)` `deps.data`, so a live editor can update data without
recompiling. `ctx.data` is always defined (defaults to `{}`). Fully additive and
backward compatible.
