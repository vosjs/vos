# @vosjs/shared

The small shared layer under the `vos` CLI and the document model
(`@vosjs/studio-core`). Dependency-free. MIT.

## Subpaths

| Import                        | What it holds                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `@vosjs/shared`               | The font and typeface catalogs (`FONT_CATALOG`, `TYPEFACE_CATALOG`) and their lookups and URL helpers |
| `@vosjs/shared/params`        | The remix-knob contract of `config.params`: `ParamSpec`, `readParams`, `applyParamValue`              |
| `@vosjs/shared/frontmatter`   | A small `---` frontmatter parser for recipe files                                                     |
| `@vosjs/shared/timelineEdits` | `TimelineEdit` and the source wrapper that applies edits over a program's `createTimeline`            |

The catalogs are generated data: the families, weights and typefaces the
hosted catalog serves, with their URLs. They are the one place this package
names a host, and a consumer may point `FONT_CDN_BASE`-shaped URLs elsewhere.

## What is deliberately not here

Anything one platform decides: quota and plan tables, attribution, a
hosted endpoint's wire types, a hosted changelog's differ. Those live beside
the service that enforces or serves them. Keep this package the lowest
layer: a product opinion belongs in `@vosjs/studio-core` or the host.
