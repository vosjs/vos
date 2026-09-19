---
'@vosjs/cli': patch
---

`vos validate` says when a layer outlives the footage. A recording's output runs to the end of its last visual clip, on purpose, so words can play after the footage. The same rule meant a layer left behind by a trim silently lengthened the render, and the clip ended on bare backdrop with a note floating on nothing. The lint caught an out-of-range zoom and had no check for this at all. It is a warning and never a problem, because a problem would refuse every legacy end card; a freeze counts as footage, so an end card over its freeze stays silent.
