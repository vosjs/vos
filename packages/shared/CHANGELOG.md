# @vosjs/shared

## 0.3.0

### Minor Changes

- 7b25557: Two platform modules leave the package: `@vosjs/shared/acquisition` (a signup attribution cookie for one website) and `@vosjs/shared/backdrops` (the wire type and asset base of one platform's backdrop endpoint). Neither was read by the CLI or the document model; the CLI declares its own backdrop row shape. The catalogs, `params`, `frontmatter`, `diff`, `limits` and `timelineEdits` are unchanged.

## 0.2.0

### Minor Changes

- a3ab9f8: The music catalog leaves this package. What vosso hosts, licensed and normalized is platform data that nothing in the open loop reads; the font and typeface catalogs stay, because the CLI's font lint and the 3D text lowering read them.

## 0.1.1

### Patch Changes

- ca94696: The differ carries `rejected` as an id track, so a push's changelog names a rejected planner proposal the way it names a span.
