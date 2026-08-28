# @vosjs/core

## 0.22.0

### Minor Changes

- d621857: `renderAudio`: the sound a program plays, rendered offline.

  `@vosjs/core/audio` exports `renderAudio(config, { duration?, sampleRate?, channels?, decode? })`, which samples the program's audio schedule with the same pure tween sampler live playback uses (`props.playing`, `props.currentTime`, `props.gain` on every `AudioElement`, through `retime`) and mixes the decoded sources into plain PCM (`{ sampleRate, length, channels: Float32Array[] }`). No DOM, no pixels: the decoder is injectable (`fetch` + Web Audio's `decodeAudioData` by default where a context exists), so it runs in a Worker or in Node as well as a page, and `toAudioBuffer` wraps the result for a Web Audio consumer. `planAudio` (the schedule as points) and `mixAudio` (the sample-exact mixer) are its two halves, exported for consumers that inspect a schedule or bring their own sources. Every vos author with an `AudioElement` used to get silence in every export.

  `AudioElement.gainEnvelope`: `[t, gain]` points over OUTPUT time, linear between them, held flat outside, multiplied with `props.gain`. Fades, ducking and a bed that swells under a title as data. Live playback follows it frame by frame: the render loop now publishes `window.__vos__.outputTime` and runs `window.__vos__.frameCallbacks` once per frame on programs with elements, and a media element with an envelope registers there. Programs without elements compile exactly as before.

### Patch Changes

- Updated dependencies [d621857]
  - @vosjs/tween@0.8.0

## 0.21.0

### Minor Changes

- a165ecb: Bridge protocol 6: `SET_MUTED` and `OBJECT_BOUNDS`.

  `SET_MUTED { muted }` mutes or unmutes every media element of the instance (video and audio) without touching their gain or the transport, and survives a warm `LOAD`: `window.__vos__.setGlobalMuted` sits beside `setGlobalPaused`, and the media props proxy applies `element.muted = own || global` on creation and on every global callback. A compare pane, a muted preview, a second player on one page.

  `OBJECT_BOUNDS { id }` (editor mode) answers `OBJECT_RECT` with a declarative object's world bounding box projected through the main camera into viewport CSS px — the sibling of `GET_ELEMENT_RECTS` for the 3D scene, so a host can draw a transform box around a prop.

- cf84b4c: The program stack: `config.stack` runs more programs on one context.

  An entry is `{ id, data?, setup?, createContent?, onFrame? }` — the main program's hooks minus `createTimeline`. Entries run after the main program in each phase, in array order, on the same scene, overlay scene, renderer, elements, objects and master clock, each with its OWN `ctx.data` (`data` baked, `deps.stack[id]` at load, `setData(next, id)` live) and its own error boundary: a throwing entry is disabled for the session and reported through `result.stack.onError`, and nothing else stops. A HUD, a subtitle pass, a watermark, an overlay a remixer adds without touching the main program's code.

  Bridge protocol 5: `SET_DATA` takes `target`, `LOAD` takes `stack`, `READY` lists `stack` ids, `STACK_ERROR` is pushed when an entry throws, `GET_STACK_STATE` answers `STACK_STATE`. Addon detection and the determinism lints read the stack's strings too (`DeterminismIssue.entry`). A config without a stack compiles exactly as before.

- ab92044: `retime`: evaluate the program at `f(t)`.

  `config.retime` is a pure function of the OUTPUT time and `ctx.data` returning the program time to render. Each frame the runtime seeks the program's own timeline there and sets `ctx.time` to it, while the transport (play, pause, seek, `SET_DURATION`, capture) keeps counting output time on a clock of `duration` seconds; `ctx.outputTime` carries that number on every program, and `READY.retime` (protocol 7) tells a host the transport is the clock. Slow motion, speed ramps, reverse, a freeze, a ping-pong loop, without re-authoring the timeline, and every capture path exact by construction. Reads `data` live, so a rate held in `ctx.data` changes with `setData`. Clamped to the program timeline's `[0, duration]`; a non-finite result falls back to `t` and warns once. Stack entries are output-anchored: their `ctx.time` is the output time.

## 0.20.0

### Minor Changes

- 8b601ec: `VosConfigJson` requires `version` again, and authoring gets its own type.

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

## 0.19.0

### Minor Changes

