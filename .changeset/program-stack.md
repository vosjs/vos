---
'@vosjs/core': minor
---

The program stack: `config.stack` runs more programs on one context.

An entry is `{ id, data?, setup?, createContent?, onFrame? }` — the main program's hooks minus `createTimeline`. Entries run after the main program in each phase, in array order, on the same scene, overlay scene, renderer, elements, objects and master clock, each with its OWN `ctx.data` (`data` baked, `deps.stack[id]` at load, `setData(next, id)` live) and its own error boundary: a throwing entry is disabled for the session and reported through `result.stack.onError`, and nothing else stops. A HUD, a subtitle pass, a watermark, an overlay a remixer adds without touching the main program's code.

Bridge protocol 5: `SET_DATA` takes `target`, `LOAD` takes `stack`, `READY` lists `stack` ids, `STACK_ERROR` is pushed when an entry throws, `GET_STACK_STATE` answers `STACK_STATE`. Addon detection and the determinism lints read the stack's strings too (`DeterminismIssue.entry`). A config without a stack compiles exactly as before.
