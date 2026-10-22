---
'@vosjs/cli': patch
---

`vos push <take> --claimable` works from the command line. The push dispatcher refused every claimable push of a take directory as programs-only, so a remix of a public take fetched with `vos fetch <url> --media` never reached the take's claimable path. A take with no hosted files on record (recorded here, or fetched without `--media`) is still refused, now in one sentence that says why and what to run instead.
