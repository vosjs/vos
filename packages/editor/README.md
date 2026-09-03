# @vosjs/editor

> Headless editing infrastructure for vos compositions: a patch-based document store with undo, the live-edit classifier, the editor-mode bridge client, element-edit recipes and timeline view-model math.

[![npm](https://img.shields.io/npm/v/@vosjs/editor.svg)](https://www.npmjs.com/package/@vosjs/editor)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so). These are the mechanisms every vos editor needs, with no UI opinion: apps own their document schema, their lowering and all rendering; this package owns the mechanics. Framework-free; the one dependency is Immer. `@vosjs/core` is a peer for the bridge types.

## Install

```bash
pnpm add @vosjs/editor
```

## What it gives you

- **`createProjectStore(initialDoc, options?)`.** A patch-based document store: `get`, `apply(recipe, { coalesceKey?, label? })`, `undo`, `redo`, `canUndo`, `canRedo`, `subscribe((doc, patches) => …)`. Consecutive edits sharing a `coalesceKey` within `coalesceMs` (default 400) collapse into one undo entry, which is how a drag becomes one step; a recipe that changes nothing is dropped; the forward patches reach subscribers on every change, so an autosave can ride them.
- **`classifyEdit(prev, next, canSetDuration)`.** The live-edit classifier that keeps editing fast. It compares two `LoweredProgram`s (`{ program, data?, duration?, stack?, tweenEdits? }`) and returns the bridge commands to send: a changed program string means a warm `LOAD`; a data change `SET_DATA`; a stack entry's data change `SET_DATA { target }` for that entry alone; a tween-overlay change `SET_TWEEN_EDITS`; a duration change `SET_DURATION` when the player can, else `LOAD`. Program-string equality is the structural hash, so a lowering that keeps its program constant gets zero reloads.
- **`createEditorBridgeClient(post, { timeoutMs? })`.** The host side of the engine's editor-mode bridge: `hitTest(x, y)`, `getElementRects()`, `setElementProps(id, props)` for ephemeral drag previews, `onRects`, `handleEvent`, `reset`.
- **Element-edit recipes.** Turn an on-canvas gesture into a durable, undoable config patch: `nudgeElementRecipe`, `scaleElementRecipe`, `rotateElementRecipe`, `setTextContentRecipe`, `setTextStyleRecipe`, with `cssDeltaToDesign`, `propsForRectCenter`, `elementBaseRotation` and `DESIGN_HEIGHT` (1080) for the CSS-to-design-space math.
- **Timeline view-model math.** `toPx` and `toTime` over a `TimelineViewport`, `rulerTicks`, `snapTime` with magnets, `formatTime`, and the `LaneAdapter` contract (`items`, `gesture`, `magnets`) so an app defines its own lanes over its own document.

## Example

```ts
import { createProjectStore, classifyEdit } from '@vosjs/editor'

const store = createProjectStore(initialDoc, { coalesceMs: 400 })

store.apply(
  (draft) => {
    draft.duration = 12
  },
  { label: 'Set duration' },
)
store.subscribe((doc, patches) => autosave(patches))

// decide how the running player applies a change: no reload for a data edit
const commands = classifyEdit(prevLowered, nextLowered, ready.canSetDuration)
for (const command of commands) player.postMessage(command)
```

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
