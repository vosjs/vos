---
'@vosjs/tween': minor
'@vosjs/core': patch
---

Relative numeric tween values (`'+=0.5'` / `'-=10'`): recorded as structured
per-property deltas (`TweenSpec.toRelative`), resolved by the sampler and the
extractor as `destination = start value ± delta`. Surfaced by the real-config
parity sweep (a common authored idiom). DIALECT.md updated.
