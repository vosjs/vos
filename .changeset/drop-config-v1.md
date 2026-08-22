---
'@vosjs/core': minor
'@vosjs/cli': minor
---

Config version 2 is the floor. The v1 migration is removed.

The engine was never public at v1: `migrations.ts` arrived in the first public
commit already reading `CURRENT_CONFIG_VERSION = 2`, so no config outside
vos.so was ever authored against v1, and the last v1 artifact there has been
carried forward.

- `migrateConfig` refuses a v1 config (`No migration from config version 1 to
  2.`) instead of migrating it. The migration map is empty but kept: a future
  v2 to v3 registers there and the loop runs it unchanged.
- `vos check` reports a v1 config as an error, and now warns when a config
  declares no version at all: it plays locally, but a host that stores configs
  refuses it.
