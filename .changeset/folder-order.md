---
'@vosjs/cli': minor
---

`vos folder order <vosId|watch-url> --top | --bottom | --before <vos> | --after <vos>` places one of your videos within its folder's own order.

A folder's order is what its page shows, and its cover is the first four. A video filed into an arranged folder goes last, and until now only a person, signed in, could say it belonged elsewhere.

- One video and one place a call. A malformed ask (no video, no place, two places, a video before itself) is a usage error before anything is sent.
- It prints where the video landed, and `position`, `of` and the folder's whole `order` ride `--json`.
- A refusal is printed in vos.so's words: a video in no folder has no place to take.
- There is no verb for a whole order. Renaming or deleting a folder and reordering the shelf stay the person's, on vos.so.
