---
'@vosjs/core': patch
---

The external Spark addon loads `@sparkjsdev/spark` at one pinned version (`SPARK_VERSION`, 2.3.1), never the bare specifier: an unversioned CDN import is whatever the package's owner published last, run with the player's origin. A test holds every external entry's URL to a version.
