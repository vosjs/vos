---
'@vosjs/cli': minor
---

Platform verbs: `vos fetch` (pull a program's config + metadata from vos.so, params preserved), `vos check` (local validation: migrate → schema → syntax → compile → determinism/dialect lints), and `vos push` (create a private remix with lineage, or iterate an existing vos with `--vos`, forwarding `--base`/`--note`). Credentials resolve from `VOS_API_KEY` or `~/.config/vos/credentials` and are never printed; `VOS_ORIGIN` overrides the platform origin.
