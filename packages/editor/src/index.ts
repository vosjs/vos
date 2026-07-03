/**
 * @vosjs/editor — headless editing infrastructure for vos compositions.
 *
 * The shared mechanisms every vos editor needs, with zero UI opinion:
 *
 *  - `createProjectStore` — patch-based document store (Immer): undo/redo,
 *    drag coalescing, forward patch log. The app's document is the source of
 *    truth; lowered compositions are derived.
 *  - `classifyEdit` — the live-edit tier classifier: program change → warm
 *    LOAD, data change → SET_DATA, duration change → SET_DURATION (with LOAD
 *    fallback). Program string equality is the structural hash.
 *  - `createEditorBridgeClient` — host-side client for the engine's
 *    editor-mode playback bridge (element hit-testing, bounds, ephemeral
 *    property overrides for drag previews).
 *  - element-edit commit helpers — turn on-canvas drags into durable,
 *    undoable `transform.translate` config patches.
 *  - timeline view-model math — px↔time mapping, ruler ticks, magnetic
 *    snapping — plus the `LaneAdapter` contract for app-defined lanes.
 *
 * Apps own their document schemas, lowerings, and all UI; this package owns
 * only the mechanics. Pairs with `@vosjs/timeline` (deterministic time math)
 * and the `@vosjs/core` playback bridge.
 */
export { createProjectStore } from './store'
export type {
  ApplyOptions,
  Command,
  Patch,
  ProjectStore,
  Recipe,
  StoreOptions,
} from './store'
export { classifyEdit } from './classify'
export type { LoweredProgram, SessionCommand } from './classify'
export { createEditorBridgeClient } from './editorBridge'
export type { EditorBridgeClient, ElementRect } from './editorBridge'
export {
  DESIGN_HEIGHT,
  cssDeltaToDesign,
  elementBaseRotation,
  elementConfigId,
  nudgeElementRecipe,
  propsForRectCenter,
  rotateElementRecipe,
  scaleElementRecipe,
} from './elementEdit'
export { formatTime, rulerTicks, snapTime, toPx, toTime } from './viewModel'
export type { SnapOptions, Tick, TimelineViewport } from './viewModel'
export type { LaneAdapter, LaneGesture, LaneItem } from './lanes'
