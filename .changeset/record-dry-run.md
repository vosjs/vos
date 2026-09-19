---
'@vosjs/cli': minor
---

`vos record --dry-run` rehearses a script before a take is spent on it. A missed selector used to cost a full real-time recording and its encode to discover. A rehearsal runs every step against the real page, in order, because a later selector usually exists only after an earlier click, but captures nothing and writes nothing: the pointer lands instead of travelling, every pause is cut to a beat, and the take directory keeps its footage, its cut and its script exactly as they were. Selector lookups keep their whole timeout, so a miss in the rehearsal is a miss in the take. It prints each step with the rect it resolved, in capture px (the rects a pin or `vos callout --step` reads), and exits 2 on any miss or a first load that never reached networkidle. `--storage-state` and `--browser-arg=` apply to it.
