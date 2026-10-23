---
'@vosjs/studio-core': patch
---

The zoom planner never overlaps a drag's span with a click or typing span (they cede the drag its window, as a typing span cedes a click on another field), so `vos validate` accepts every fresh plan.
