---
'@vosjs/tween': patch
---

Overload signatures for the recorder's GSAP-style getter/setters (`time()`, `progress()`, `timeScale()`): the no-arg getter form now types as `number` instead of `number | RecordingTimeline`, so call sites like `Math.min(tl.time(), s)` typecheck. Types-only — no runtime change.
