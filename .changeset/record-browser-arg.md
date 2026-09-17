---
'@vosjs/cli': minor
---

`vos record` and `vos create` take `--browser-arg <switch>`, repeatable:
extra Chromium switches for the recording browser.

Some product surfaces cannot be reached from a clean context. A recorder
page needs a fake capture device to get past a permission prompt, and an
extension page needs the extension loaded. The switches pass through to
`chromium.launch` verbatim.
