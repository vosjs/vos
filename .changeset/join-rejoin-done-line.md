---
'@vosjs/cli': patch
---

A re-join's done line no longer reports `0 step captions landed` or `0 beats held zooms` when `--captions` and `--zooms per-beat` had no new input to act on: it says so, or counts what they did on the new inputs and names them. Paths in the done line (a dropped input, an input found at a new path) are given from where the command runs, not from the joined take. A new input with no recorded steps (a video file) is said to have none, never counted as zero captions or beats.
