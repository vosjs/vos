---
'@vosjs/cli': minor
---

`vos session exec <name> <script.mjs>` runs your own Playwright code inside a saved session, opened the way every vos verb opens it, so a script never launches the profile itself: a browser that cannot decrypt its cookies (Playwright's bundled one, a mock keychain) signs the session out for good. `vos session check` now names that as a cause when a session no longer opens signed in.
