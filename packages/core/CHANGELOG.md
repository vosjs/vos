# @vosjs/core

## 0.4.0

### Minor Changes

- 60a6279: Editing capabilities for host-side editors (bridge protocol v2, all additive):

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

## 0.3.0

### Minor Changes

- 8915eca: Live update: edit a running instance without re-initialization.

  - `ctx.data` is now a live getter over a mutable internal (mirroring `ctx.time`/
    `ctx.progress`); the instance returned by `initVos` gains `setData(next)` (and
    `getData()`). `onFrame` reads the new data next frame — no re-init. Each snapshot is
    frozen, preserving determinism. Values baked into GSAP tweens at `createTimeline` time
    are not retroactive (that is a program edit).
  - The playback render template now **boots empty** and ships a consolidated host⇄iframe
    **bridge** (previously a host-side script): `LOAD { code, data, autoplay }` warm-swaps the
    program in place, preserving transport (playhead, playing, rate); `SET_DATA { data }`
    applies live data; transport stays `PLAY/PAUSE/SEEK/PLAY_SPEED`. Emits
    `BRIDGE_READY/READY/UPDATE/ERROR`. Backward compatible: a baked
    `window.USER_CODE_BLOB_URL` still auto-loads.

  This lets editors (e.g. an in-browser studio) update the preview without the
  flash/replay-from-0 of a full iframe reload. See ENGINE_LIVE_UPDATE_STRATEGY.

## 0.2.0

### Minor Changes

- 2bc5e18: Add a `data` input pass-through (`ctx.data`).

  `VosConfigJson` (and `VosConfig`) gain an optional `data` field, exposed to every
  function (`setup`, `createContent`, `createTimeline`, `onFrame`) as `ctx.data`.
  vos imposes no shape on it — it is passed through verbatim. The value is sourced
  from `config.data` (baked as the default) and can be overridden at runtime via
  `initVos(container, deps)` `deps.data`, so a live editor can update data without
  recompiling. `ctx.data` is always defined (defaults to `{}`). Fully additive and
  backward compatible.

- 70edb99: Add a determinism linter at `@vosjs/core/lint`.

  `lintVosConfig(config)` scans VosConfigJson function-strings for the hazards that
  break frame-stepped export (rendering must be a pure function of timeline time):
  `Math.random()` and `gsap.utils.random()` (not seedable), wall-clock
  (`Date.now`/`new Date`/`performance.now`), timers/`requestAnimationFrame`, and
  network (`fetch`/`XMLHttpRequest`/`WebSocket`). Returns `DeterminismIssue[]` with
  rule/severity/line; errors vs warns via `hasDeterminismErrors()`. Suppress a line
  with `// vos-lint-disable-next-line <rule>`. Standalone and non-breaking —
  `compileVosConfig` is unchanged.

- 2431af7: Add a frame-accurate video source (WebCodecs + mp4box).

  Video elements gain an optional `frameSource: 'auto' | 'webcodecs' | 'html5'`. The
  `webcodecs` path decodes the **exact** frame at the requested presentation time via
  `VideoDecoder` + mp4box (decode-order GOP decode, output selected by PTS — correct
  for B-frames) and draws it to a `CanvasTexture`, replacing `HTMLVideoElement.currentTime`
  sync, which is not frame-accurate. This makes deterministic export/scrub of recorded
  video possible.

  `waitForVideosReady()` is now real: elements register their in-flight decode via
  `window.__vos__.registerDecode`, and the export/scrub loop awaits the exact frame before
  capturing. The legacy `html5` path is unchanged and remains the default. mp4box is loaded
  from esm.sh at runtime (keeps the injectable elements bundle lean). Requires a secure
  context with WebCodecs; `auto` falls back to `html5` when unavailable.
