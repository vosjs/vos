---
'@vosjs/core': minor
---

Editing capabilities for host-side editors (bridge protocol v2, all additive):

- **Master clock feed**: the generated render loop now publishes the timeline
  position into `ctx.time` / `ctx.progress` every frame (before `onFrame`), so
  interpreter-style programs can be a pure function of `(ctx.data, ctx.time)`
  without a GSAP playhead-carrier hack.
- **Seconds transport**: new `SEEK_TIME { value }` bridge command (absolute
  seconds, clamped); `UPDATE` events now carry `{ time, duration }` alongside
  the legacy `progress`; `BRIDGE_READY` advertises `{ protocol, editor }`.
- **`setDuration` (T2.5)**: `VosResult.setDuration(seconds)` retimes the master
  timeline without re-init. Opt-in: `createTimeline` declares a pure duration
  carrier via `timeline.data = { vosCarrier: true }` (the interpreter-pattern
  shape); retiming rebuilds the carrier. Bridged as `SET_DURATION { value }`;
  `READY` advertises `canSetDuration` so hosts can fall back to a warm LOAD.
- **Editor-mode bridge** (opt-in via `generateRenderTemplate({ editor: true })`,
  playback only): `HIT_TEST` (topmost element at a viewport point, picked by
  zIndex/config order), `GET_ELEMENT_RECTS` (projected element bounds in CSS px,
  also pushed on resize), and `SET_ELEMENT_PROPS` (ephemeral gesture preview via
  the element props proxy — durable edits remain config patches). The compiled
  result exposes `elements` and `overlayCamera` introspection handles.
- **Typed protocol**: `VosBridgeCommand` / `VosBridgeEvent` / `ElementRect` and
  `VOS_BRIDGE_PROTOCOL` exported from `@vosjs/core/runtime`.
