---
'@vosjs/cli': minor
'@vosjs/studio-core': minor
---

`vos record`, `vos create` and `--dry-run` check where the first navigation landed before a frame is captured. A take that met a sign-in instead of the page it was asked for (a 401 or 403, an identity provider, a sign-in path, a sign-in form rendered in place) is refused with exit 4 and a sentence naming what was asked and where the recorder landed; a redirect elsewhere with no sign-in in sight is refused under `--strict` and warned about otherwise. The check runs before a re-record clears the old footage, so an expired session never costs the recording it failed to replace. `--allow-wall` records the page anyway, and `meta.wall` plus the digest's `take.wall` then carry the verdict.
