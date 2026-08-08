---
'@vosjs/core': minor
'@vosjs/cli': minor
---

`config.fonts` — webfonts as first-class config. Declare faces as `fonts: [{ family, url, weight?, style? }]` and the compiled template registers them via the FontFace API and AWAITS them (capped 4s, fail-open) before scene setup and element rendering, so canvas text rasterizes with the real face in preview and in every capture path, including per-chunk fresh pages. Headless render environments have near-zero system fonts, so any non-generic family a text element uses should carry a declaration — the new `lintVosFonts` (exported from `@vosjs/core/lint`, wired into `vos check` as the `fonts` source) warns on undeclared families. Schema keeps the block passthrough (nothing stripped); a declaration without a `url` is rejected.
