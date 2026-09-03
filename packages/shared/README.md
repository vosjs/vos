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

| Import                        | What it holds                                                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vosjs/shared`               | `FONT_CATALOG` with `findFontFamily`, `nearestFontWeight`, `fontStack`, `fontFaceUrl(slug, weight)` and `fontManifest()`; `TYPEFACE_CATALOG` (3D typefaces) with `findTypeface`, `typefaceUrl(slug)` and `DEFAULT_TYPEFACE_SLUG` |
| `@vosjs/shared/params`        | The remix-knob contract of `config.params` and `presets`: `ParamSpec`, `readParams(config)`, `paramValues`, `readLooks`, `applyParamValue(config, key, value)`, `applyParamValues`, `readBindings`, `structuralDataKeys`         |
| `@vosjs/shared/frontmatter`   | `parseFrontmatter`, `splitFrontmatter`, `recipeSummary(text, filename)` and `recipeHints(text)` (`applies`, `seed`) for recipe `.md` files                                                                                       |
| `@vosjs/shared/timelineEdits` | `TimelineEdit` and `applyTimelineEdits(config, edits)` / `wrapCreateTimeline(source, edits)`: bake a tween-retime overlay into a program's `createTimeline` for hosts without a live bridge                                      |

The catalogs are generated data: the families, weights and typefaces the hosted catalog serves, with their URLs on `FONT_CDN_BASE` and `TYPEFACE_CDN_BASE`. They are the one place this package names a host. The bases are constants; a consumer that self-hosts builds its own URL from the slug and weight.

## What is deliberately not here

Anything one platform decides: quota and plan tables, attribution, a hosted endpoint's wire types, a hosted changelog's differ. Those live beside the service that enforces or serves them. Keep this package the lowest layer: a product opinion belongs in `@vosjs/studio-core` or in the host.

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
