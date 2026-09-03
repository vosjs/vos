---
'@vosjs/shared': minor
---

Two platform modules leave the package: `@vosjs/shared/acquisition` (a signup attribution cookie for one website) and `@vosjs/shared/backdrops` (the wire type and asset base of one platform's backdrop endpoint). Neither was read by the CLI or the document model; the CLI declares its own backdrop row shape. The catalogs, `params`, `frontmatter`, `diff`, `limits` and `timelineEdits` are unchanged.
