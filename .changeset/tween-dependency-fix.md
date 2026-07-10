---
'@vosjs/tween': patch
---

Fix the published `@vosjs/timeline` dependency spec to a concrete semver range so
the package installs from the registry (the initial 0.1.0 publish carried an
unrewritten `workspace:` protocol spec).
