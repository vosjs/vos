---
'@vosjs/cli': minor
---

`vos push <take> --vos <id>` does what it says. A take push read its target from `vos.json` and nowhere else, so `--vos` on a directory without one was ignored and a second vos was created, silently, every time a take was re-recorded from scratch. It now ADOPTS that vos: the head is read, named as the base, and the take becomes the next version. `vos pull` was never the answer for this take, because it writes the hosted doc over the local one. `--vos` that disagrees with `vos.json`, and the flags only a program push reads (`--slug`, `--desc`, `--tags`, `--base`, `--remix-of`), are refused before anything uploads.
