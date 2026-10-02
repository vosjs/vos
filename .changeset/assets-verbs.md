---
'@vosjs/cli': minor
---

`vos assets ls`, `vos assets usage` and `vos assets why <id>` read the library: what is in it, what holds the storage, and every program that uses a file. `vos asset import <url>` fetches a file from an address and adds it with where it came from (`--license`, `--attribution`) kept beside it. `vos asset push` now prints, per file, what the platform read (`video 1920×1080 avc 34.2 s, audio`), its `asset:<id>`, the url a document key takes, and the line that declares it in a program's `assets`; the same facts are in the `--json` result. A file the platform recognises at the end of an upload is reported as already yours.
