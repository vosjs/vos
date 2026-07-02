---
'@vosjs/core': patch
---

Fix: instance cleanup no longer deletes the document-scoped `window.__vos__`
namespace. It used to `delete window.__vos__`, which destroyed the elements
factory the render template installs once at document boot (plus quality
override and video caches) — so the second warm `LOAD` of a config with
`elements` failed with "Cannot read properties of undefined (reading
'renderElements')". Cleanup now clears instance-scoped state only
(`videoCallbacks`, `pendingDecodes`), keeping warm program swaps safe for
element compositions.
