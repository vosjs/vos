# @vosjs/core

## 0.29.1

### Patch Changes

- f0d2fb3: The `dom-target` dialect rule fires only on a TWEEN with a selector target: a string first argument followed by a vars object (`tl.to('.box', { x: 1 })`). It no longer fails ordinary JavaScript such as `map.set('key', 1)`, `Array.from('abc')` or `registry.set('name', fn)`, which `vos check` and the validate dry run used to refuse as errors.

  `@vosjs/studio-core` exports `isLoweredRecording(config)`: whether a config is a recording's lowered program (its four functions are studio-core's own), so a host that lints an author's code can leave the generated code to the tests where it lives. `vos check` does: a recording's composed config no longer prints the engine's own timers and fetches as the author's, and a finding in another stack entry names its entry.

## 0.29.0

### Minor Changes

- 5628a5b: A run's colour can be bound to data, and a host can put a font face on the running page before the program declares it.

  **A run's `color` and `highlight` take `{ "$data": "key" }`**, the spelling the element's own `font.color` already takes: one knob turns the accent of every word that wears it, with no edit to the text and no reload.

  ```json
  "content": [
    { "text": "Ship it " },
    { "text": "faster", "weight": 700, "color": { "$data": "accent" } }
  ]
  ```

  - A binding is a value like any other in the run operations (`@vosjs/elements/text`): it rides its run through typing, a cut and a merge, two runs bound to the same key are one run, and a literal set over part of it replaces it there alone. `resolveRunColors(text, data)` reads the bindings where a run is drawn; a key that holds no string paints the element's own colour.
  - `props.content` and `setContent` may carry bindings: they are read against the data as it stands, and again whenever it moves. The element keeps what was WRITTEN, so a later data edit still reaches it.
  - `resolveTextContent(content, data)` and `contentIsBound(content)` replace `resolveBoundRuns`, which took a list of indices; `TextBindings.runs` is `true` when any run reads data.
  - `lintVosText` takes a bound colour, and warns when a run reads a key `config.data` does not hold (`unbound-run-key`): the run draws no words, or the element's own colour, until a value arrives.

  **`REGISTER_FONTS`** (editor mode, `VOS_BRIDGE_PROTOCOL` 10; `registerFonts` on the editor bridge client): a host hands the page `{ family, url, weight?, style? }` faces to register now. A weight previewed in an edit that is not committed used to be faked from the regular face until the commit's reload; with its face on the page it is drawn as it will be. Each face is registered once, and text elements are drawn again when one lands. An engine before 10 ignores the message.

  `FontFaceDecl` is exported from `@vosjs/core`. `@vosjs/studio-core` accepts `@vosjs/core` 0.29.

## 0.28.0

### Minor Changes

