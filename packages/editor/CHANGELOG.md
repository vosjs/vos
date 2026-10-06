# @vosjs/editor

## 1.6.0

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

## 1.5.0

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

## 1.4.0

### Minor Changes

- 39bb447: Knobs stay honest.

  - `@vosjs/editor`: retyping or recolouring a text element whose `content`, `font.family` or `font.color` is bound to data (`{ $data: key }`) now writes `data[key]` and keeps the binding. It used to write a literal over the binding, so the knob and any later data patch stopped reaching that text. New export `boundDataKey`.
  - `@vosjs/cli`: `vos check` warns about every knob or Look vos.so would drop (past 12 knobs or 8 Looks, or a field over its limit), and `vos push` prints the warnings the platform returns.

## 1.3.1

### Patch Changes

- 598cec7: READMEs rewritten against the current API: every example compiles against the exported signatures, each package lists its real exports, and stale package names and moved modules are gone.

## 1.3.0

### Minor Changes

- f02a80f: Retime the tweens, live. Bridge protocol 8: `SET_TWEEN_EDITS { edits }` applies a tween-timing overlay (`@vosjs/tween`'s `TweenEdit[]`) to the running program's recorded timeline — the frame under the playhead repaints, an `UPDATE` carries the new duration, and the overlay survives a warm `LOAD` (or rides one as `LOAD.tweenEdits`). `READY.canRetimeTweens` says the timeline honors it (the vos backend); on gsap a host bakes the overlay and loads instead. `VosTimeline.applyEdits?` names the optional surface.

  `@vosjs/editor`'s `classifyEdit` sends `SET_TWEEN_EDITS` when `LoweredProgram.tweenEdits` changes by reference, so a retime never changes the program string.

  `@vosjs/tween`: `RecordingTimeline.applyEdits` applies from the RECORDING every time (the specs are snapshotted on the first call), so re-applying a whole overlay is exact and an empty overlay restores the recording. It used to merge onto the previous overlay.

## 1.2.0

### Minor Changes

- 7b4c1f2: `classifyEdit` knows the program stack: `LoweredProgram.stack` carries each entry's own data keyed by id, a `LOAD` sends it as `stack`, and an entry whose data changed by reference gets its own `SET_DATA { target }` (bridge protocol 5) while the main program's data and the other entries stay untouched.

## 1.1.0

### Minor Changes

- f49ab19: Live text editing. `ElementInstance.setContent` is real (previously a warn stub): non-split text elements re-measure, re-raster and swap geometry/texture IN PLACE — the mesh keeps its identity, so scene membership, render order and timeline bindings stay valid — then reposition to config truth. The props proxy gains raster-prop setters (`content`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `letterSpacing`, `color`, `strokeColor`, `strokeWidth`), coalesced on a microtask so a burst of writes re-rasters once. Bridge protocol bumps to 4: `SET_ELEMENT_PROPS` values may now be strings, enabling live content/color/family previews from editors. `@vosjs/editor` adds the matching durable commits, `setTextContentRecipe` and `setTextStyleRecipe` (font fields + stroke, null stroke removes). Split text stays structural (one mesh per unit); `setContent` on a split element warns and defers to a reload.

## 1.0.1

### Patch Changes

- 0a4a6e4: Improve npm discoverability metadata: query-matched descriptions, expanded keywords, and homepage pointing at vos.so/engine. No code changes.
- Updated dependencies [0a4a6e4]
  - @vosjs/core@0.5.1

## 1.0.0

### Patch Changes

- Updated dependencies [9e2f189]
  - @vosjs/core@0.5.0

## 0.2.0

### Minor Changes

- 6b5bc11: Element resize/rotate commit helpers, completing the on-canvas editing set:

  - **`scaleElementRecipe(config, id, factor)`** — corner-handle resize: folds a
    scale factor into `transform.scale` (floor-clamped so elements stay
    recoverable). Pairs with the ephemeral `props.scale` preview, which
    multiplies the same base — preview and commit land on identical pixels.
  - **`rotateElementRecipe(config, id, deltaDeg)`** — rotate-handle drag:
    accumulates into the canonical `transform.rotation` (folding any `rotateZ`
    alias), normalized to (-180, 180].
  - **`elementBaseRotation(config, id)`** — the committed rotation hosts need
    for ephemeral rotate previews (the props proxy's `rotation` is absolute).

## 0.1.0

### Minor Changes

- 5dae2b7: Initial release: headless editing infrastructure for vos compositions,
  extracted from its two proven consumers (a screen-recording studio timeline
  and an on-canvas element editor):

  - **`createProjectStore`** — patch-based document store (Immer): undo/redo,
    time-windowed drag coalescing (one undo entry per gesture), and a forward
    patch log. The app document is the source of truth; lowered compositions
    are derived.
  - **`classifyEdit`** — the live-edit tier classifier: program change → warm
    `LOAD`, data change → `SET_DATA`, duration change → `SET_DURATION` with a
    LOAD fallback. Program-string equality is the structural hash.
  - **`createEditorBridgeClient`** — host-side client for the engine's
    editor-mode playback bridge: requestId-correlated `HIT_TEST` /
    `GET_ELEMENT_RECTS`, timeout fallbacks, resize-push subscription, and the
    ephemeral `SET_ELEMENT_PROPS` drag-preview channel.
  - **Element-edit commit helpers** — `cssDeltaToDesign`, `propsForRectCenter`,
    `nudgeElementRecipe`: turn on-canvas drags into durable, undoable
    `transform.translate` config patches.
  - **Timeline view-model math** — `toPx`/`toTime`, nice-number `rulerTicks`,
    magnetic `snapTime`, and the `LaneAdapter` contract (including the
    gesture-anchoring rules that make live ripple-trims stable).

  Framework-free and UI-less by design: apps own their document schemas,
  lowerings, lanes, and rendering.
