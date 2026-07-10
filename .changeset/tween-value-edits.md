---
'@vosjs/tween': minor
---

`TweenEdit` value overrides: `to` / `from` per-property numeric overrides merge
into the recorded spec (an absolute `to` supersedes a relative `'+=x'` delta;
a `from` override on an implicit-start prop pins it). Completes the overlay
editing surface: retime, re-ease, and re-value without regenerating code.
