---
'@vosjs/cli': minor
---

`vos frames --at-zooms` stills the apex of every zoom span on every media of the take and checks each against the same frame rendered with the zooms off, flagging a zoom that did not render, and the new `vos check-video <file>` checks a rendered file's facts, scene changes, loudness and first and last frames without ffmpeg.
