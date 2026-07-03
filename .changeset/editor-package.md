---
'@vosjs/editor': minor
---

Initial release: headless editing infrastructure for vos compositions,
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