- 04840e0: A text element's words can be styled in parts. `content` is a string, or a list of runs: `[{ "text": "Ship it " }, { "text": "faster", "weight": 700, "underline": true }]`. A run is a piece of text and the fields in which it departs from the element's `font` (`weight`, `italic`, `color`, `underline`, `strike`, `highlight`). It is the same shape a studio text layer's `text` takes, so styled words read and write one way wherever they are.

  **`@vosjs/elements`**

  - One layout and one painter for a text element, plain or styled, whole or `split`: a string is one run a line. Plain text draws exactly as it did; `scripts/verify-text-raster.mjs` holds 28 plain cases to the pixel against the renderer before this change.
  - With `split`, a unit draws the styles of the characters it holds, so a word set half in bold is one unit.
  - A run's `text` may be `{ "$data": "key" }`: a knob edits plain words under a fixed style, and a data edit redraws in place.
  - `props.content` and `setContent` take a string or runs.
  - New entry `@vosjs/elements/text`: the runs and their operations, the layout and the caret helpers, pure (no DOM, no three). They moved here from `@vosjs/studio-core`, which re-exports them unchanged.
  - `layoutTextElement(element, probe)` in that entry is a text element's measured layout as a pure function: its lines, where each stretch stands, its padding and its box. The renderer paints from it over a probe on its raster canvas (`canvasTextProbe`), and a host that stands a caret on an element calls the same function over a canvas of its own.

  **`@vosjs/core`**

  - `TextRun` and `TextElementRun` types; `TextElement.content`, `ElementProps.content` and `setContent` take runs; `textRunSchema`.
  - `VOS_BRIDGE_PROTOCOL` is 9: `SET_ELEMENT_PROPS` may carry `content` as a list of runs. An engine before it draws a list as text, so a host sends one only to an engine that advertises 9.
  - `ELEMENT_RECTS` gives an element drawn as one plane its `quad`: its four corners on screen, top-left first and clockwise. The box only bounds a rotated or scaled element; the corners say where it is.
  - `lintVosText` (`@vosjs/core/lint`): a run with no words (an error: the renderer skips it), a field that is not a run's, with the one that was meant (`bold` → `weight: 700`), a field of the wrong type, and a run weight no declared face of its family holds.

  **`@vosjs/editor`**: `setElementProps` and `setTextContentRecipe` take runs. Runs written to a content bound to data land in its knob as their words.

  **`@vosjs/studio-core`**: the styled-text modules come from `@vosjs/elements/text` and are built in, so the layout a host measures a layer with is the build its painter was generated from. Accepts `@vosjs/core` 0.28.

  **`@vosjs/cli`**: `vos check` prints what `lintVosText` finds.

## 0.27.2

### Patch Changes

- db6fc4a: `vos check` no longer warns that a program "reads assets.vos, which config.assets does not declare" when nothing reads the manifest at all.

  The manifest lint scanned a function string for `assets.<name>` anywhere in it, so a URL on a host named `assets.` (every hosted font is one) and a local array called `assets` were both reported as reads of `ctx.assets`. A program with studio layers printed seven of these on every check and every push.

  It now scans code only: the text of a string, a template, a comment or a regex is not a read, while a template's `${ … }` still is. A property of a local declared as `const assets = …` is its own, unless the local is given the manifest (`const assets = ctx.assets`). A name mentioned only in a comment no longer counts as a read of its declaration either.

## 0.27.1

### Patch Changes

- 5ea7f55: An element's `anchor` is read. With an `{x, y}` position it names the point of the box that sits there (`anchor: 'center'` centres a caption on `x: '50%'`; `'bottom-right'`, `'top'` and the rest likewise); a preset position ignores it, and an element without one keeps its box's top-left corner on the point, as before. The bundled skills say so, where one called the default `center` and another said the field was not read.

## 0.27.0

### Minor Changes

- 7002822: A program declares the files it uses, by name. `config.assets` (`{ name: { ref, kind? } }`) is the manifest; a function reads `ctx.assets.<name>` and an element, object or font names one as `"$assets.<name>"`. A file typed into a function as a URL is invisible to every host: it cannot be served to a render page on another origin, brought along when the program is copied, or known to be in use. A declared one can.

  **Core.** The URL a program sees is resolved nearest first: `deps.assets` handed to `initVos` for the surface (`capture.assets` on a capture page), then the default baked at compile time through the new `resolveAssetRef` compile option, then the `ref` as written. `lintVosAssets` (`@vosjs/core/lint`) reports a `"$assets"` string that names nothing, a function that reads an undeclared name, and a declared file nothing reads. A program with no manifest compiles as before, with `ctx.assets` an empty object.

  **CLI.** `vos render`, `vos still`, `vos preview` and `vos compare` serve a manifest's local files to the page from disk and read a hosted one with your key. `vos push` uploads the local files and stores the program naming them `asset:<id>`; the config on disk keeps its paths. `vos fetch --media` brings a program's hosted files home under `assets/`. `vos check` gains the declared-file lints, including a hosted file named in code instead of the manifest.

## 0.26.1

### Patch Changes

