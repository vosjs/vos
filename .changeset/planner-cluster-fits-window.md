---
'@vosjs/studio-core': minor
'@vosjs/cli': patch
---

The zoom planner clusters presses by what one window can hold, not by time alone. A press joins a cluster only while the cluster's targets still share one window at the style's level floor; otherwise it starts a new span and the chain gap pans between them. A cluster's level is capped so the union of its targets stays within the window. Before, a corner press two seconds from a press at the top of the frame became one span aimed at their midpoint, which framed neither. `vos validate` now says split when the presses under a span cannot share a window.
