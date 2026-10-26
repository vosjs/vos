---
'@vosjs/cli': minor
---

A directory remembers whose work it is (MA2): every push and fetch writes `origin` and `account` into `vos.json`, and a verb on that directory resolves the stored credential for THAT account before the active one, so a take fetched as an organization pushes as it from a terminal whose active credential is personal, with no switch. A directory whose account has no credential stored here says so before any request (`take/ belongs to @vosso, and no credential for it is stored…`), a directory last pushed to another origin is noted, and `--key`, `--account`, `VOS_API_KEY` and `VOS_ACCOUNT` still outrank it. `vos push --folder <handle>/<slug>` under a credential that is not the project owner's asks before STARTING the caller's own copy of the project (headless needs `--yes`), instead of landing in a private copy nobody meant.
