---
'@vosjs/core': minor
---

Add a determinism linter at `@vosjs/core/lint`.

`lintVosConfig(config)` scans VosConfigJson function-strings for the hazards that
break frame-stepped export (rendering must be a pure function of timeline time):
`Math.random()` and `gsap.utils.random()` (not seedable), wall-clock
(`Date.now`/`new Date`/`performance.now`), timers/`requestAnimationFrame`, and
network (`fetch`/`XMLHttpRequest`/`WebSocket`). Returns `DeterminismIssue[]` with
rule/severity/line; errors vs warns via `hasDeterminismErrors()`. Suppress a line
with `// vos-lint-disable-next-line <rule>`. Standalone and non-breaking —
`compileVosConfig` is unchanged.
