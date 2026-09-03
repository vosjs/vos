---
'@vosjs/cli': minor
---

`vos record` and `vos create` read the hosted recording cap live from the platform's public `GET /api/limits` before a take (the caller's own plan when a key resolves), so a change on the platform reaches the next take without a release. The built-in 30 minutes is the offline fallback, said in words when it applies; `--max-duration` overrides either.