- 19bb9ed: The transport reports the live timeline after a data swap. When `SET_DATA` rebuilt a program's content and timeline in place (a `{$data}`-bound split text, or a program without `onFrame`), the rebuild carried the progress callback onto the new timeline, but the callback read the killed one: every `UPDATE` reported where the old timeline stopped, so a host's playhead and timecode froze while seeks still moved the picture. The callback now reads `result.timeline` live, and after a swap that replaced the timeline the host's tween edits are applied to the new one and one `UPDATE` reports where it is and how long it runs.

## 0.26.0

### Minor Changes

- 42b3d67: A program can declare its canvas with `size: { width, height }`, at any shape (9:16, 4:5, 21:9 or any width and height): `vos render` and `vos still` output it by default, one of `--width`/`--height` keeps its aspect, `vos info` prints it, `vos preview` letterboxes to it, and `vos check` and `vos push` keep it instead of dropping it. `@vosjs/core` exports the shared rule (`programSize`, `resolveOutputSize`, `fitWithinEdges`) so every host sizes a program the same way.

## 0.25.6

### Patch Changes

- 699d2e5: The editor bridge picks what the frame shows. `HIT_TEST` skips an element that is hidden or faded to opacity 0 at this moment (a press goes through it to what is there), and `GET_ELEMENT_RECTS` reports such an element `visible: false`. A split text is picked by any of its units and boxed as the whole word, through the new `ElementInstance.meshes()`; before, only its first unit could be pressed.
- bf37561: A `spring(damping, stiffness, mass)` ease (defaults 10, 100, 1; bare `spring`, `spring.in`, `spring.inOut` too), dialect-only like `css-bezier`: a damped spring released from rest, run for its natural settle time (until it stays within 0.5 % of the target) stretched over the tween, landing exactly on 1, as Remotion's `durationInFrames` stretches its `spring()`. A damping ratio of 1 or more settles critically at the natural frequency, as Remotion's does. A tween whose duration is the spring's settle time moves as Remotion's spring does, frame for frame (`springSettleTime(damping, stiffness, mass)` in `@vosjs/timeline`; `content.refs.lib.springSeconds(config)` in a ported program). The dialect lint accepts it in every spelling; GSAP has no such ease, so the GSAP backend falls back to its default. `@vosjs/tween`'s runtime bundle carries it to every render page. The port scaffold's hint now puts a source's springs on the timeline with the ease, never in `onFrame`.
- Updated dependencies [bf37561]
- Updated dependencies [bf37561]
  - @vosjs/tween@0.8.3

## 0.25.5

### Patch Changes

- 97d4edf: A resized canvas scales its elements instead of cropping them. The overlay camera kept following the new pixel size on resize while element meshes stayed where the first frame placed them, so a player that shrank (a docked panel, a side-by-side view) showed its text at the old size, cut off at the edges. The overlay frustum now holds the height it was laid out at and follows the new aspect, so the whole overlay scales with the canvas.

## 0.25.4

### Patch Changes

- ea97b8a: A program whose `createContent` returns objects it never added to a scene now says so. The engine never adds `content.objects` for you (the list is what the program added, for cleanup), so a forgotten `ctx.scene.add()` drew nothing and raised no error. The engine warns `[vos] createContent returned N objects that no scene holds…` after creating and after rebuilding content (a returned `Scene` is exempt, since a program may render a private one), and `vos still` and `vos render` print that warning beside the flat-colour one.

## 0.25.3

### Patch Changes

- 0a4f08d: A split text element bound to data follows a data edit. `content`, `font.family` and `font.color` bound with `{ $data }` on a `split` element used to resolve once at boot, so a knob on a per-letter word changed nothing until a reload. The element now rebuilds its units from the new values (`segments` and `props` are replaced), the new `takeStructural(elements)` on the element system reports it, and the compiled `setData` rebuilds content and timeline so the per-letter tweens run over the new letters, whatever rung the program would otherwise take. A program compiled before this still shows the new word, unanimated, until its next compile.

## 0.25.2

### Patch Changes

