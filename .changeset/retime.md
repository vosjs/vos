---
'@vosjs/core': minor
---

`retime`: evaluate the program at `f(t)`.

`config.retime` is a pure function of the OUTPUT time and `ctx.data` returning the program time to render. Each frame the runtime seeks the program's own timeline there and sets `ctx.time` to it, while the transport (play, pause, seek, `SET_DURATION`, capture) keeps counting output time on a clock of `duration` seconds; `ctx.outputTime` carries that number on every program, and `READY.retime` (protocol 7) tells a host the transport is the clock. Slow motion, speed ramps, reverse, a freeze, a ping-pong loop, without re-authoring the timeline, and every capture path exact by construction. Reads `data` live, so a rate held in `ctx.data` changes with `setData`. Clamped to the program timeline's `[0, duration]`; a non-finite result falls back to `t` and warns once. Stack entries are output-anchored: their `ctx.time` is the output time.
