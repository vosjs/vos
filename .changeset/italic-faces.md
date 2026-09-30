---
'@vosjs/shared': minor
---

The font catalog can host a true italic: an entry's optional `italics` lists the weights served as `{weight}-italic.woff2`, `fontFaceUrl(slug, weight, 'italic')` names one, and the manifest (`GET /api/fonts`) carries `italicFiles` beside `files`. Instrument Serif joins the catalog, 400 upright and italic, so a piece that sets it no longer loads it from a third-party host.
