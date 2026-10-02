---
'@vosjs/core': patch
---

The transport reports the live timeline after a data swap. When `SET_DATA` rebuilt a program's content and timeline in place (a `{$data}`-bound split text, or a program without `onFrame`), the rebuild carried the progress callback onto the new timeline, but the callback read the killed one: every `UPDATE` reported where the old timeline stopped, so a host's playhead and timecode froze while seeks still moved the picture. The callback now reads `result.timeline` live, and after a swap that replaced the timeline the host's tween edits are applied to the new one and one `UPDATE` reports where it is and how long it runs.