- e541410: Text written in a frame is in that frame. A text element's raster writes (`props.content`, `color`, font and stroke props) were applied on a microtask after the frame had drawn, so text written in `onFrame` landed one frame late in every export and showed the previous words in every still. The compiled frame now flushes each element's queued raster (`ElementInstance.flushRaster`) after `onFrame` and the stack, before it draws; the microtask stays as the fallback for a write outside a frame. A stored program gains it the next time it compiles.

  A re-raster keeps the offset a tween or a drag added to `props.x` / `props.y`, moving the element to its new layout plus that offset, instead of snapping it back to the config position.

  `ElementProps` states its units: `x` and `y` are render pixels from the frame centre with y down, `rotation` degrees counter-clockwise.

## 0.25.1

### Patch Changes

- a3f5474: The dialect lint accepts `css-bezier(x1, y1, x2, y2)`: `vos check` warned that it "would fall back to linear" while the evaluator resolves it, so every program using a CSS curve got a false warning. A CSS `cubic-bezier(…)` and a `css-bezier` with the wrong number of arguments still warn.

  `ElementProps` declares what an element's props accept at runtime beyond the transform: `zIndex`, and the text raster props `content`, `fontFamily`, `fontWeight`, `fontStyle`, `color`, `strokeColor` and `strokeWidth` beside `fontSize` and `letterSpacing`. Each of the text ones re-rasters the element when written.

## 0.25.0

### Minor Changes

- f53544a: `vos check` catches two programs that used to pass clean and then disappoint at render.

  `repeat: -1` on a tween is now a dialect error. GSAP answers an infinite repeat by giving the timeline its infinity sentinel, so the program's duration reads 10000000000 seconds instead of its real length and anything placed after that tween is unreachable. The compiled timeline already loops on its own, so the infinite repeat was never buying the loop it looked like it was buying. A finite `repeat` is untouched.

  A postprocessing chain that never applies `{ type: 'output' }` is now a warning, and so is one where that pass is not last. The output pass is what applies tone mapping and converts to the renderer's output color space; every pass before it works in linear space on a render target. A chain that simply stops after its last effect hands the screen an image the renderer never got to finish, so the same scene looks different with the chain than without it. The schema cannot see this — `postprocessing` is a list, and every ordering of a list is a valid list. Both composer chains are checked, and the message names which one it means.

## 0.24.1

### Patch Changes

- 244c1bd: An EMPTY timeline under a declared `duration` is a carrier of that length. A program whose `createTimeline` returns a bare timeline (a ground under studio layers, a scene that only reads `ctx.time`) had a 0 s timeline the play driver never wrapped, so the studio's transport counted past the duration forever with the playhead pinned at the end. The compiled program now pads such a timeline to `duration` and marks it `vosCarrier`, so playback wraps at the duration like every program and a duration edit retimes live. render-core's `@vosjs/core/audio` pin moves with the release.

## 0.24.0

### Minor Changes

- 7282032: Default the tween backend to `'vos'`

  `generateRenderTemplate` and `compileVosConfig` now default `tweenEngine` to
  `'vos'`, and `tweenBundleCode` defaults to `tweenRuntimeCode` from
  `@vosjs/tween` (already a dependency of `@vosjs/core`), so the deterministic
  recorder and sampler need nothing passed. A default render page no longer
  imports GSAP, no longer preloads it, and fetches nothing for it.

  Every renderer in this repo already passed `'vos'` explicitly; this makes the
  default match what they ship, and what the determinism guarantee assumes.

  Compatibility: the `gsap` import-map entry is still emitted, so a program
  compiled before this change keeps resolving its own `import gsap from 'gsap'`.
  Hosts that drive playback with real GSAP can opt back in with
  `tweenEngine: 'gsap'` on both calls. Passing an empty `tweenBundleCode` with
  the vos backend still throws.

  `@vosjs/studio-core` only widens its `@vosjs/core` peer range to admit the
  minor; it does not use this API.

## 0.23.7

### Patch Changes

