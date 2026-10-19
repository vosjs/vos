---
'@vosjs/studio-core': patch
---

The composition's WebCodecs frame provider imports mediabunny from where the page says (`window.__vos__.modules.mediabunny`), falling back to esm.sh at the engine's pinned version; the `@vosjs/core` peer range admits 0.31.
