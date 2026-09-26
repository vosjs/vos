---
'@vosjs/studio-core': patch
---

`RecordingMeta` states what a take's clock is: `t0` is the instant the recorder's `start()` was called (where the file's first frame sits), never its `start` event, which Chrome fires from the muxer's first write and which trailed the call by two seconds on a loaded tab; `durationMs` is active ms, the file's timeline, which a pause does not advance; the sidecar skews are `start()`-call skews. Two optional diagnostics join it: `pausedMs` (time removed from the file) and `startEventDelayMs` (how late the start event fired).
