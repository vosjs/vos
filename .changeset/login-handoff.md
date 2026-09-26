---
'@vosjs/cli': patch
---

`vos login --handoff <url>`: a signed-in person's "hand it to your agent" line from vos.so carries a setup link, and this exchanges it, once, for a content key named for the machine, with no click from the person. The origin is the link's own, the key goes straight to the credentials file, and a spent, expired or unknown link fails in words with `vos login` as the next step.
