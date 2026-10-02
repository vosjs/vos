# @vosjs/shared

> The small shared layer under the `vos` CLI and the document model: the font and typeface catalogs, the remix params contract, a frontmatter parser and the timeline-edit wrapper.

[![npm](https://img.shields.io/npm/v/@vosjs/shared.svg)](https://www.npmjs.com/package/@vosjs/shared)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos). Dependency-free.

## Install

```bash
pnpm add @vosjs/shared
```

## Subpaths

| Import                        | What it holds                                                                                                                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vosjs/shared`               | `FONT_CATALOG` with `findFontFamily`, `nearestFontWeight`, `fontStack`, `fontFaceUrl(slug, weight)` and `fontManifest()`; `TYPEFACE_CATALOG` (3D typefaces) with `findTypeface`, `typefaceUrl(slug)` and `DEFAULT_TYPEFACE_SLUG`                                             |
| `@vosjs/shared/params`        | The remix-knob contract of `config.params` and `presets`: `ParamSpec`, `readParams(config)`, `paramValues`, `readLooks`, `paramData`, `applyParamValue(config, key, value)`, `applyParamValues`, `applyAssetParam`, `assetParamIssues`, `readBindings`, `structuralDataKeys` |
| `@vosjs/shared/frontmatter`   | `parseFrontmatter`, `splitFrontmatter`, `recipeSummary(text, filename)` and `recipeHints(text)` (`applies`, `seed`) for recipe `.md` files                                                                                                                                   |
| `@vosjs/shared/timelineEdits` | `TimelineEdit` and `applyTimelineEdits(config, edits)` / `wrapCreateTimeline(source, edits)`: bake a tween-retime overlay into a program's `createTimeline` for hosts without a live bridge                                                                                  |

The catalogs are generated data: the families, weights and typefaces the hosted catalog serves, with their URLs on `FONT_CDN_BASE` and `TYPEFACE_CDN_BASE`. They are the one place this package names a host. The bases are constants; a consumer that self-hosts builds its own URL from the slug and weight.

## What is deliberately not here

Anything one platform decides: quota and plan tables, attribution, a hosted endpoint's wire types, a hosted changelog's differ. Those live beside the service that enforces or serves them. Keep this package the lowest layer: a product opinion belongs in `@vosjs/studio-core` or in the host.

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso

## File knobs

A knob of kind `asset` swaps a file the program declares. Its `key` is a name in `config.assets`, and its value is that entry's `ref`:

```json
{
  "assets": { "logo": { "ref": "./logo.png", "kind": "image" } },
  "params": [{ "key": "logo", "label": "Logo", "kind": "asset" }]
}
```

The program reads the file the way it reads any declared file, as `ctx.assets.logo` or `"$assets.logo"`. Committing the knob writes the manifest and nothing else, so the swapped file is a declared file like the one it replaced, and it never appears in `ctx.data`. `accept` lists the kinds the knob takes (`image`, `video`, `audio`, `model`, `font`, `hdr`); without it the knob takes the declared file's own `kind`.

- `paramValues` reads every knob, a file knob from the manifest. `paramData` leaves file knobs out: it is what a host hands a running program as data.
- `applyAssetParam(config, name, ref, kind?)` is the swap, for a host that knows what the new file is. `applyParamValue` reaches it for a file knob.
- `assetParamIssues(config)` says, in words, what would make a file knob do nothing: a name the manifest does not declare, a list, a file the program never reads, no kind.
