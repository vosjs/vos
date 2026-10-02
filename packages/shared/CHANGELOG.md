# @vosjs/shared

## 0.7.0

### Minor Changes

- a8b4300: A knob can swap a file. A param of kind `asset` is bound to a name in `config.assets`: its value is that entry's `ref`, and committing it writes the manifest, so the new file is declared, uploaded by `vos push` and served like the one it replaced. `accept` lists the kinds of file the knob takes; without it the knob takes the declared file's own `kind`.

  `@vosjs/shared/params` gains `paramData` (the knob values a running program reads from `ctx.data`, file knobs left out), `applyAssetParam` and `assetParamIssues`. `vos check` warns about a file knob that would do nothing: a name the manifest does not declare, a list of files, a file the program never reads, or no kind.

## 0.6.0

### Minor Changes

- 85c4df3: Inter Tight joins the font catalog: 400, 500, 700, 800 and 900 upright and a 900 italic, so a ported page that sets it no longer loads it from a third-party host.

## 0.5.0

### Minor Changes

- 9614531: The font catalog can host a true italic: an entry's optional `italics` lists the weights served as `{weight}-italic.woff2`, `fontFaceUrl(slug, weight, 'italic')` names one, and the manifest (`GET /api/fonts`) carries `italicFiles` beside `files`. Instrument Serif joins the catalog, 400 upright and italic, so a piece that sets it no longer loads it from a third-party host.

## 0.4.1

### Patch Changes

- 598cec7: READMEs rewritten against the current API: every example compiles against the exported signatures, each package lists its real exports, and stale package names and moved modules are gone.

## 0.4.0

### Minor Changes

- baaa9c8: The differ (`./diff`) and the plan-limits table (`./limits`) leave the package: the differ's only reader was a hosted changes endpoint (the CLI reads that endpoint's payload, never the differ), and the limits were one platform's pricing table. The dead `./types` and `./utils` subpaths are removed. What stays is what the CLI and the document model read: the font and typeface catalogs, `params`, `frontmatter` and `timelineEdits`.

## 0.3.0

### Minor Changes

- 7b25557: Two platform modules leave the package: `@vosjs/shared/acquisition` (a signup attribution cookie for one website) and `@vosjs/shared/backdrops` (the wire type and asset base of one platform's backdrop endpoint). Neither was read by the CLI or the document model; the CLI declares its own backdrop row shape. The catalogs, `params`, `frontmatter`, `diff`, `limits` and `timelineEdits` are unchanged.

## 0.2.0

### Minor Changes

- a3ab9f8: The music catalog leaves this package. What vosso hosts, licensed and normalized is platform data that nothing in the open loop reads; the font and typeface catalogs stay, because the CLI's font lint and the 3D text lowering read them.

## 0.1.1

### Patch Changes

- ca94696: The differ carries `rejected` as an id track, so a push's changelog names a rejected planner proposal the way it names a span.
