---
'@vosjs/cli': minor
---

`vos record` and `vos create` release the screencast frames once the recording is encoded. The JPEGs are the bulk of a take (one hero take was 437 MB of a 452 MB directory) and nothing needs them afterwards: `vos digest` reads frames from them when present and from the video otherwise, which is the path every pulled take already runs on. They are dropped only after the recording exists and has bytes, so a failed encode never costs the only copy of the footage. `--keep-frames` keeps them.
