---
'@vosjs/cli': minor
---

A program push carries every file it names, and a claimable push carries them too.

- `vos push --claimable` no longer leaves a local sound out or refuses a program that declares local files. It opens the claim's own upload session (no credential), sends each file through the same door a key uses, and names the session in the claim: at most 12 files and 50 MB, sound up to 5 minutes, video up to 60 seconds. The done event says how many files rode the claim.
- Every push now carries a file an element names as `src` or a font names as `url` (lifted into `config.assets`, the element then naming `"$assets.<name>"`) and a file path in `data` (uploaded, rewritten to the hosted file's path). Before, these went up as the bare local name and loaded nothing on a hosted page. A file typed inside a function is said, with the manifest line to write.
- Warnings are `{"event":"warning","message":…}` events under `--json`. They were stderr lines, which `--json` silenced, so an agent never heard that a file was left behind.
