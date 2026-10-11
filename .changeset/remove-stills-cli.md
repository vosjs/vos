---
'@vosjs/cli': minor
---

`vos deliver` renders video only. Its destinations are the four video cuts in `schema/channel-specs.json` (`youtube-main-demo`, `x-feed-cut`, `shorts-linkedin-vertical-cut`, `github-readme-loop`); `--to` takes `youtube` (`yt`), `x`, `shorts-linkedin` (`shorts`), `github` (`gh`) or `all`, and any other channel is refused in words. The still destinations, the store screenshots and card stills, the poster documents they rendered from and the `--times`, `--launch` and `--composed` flags of `deliver` are gone, and kit.json entries no longer carry `frameTime`, `source`, `poster`, `text`, `shot`, `crop` or `composed`, nor the manifest `moments`.

`vos judge` is removed.

`vos validate <kit.json>` verifies the cuts (presence, bytes, size, duration against the spec); `--picture` reads each video's first and last frames (`firstlast`). The still checks are gone.

`vos still`, `vos frames` (including `--at-still`), a take's cover (`doc.still`, `vos push --still`) and `vos callout` are unchanged.
