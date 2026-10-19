---
'@vosjs/render-core': patch
---

`validateActions` and `validateSetup` refuse a script `url` or a setup `goto` on any scheme but http and https, in words (`urlSchemeProblem` is exported for a host that reads a URL of its own), so a `file:` or `javascript:` address never reaches the recorder's browser.
