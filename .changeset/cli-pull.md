---
'@vosjs/cli': minor
---

`vos pull` — the other half of the iteration loop: fetch the attributed, typed changelog of what changed on vos.so since your base (versions with origin/label/note + semantic summaries + the protected human-edited node set), sync `config.json` to the head (previous copy kept as `config.backup.json`), and repoint the tracked base. `vos push` now tracks its base automatically through `meta.json`, accepts `--label` and `--overrides`, distinguishes stale-base from protected-node 409s, and — like `pull` — delegates take directories to the take pipeline.
