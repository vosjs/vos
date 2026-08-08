---
'@vosjs/core': patch
---

Fix text3d extrusion depth: TextGeometry's option is `depth` on current three (the legacy `height` alias is ignored and the extrusion fell back to the default 50, collapsing normalized text to a sliver).
