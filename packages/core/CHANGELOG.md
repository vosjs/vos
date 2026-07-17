# @vosjs/core

## 0.8.0

### Minor Changes

- c6c5075: capture-video templates gain segment-friendly capture controls:

  - `capture.range?: { startFrame, endFrame }` — render only a sub-range of the composition as an independent segment (frames evaluate at global composition time; output timestamps start at 0), enabling distributed or resumable rendering with external concatenation.
  - `capture.encoder?: { codec?, bitrate? }` — pin encoder settings explicitly so every segment of one render shares a single configuration (defaults unchanged: avc/vp9 by format, QUALITY_HIGH).
  - `capture.uploadUrl?` — PUT the finished bytes to a URL instead of embedding base64 in `__renderComplete` (fail-open: on upload failure the bytes are embedded with an `uploadError` field).
  - structured `window.__renderProgress = { framesDone, totalFrames }` during the capture loop.
  - deterministic video handling in the capture loop: `__vos__.isPaused = true` plus the two-phase `waitForVideosReady` settle (matching the client exporter), so compositions with video sources capture frame-accurately.

## 0.7.1

### Patch Changes

- 38ee657: Fix render template head order: emit `<link rel="modulepreload">` hints after the import map. A modulepreload seen before the import map counts as module activity, which makes Chromium <133 (including Cloudflare Browser Rendering, currently Chrome 128) reject the map — every bare import then fails with `Failed to resolve module specifier "three"`. Only the preconnect hint now precedes the map.

## 0.7.0

### Minor Changes

- d891f70: Selectable tween backend (`tweenEngine: 'gsap' | 'vos'`).

  - `@vosjs/core`: `generateRenderTemplate` accepts `tweenEngine` +
    `tweenBundleCode` — in vos mode the template imports no GSAP (the importmap
    entry remains for legacy artifacts), inlines the @vosjs/tween runtime, and
    supplies `deps.gsap` as a fresh deterministic recorder per LOAD.
    `compileVosConfig` accepts `{ tweenEngine }` to omit the (shadowed) gsap
    import from compiled modules. Compiled artifacts stay backend-agnostic:
    `ctx.gsap` always comes from `deps.gsap`, so either artifact runs under
    either host backend.
  - `@vosjs/tween`: new `@vosjs/tween/bundle` export (`tweenRuntimeCode` IIFE
    defining `globalThis.__vosTween`) and the remaining master-timeline
    transport surface — `paused()`, `repeat()` (`-1` loops the play driver),
    `kill()`, getter forms of `timeScale()` / `eventCallback()`.

## 0.6.1

### Patch Changes

- d69465f: Relative numeric tween values (`'+=0.5'` / `'-=10'`): recorded as structured
  per-property deltas (`TweenSpec.toRelative`), resolved by the sampler and the
  extractor as `destination = start value ± delta`. Surfaced by the real-config
  parity sweep (a common authored idiom). DIALECT.md updated.

## 0.6.0

### Minor Changes

- 4f19e94: Deterministic tween sampler + dialect tooling.

  - `@vosjs/core`: structural `VosTimeline` interface (public API no longer
    hard-depends on the `gsap` type); `lintVosDialect()` enforcing the frozen
    tween dialect (plugins, `modifiers`, selector targets, playback control,
    `repeatRefresh`, `snap`; ease-set warnings) with `DIALECT.md`; determinism
    linter catches string-form `random()` values and `stagger: {from: 'random'}`.
  - `@vosjs/timeline`: `elastic`/`bounce`/`steps(n)` easings and parameterized
    ease parsing (`back.out(1.7)`, `elastic.out(1, 0.3)`), bare-family default
    (`'power2'` → `power2.out`) — all curve-verified against `gsap.parseEase`.
  - `@vosjs/tween`: sampler backend — with no live backend, a recorded timeline
    now evaluates itself: pure `seek(t)` (repeat/yoyo folding, analytic implicit
    endpoint capture, defined conflict rule), per-tween and timeline `onUpdate`,
    wall-clock preview `play()`. Array targets expand with GSAP-normalized
    stagger offsets (`each`/`amount`/`from`). Differential parity harness proves
    numeric equivalence with real GSAP across the dialect corpus.

## 0.5.1

### Patch Changes

- 0a4a6e4: Improve npm discoverability metadata: query-matched descriptions, expanded keywords, and homepage pointing at vos.so/engine. No code changes.

## 0.5.0

### Minor Changes

- 9e2f189: feat: audio element — `{ type: 'audio', src, gain?, loop?, startTime? }` plays a sound file synced to the master clock. Drive it like an html5 video (set `playing`, animate `currentTime` in createTimeline); playback honors the global pause/seek transport state, and the new animatable `gain` element prop (0-1) maps to volume for fades. Audio elements render no pixels: they carry an invisible mesh, are skipped by editor hit-testing, and report `visible: false` in element rects. Audio files participate in asset preloading (fetched to a blob URL and cached like video).

## 0.4.1

### Patch Changes

- 21c94eb: Fix: instance cleanup no longer deletes the document-scoped `window.__vos__`
  namespace. It used to `delete window.__vos__`, which destroyed the elements
  factory the render template installs once at document boot (plus quality
  override and video caches) — so the second warm `LOAD` of a config with
  `elements` failed with "Cannot read properties of undefined (reading
  'renderElements')". Cleanup now clears instance-scoped state only
  (`videoCallbacks`, `pendingDecodes`), keeping warm program swaps safe for
  element compositions.

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