- f12f2ac: The thumbnail capture settles its decodes the way the video loop does: the program's frame-prep hooks run after the seek, pending decodes are awaited, the frame is painted, and a paint that asked for more is waited for and painted again. One animation frame after a cold seek used to capture whatever a video element had already decoded, the first frame of a video seeked for the first time.

## 0.23.6

### Patch Changes

- 96aef60: The capture template takes `capture.stack` (each stack entry's data by id, the shape the bridge's LOAD carries) and hands it to `initVos` as `deps.stack`, so a host that resolves the main data's media URLs for a capture page can resolve the entries' too. Without it a program's own layers ran on the data baked into the module, and a relative key there (a studio image overlay on a hosted take) never loaded on a render page's synthetic origin: the still and the preview drew the words and lost the mark. render-core's `@vosjs/core/audio` pin follows the core patch.

## 0.23.5

### Patch Changes

- de94195: mediabunny moves from 1.27.3 to 1.55.7 everywhere it is pinned: the capture-video template's importmap, the recording composition's WebCodecs provider, the render harness's mux and the CLI's render and encode pages. Explicit bitrates render as before; a subjective quality (`QUALITY_HIGH` and friends) now means constant quality, which halves a screen recording's file for the same picture.

## 0.23.4

### Patch Changes

- 7cbd25e: `capture.encoder.contentHint` passes a WebCodecs content hint (`'text'` for screen content) to the capture-video encoder, so a software encoder can pick its screen-content tools.

## 0.23.3

### Patch Changes

- 2649873: Capture harnesses paint each frame once. A program can register frame-prep hooks (`window.__vos__.framePrep`, a Map by id) that a capture loop runs right after seeking the timeline and before the paint, so the decodes a frame needs are requested up front and awaited with `waitForVideosReady`; the capture-video template runs them by default (`capture.prepareFrame: false` keeps the two-phase settle for A/B measurement). studio-core's recording composition registers one: it asks the WebCodecs provider (or seeks the element, the webcam and the background loop) for the frame's source moment before ON_FRAME runs, and the paused step it uses is the same source ON_FRAME's `syncVid` runs, so the paint finds its target met and registers nothing. Every take frame used to paint twice, once with the previous footage and again after the decode, on every harness.

## 0.23.2

### Patch Changes

- 598cec7: READMEs rewritten against the current API: every example compiles against the exported signatures, each package lists its real exports, and stale package names and moved modules are gone.
- Updated dependencies [598cec7]
  - @vosjs/tween@0.8.2

## 0.23.1

### Patch Changes

- 3dc2a71: `mixAudio` treats a jump in source position between two plan points as a seek, not a sweep: a loop wrapping back to its start, or a `currentTime` set, plays on from the first point at native rate and lands at the second, the way an element seeks. It used to sweep through the source in one step, an audible click at every loop boundary.

## 0.23.0

### Minor Changes

- f02a80f: Retime the tweens, live. Bridge protocol 8: `SET_TWEEN_EDITS { edits }` applies a tween-timing overlay (`@vosjs/tween`'s `TweenEdit[]`) to the running program's recorded timeline — the frame under the playhead repaints, an `UPDATE` carries the new duration, and the overlay survives a warm `LOAD` (or rides one as `LOAD.tweenEdits`). `READY.canRetimeTweens` says the timeline honors it (the vos backend); on gsap a host bakes the overlay and loads instead. `VosTimeline.applyEdits?` names the optional surface.

  `@vosjs/editor`'s `classifyEdit` sends `SET_TWEEN_EDITS` when `LoweredProgram.tweenEdits` changes by reference, so a retime never changes the program string.

  `@vosjs/tween`: `RecordingTimeline.applyEdits` applies from the RECORDING every time (the specs are snapshotted on the first call), so re-applying a whole overlay is exact and an empty overlay restores the recording. It used to merge onto the previous overlay.

### Patch Changes

- Updated dependencies [f02a80f]
  - @vosjs/tween@0.8.1

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
