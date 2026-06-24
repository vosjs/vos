# @vosjs/core

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
