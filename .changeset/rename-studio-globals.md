---
'@vosjs/studio-core': patch
---

Rename the in-page globals and log prefixes a lowered take uses: `__vosWc`, `__vosWant`, `__vosAutoMuted`, `__vosFontSet`, `ns.studioDecode` (was `voilaDecode`), the `studio.card` frame-prep hook, the `__STUDIO_DEBUG__` / `__studioDebug` verification hook, and the `[studio]` console prefix. Programs lowered before this release keep the old names in their stored code.
