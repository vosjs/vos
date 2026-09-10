---
'@vosjs/render-core': patch
---

Move the pinned `@vosjs/core/audio` CDN build to 0.24.0

`CORE_AUDIO_CDN_URL` is the `mixAudio` build a render page imports, pinned by
hand because render-core has no engine dependency. It still named 0.23.7,
so a fleet audio page would mix with a build older than the engine its host
runs. No behavior change beyond the version the page fetches.
