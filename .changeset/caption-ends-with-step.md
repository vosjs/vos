---
'@vosjs/cli': minor
---

A caption leaves when its step ends instead of lingering until the next caption: `vos plan --motion` and `--captions` captions land as their step begins and stay for the step, or for as long as their words take to read (17 characters a second) when that is longer. A caption whose words outlast its step is named in the done line with how long it stays past it and how to give it room.
