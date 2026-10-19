---
'@vosjs/elements': patch
---

The frame-accurate video source loads mp4box from where the page says (`window.__vos__.modules.mp4box`, set by the engine's render template from the host's module source), falling back to esm.sh at the pinned version.
