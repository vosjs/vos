---
'@vosjs/shared': minor
---

The differ (`./diff`) and the plan-limits table (`./limits`) leave the package: the differ's only reader was a hosted changes endpoint (the CLI reads that endpoint's payload, never the differ), and the limits were one platform's pricing table. The dead `./types` and `./utils` subpaths are removed. What stays is what the CLI and the document model read: the font and typeface catalogs, `params`, `frontmatter` and `timelineEdits`.
