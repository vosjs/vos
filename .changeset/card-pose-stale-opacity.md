---
'@vosjs/studio-core': patch
---

The card's pose is a pure function of time again: every frame writes its scale, offset, opacity and visibility, in or out of a transition window. A fade moves opacity alone, and the pose was restored only when scale, offset or visibility looked off-rest, so a scrub (or any cold seek on one engine, like a set of stills) that jumped out of a fade mid-window left the footage card translucent until something else moved it.
