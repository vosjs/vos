# @vosjs/editor

> Headless editing infrastructure for vos compositions — a patch-based document store, the live-edit classifier, the editor-mode playback bridge, element-edit commit helpers, and timeline view-model math.

[![npm](https://img.shields.io/npm/v/@vosjs/editor.svg)](https://www.npmjs.com/package/@vosjs/editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open visual operating system behind [vosso](https://vos.so). These are the shared mechanisms every vos editor needs, with **zero UI opinion**. Apps own their document schemas, lowerings, and all rendering; this package owns only the mechanics. Pairs with [`@vosjs/timeline`](../timeline) for the underlying time math and with the `@vosjs/core` playback bridge.

## Install

```bash
pnpm add @vosjs/editor
```

## What it gives you

- **`createProjectStore`** — a patch-based document store (Immer) with undo/redo, drag coalescing, and a forward patch log. The app's document is the source of truth; lowered compositions are derived from it.
- **`classifyEdit`** — the live-edit tier classifier that keeps editing fast: a program-string change → warm `LOAD`, a data change → `SET_DATA`, a duration change → `SET_DURATION` (with `LOAD` fallback). Program-string equality is the structural hash.
- **`createEditorBridgeClient`** — the host-side client for the engine's editor-mode playback bridge: element hit-testing, bounds, and ephemeral property overrides for drag previews.
- **Element-edit commit helpers** — turn on-canvas drags into durable, undoable config patches (`nudgeElementRecipe`, `scaleElementRecipe`, `rotateElementRecipe`, `cssDeltaToDesign`, …).
- **Timeline view-model math** — px↔time mapping (`toPx`/`toTime`), ruler ticks, magnetic snapping, plus the `LaneAdapter` contract so apps can define their own timeline lanes.

## Example

```ts
import { createProjectStore, classifyEdit } from '@vosjs/editor'

const store = createProjectStore({ doc: initialDoc })

store.apply((draft) => {
  draft.duration = 12
})

// decide how the running player should apply the change — no full reload for a data edit
const command = classifyEdit(prevLowered, nextLowered)
```

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
