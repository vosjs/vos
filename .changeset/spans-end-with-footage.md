---
'@vosjs/studio-core': patch
'@vosjs/cli': patch
---

No planned zoom span runs past the footage: the planner takes the footage's `duration` and clamps every span to it (the cursor track ends at the last event, before the footage does). A take whose last press sat closer to the end than the style's hold planned a span past the end, which `vos push` refused.