- 1d29a86: `version` is stamped by the engine, not written by the author.

  A config's `version` exists so a config whose meaning changed while its shape
  did not can still be read correctly later. Nothing in the compiler or runtime
  reads it, so requiring every hand-written and generated config to declare a
  magic constant bought nothing.

  - `version` is now optional on `VosConfigJson` and `VosConfig`. Authors leave
    it out; state it only to mean an older version.
  - `migrateConfig` reads an absent version as the CURRENT version (a config
    that omits one was authored against today's schema) and stamps it on the
    way out. It previously read absent as v1.
  - A version newer than the engine understands now throws instead of passing
    through unread, and a non-integer version is rejected.

- 880b4ee: Config version 2 is the floor. The v1 migration is removed.

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

## 0.18.0

### Minor Changes

- 26e8d41: `setData` now keeps every program live. A program that reads `ctx.data` in `onFrame` keeps the cheap path (the data is swapped and the next frame reads it). A program without `onFrame` used to render the new data only after a full re-init, because its `createContent` had already snapshotted the old values; the compiled instance now rebuilds its content in place on `setData` — disposes the old content, re-runs `createContent` and the layer assignment against the new data, re-creates the timeline and restores the playhead, play state, rate and the host's progress callback — with no module re-import and no blank frame. A program can also opt into the cheapest path by returning `onData(data)` from `createContent`; when present it is called instead of a rebuild. `timeline` on the instance is now a live getter.

## 0.17.2

### Patch Changes

- bce620d: Drop the unused `VOS_VERSION` constant from compiled output. Every compiled module opened by declaring `const VOS_VERSION = <n>;` inside `initVos`, and nothing ever read it — not the runtime, not the bridge, not any consumer. The config's `version` field keeps its real job as the `migrateConfig` discriminator; only the dead emit goes.

## 0.17.1

### Patch Changes

- bdb6a0a: Fix text3d extrusion depth: TextGeometry's option is `depth` on current three (the legacy `height` alias is ignored and the extrusion fell back to the default 50, collapsing normalized text to a sliver).

## 0.17.0

### Minor Changes

- beb07a0: Data-carried webfonts. `data.fonts` accepts the same `{family, url,
weight?, style?}` entries as `config.fonts`, registered through one
  dedup'd registrar: boot faces (both sources) are awaited before first
  render (capped, fail-open); faces arriving via `setData` load lazily and
  re-raster text elements when they land, so the real face replaces the
  fallback without a recompile — font swaps become pure data edits. New
  element-system API: `rerasterAll(elementMap)` plus per-instance
  `refreshRaster()` (re-draw with unchanged values).

## 0.16.0

### Minor Changes

- 0fb1305: `text3d` object asset kind. Declarative world-space objects can now be
  extruded 3D text: `{ kind: 'text3d', text, typeface, depth?, bevel?, color?,
metalness?, roughness?, unlit? }`, where `typeface` is a three.js typeface
  JSON URL (FontLoader format). Geometry is centered and bbox-normalized like
  GLB (largest dimension = 1 world unit), so `scale` means the same thing for
  every asset kind. Declaring one auto-imports the FontLoader and TextGeometry
  addons — objects are data, not code. Fail-open per object, like GLB.

## 0.15.0

### Minor Changes

- 77fa2c8: `{$data: key}` bindings for text element props. `content`, `font.family` and
  `font.color` may now be a `{$data: 'key'}` reference: the value resolves from
  the host's data object at render time and re-resolves on `setData`, so a
  bound headline or font swap is a pure data edit — the element re-rasters in
  place with no re-init. Bindings live in the elements config (part of the
  compiled program), so hosts classify bound-value changes as SET_DATA by
  construction. Split text resolves bindings at boot only (per-unit meshes and
  timeline segment bindings make live content changes structural); every fresh
  boot — export, server render, preview — resolves correctly. New element
  system API: `updateData(elementMap, data)` plus per-instance `updateData`,
  wired from the compiled module's `setData`.

## 0.14.0

### Minor Changes

- f49ab19: Live text editing. `ElementInstance.setContent` is real (previously a warn stub): non-split text elements re-measure, re-raster and swap geometry/texture IN PLACE — the mesh keeps its identity, so scene membership, render order and timeline bindings stay valid — then reposition to config truth. The props proxy gains raster-prop setters (`content`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `letterSpacing`, `color`, `strokeColor`, `strokeWidth`), coalesced on a microtask so a burst of writes re-rasters once. Bridge protocol bumps to 4: `SET_ELEMENT_PROPS` values may now be strings, enabling live content/color/family previews from editors. `@vosjs/editor` adds the matching durable commits, `setTextContentRecipe` and `setTextStyleRecipe` (font fields + stroke, null stroke removes). Split text stays structural (one mesh per unit); `setContent` on a split element warns and defers to a reload.

## 0.13.0

### Minor Changes

- c1bddb3: `config.fonts` — webfonts as first-class config. Declare faces as `fonts: [{ family, url, weight?, style? }]` and the compiled template registers them via the FontFace API and AWAITS them (capped 4s, fail-open) before scene setup and element rendering, so canvas text rasterizes with the real face in preview and in every capture path, including per-chunk fresh pages. Headless render environments have near-zero system fonts, so any non-generic family a text element uses should carry a declaration — the new `lintVosFonts` (exported from `@vosjs/core/lint`, wired into `vos check` as the `fonts` source) warns on undeclared families. Schema keeps the block passthrough (nothing stripped); a declaration without a `url` is rejected.

## 0.12.0

### Minor Changes

- 27264cf: Resolution-true text and SVG rasterization. Canvas-backed element textures are now rasterized at the drawing-buffer texel density instead of 1080p design pixels, so a 4K export gets a 4K raster (and hi-DPR previews stop magnifying soft textures); plane geometry stays in design units so layout is unchanged. Text textures gain mipmaps and anisotropy (no more shimmer under minification), `font.letterSpacing` actually draws (native `ctx.letterSpacing`, with a per-grapheme fallback on older engines), line boxes use real font metrics so descenders never clip, and split text is fixed: `lines` stacks vertically instead of collapsing onto one row, `words` keeps real whitespace advances, `chars` segments by grapheme cluster (emoji-safe), and `font.align`/`font.lineHeight` are honored. Element instances and the `createVosElements` factory expose `updateResolution(...)`, and the compiled template's resize handler re-rasterizes canvas-backed textures (with hysteresis) when the buffer size changes. The compiled template also forwards `maxAnisotropy`/`maxTextureSize` GPU capabilities, and oversized rasters clamp to the texture budget. `vosConfigJsonSchema` gains a real (passthrough, non-stripping) schema for text elements with a permissive fallback.

## 0.11.0

### Minor Changes

- 25d1d7d: Capture fast path: compiled programs expose `renderFrame()` — one synchronous engine tick (sync objects, publish the clock, run per-frame code, draw all render groups) — and the capture-video template drives frames through it instead of waiting for the compositor's vsync-locked rAF, removing a 1–2 frame-interval floor per captured frame. The template stops the internal rAF loop before driving frames (or every captured frame renders twice). Older compiled artifacts without `renderFrame` keep the rAF path. Measured: ~3.3× capture throughput on both GPU and SwiftShader hosts. The base64 fallback handoff also builds its string in 32K slices instead of per-byte concatenation.

## 0.10.0

### Minor Changes

- b7b0e7d: Declarative world-space objects: `objects?: ObjectConfig[]` in VosConfigJson — engine-managed 3D props in the main scene (parametric primitives or GLB models by URL, bbox-normalized so `transform.scale` is asset-independent), addressable by id like elements. The editor bridge (protocol 3) gains `SET_OBJECT_PROPS` (ephemeral prop overrides for gesture-time preview) and `OBJECT_HIT_TEST` (a main-camera raycast returning the nearest object id). GLTF objects auto-detect the GLTFLoader addon. Fully additive — configs without `objects` compile byte-identically.

## 0.9.0

### Minor Changes

- 32a69a9: capture templates gain runtime-input and audio capabilities:

  - `capture.data` — JSON-injected into the page and passed to `initVos` as `deps.data` (capture-video AND capture-thumbnail). Data-dependent compositions (constant program + inputs in `ctx.data`) now render correctly in capture modes instead of falling back to baked config data.
  - `capture.audioProducerCode` (capture-video) — host-supplied JavaScript defining `window.__vosAudioProducer__ = async ({ data, duration, sampleRate }) => AudioBuffer | null`; the template calls it and muxes the returned buffer as the output's audio track (AAC for mp4 with automatic Opus fallback where AAC encode is unavailable, Opus for webm). The engine imposes no audio schema — producers interpret `data` however the host defines. Without a producer, zero audio code is emitted.

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
