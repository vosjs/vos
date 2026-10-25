---
'@vosjs/cli': patch
---

A file you name is written into folders that do not exist yet: `vos render`, `vos still` and `vos create` (and `vos brand --out`, `vos build --out`, `vos actions from-agent-browser --out`) make the folders on its path. A render used to run to the end and then fail with `ENOENT` because `out/` was missing, losing the whole render. The folder is made BEFORE the render starts, so a folder that cannot be made (a file already at that name, no permission) is said in words before anything runs, and nothing is written.
