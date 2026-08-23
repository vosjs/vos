---
'@vosjs/core': minor
'@vosjs/cli': patch
---

`VosConfigJson` requires `version` again, and authoring gets its own type.

The canonical shape is the one that gets stored, served and read back later,
and it always carries a version. Typing the field optional described the
exception (a config being written and played right now) as though it were the
rule, and told every TypeScript author the field was theirs to skip.

- `VosConfigJson.version` and `VosConfig.version` are required.
- `AuthoredVosConfigJson` is the new authoring shape: the canonical one with
  `version` optional. `compileVosConfig` takes it, because playing a config is
  transient and watched.
- `migrateConfig` is the bridge, and its overloads say so: an authored config
  in, a canonical one out. Untrusted JSON in returns untrusted JSON with a
  guaranteed `version` and no claim about the rest.
- `vosConfigJsonSchema` requires `version` again. Every caller already migrates
  before parsing, so the schema describes the canonical shape and
  `migrateConfig` is the single tolerant door.
