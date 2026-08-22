---
'@vosjs/core': minor
---

`version` is stamped by the engine, not written by the author.

A config's `version` exists so a config whose meaning changed while its shape
did not can still be read correctly later. Nothing in the compiler or runtime
reads it, so requiring every hand-written and generated config to declare a
magic constant bought nothing.

- `version` is now optional on `VosConfigJson` and `VosConfig`. Authors leave
  it out; state it only to mean an older version.
- `migrateConfig` reads an absent version as the CURRENT version (a config
  that omits one was authored against today's schema) and stamps it on the
  way out. It previously read absent as v1.
- A version newer than the engine understands now throws instead of passing
  through unread, and a non-integer version is rejected.
