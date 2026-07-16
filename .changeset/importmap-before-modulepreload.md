---
'@vosjs/core': patch
---

Fix render template head order: emit `<link rel="modulepreload">` hints after the import map. A modulepreload seen before the import map counts as module activity, which makes Chromium <133 (including Cloudflare Browser Rendering, currently Chrome 128) reject the map — every bare import then fails with `Failed to resolve module specifier "three"`. Only the preconnect hint now precedes the map.
