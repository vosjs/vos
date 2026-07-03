# @vosjs/editor

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
