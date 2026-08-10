---
'@vosjs/core': patch
---

Drop the unused `VOS_VERSION` constant from compiled output. Every compiled module opened by declaring `const VOS_VERSION = <n>;` inside `initVos`, and nothing ever read it — not the runtime, not the bridge, not any consumer. The config's `version` field keeps its real job as the `migrateConfig` discriminator; only the dead emit goes.
