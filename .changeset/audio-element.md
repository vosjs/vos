---
'@vosjs/core': minor
'@vosjs/elements': minor
---

feat: audio element — `{ type: 'audio', src, gain?, loop?, startTime? }` plays a sound file synced to the master clock. Drive it like an html5 video (set `playing`, animate `currentTime` in createTimeline); playback honors the global pause/seek transport state, and the new animatable `gain` element prop (0-1) maps to volume for fades. Audio elements render no pixels: they carry an invisible mesh, are skipped by editor hit-testing, and report `visible: false` in element rects. Audio files participate in asset preloading (fetched to a blob URL and cached like video).
