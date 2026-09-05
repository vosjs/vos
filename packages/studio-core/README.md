# @vosjs/studio-core

> The document model of a screen recording: the `ProjectDoc` schema, the planners that read a cursor track (auto-zoom, speed, tilt), the digest that lets an agent see a recording, and the lowering from a document to a vos program.

[![npm](https://img.shields.io/npm/v/@vosjs/studio-core.svg)](https://www.npmjs.com/package/@vosjs/studio-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so). This package holds the opinions that turn raw footage plus a cursor track into an editable, re-renderable video. It is pure logic: no DOM, no React, no engine import at run time (`@vosjs/core` is a peer for types). The generic editing mechanics (patch store, edit classifier, bridge client, view-model math) live in [`@vosjs/editor`](../editor); the time math in [`@vosjs/timeline`](../timeline). The `vos` CLI and the vos.so studio both build on this package, so a document cut on the command line opens in the studio with every span intact.

## Install

```bash
pnpm add @vosjs/studio-core
```

## The pipeline

```
RecordingArtifact ──projectFromArtifact──▶ ProjectDoc ──lowerStudioDoc──▶ { config, data, stack, duration }
 (footage + cursor track)   normalize capture space,   (doc.json: the      constant program + ctx.data,
                            plan zoom / speed / tilt    editable surface)   so every edit is live
```

- **`projectFromArtifact(artifact, videoUrl, { frame? })`** builds the initial `ProjectDoc` from a recording: normalize the capture space (`normalizeCaptureSpace`; a viewport crop for window takes via `deriveViewportCrop`, fail-closed below `CAPTURE_COVERAGE_MIN`), then seed the automatic spans. Returns `{ doc, videoUrl }`.
- **The planners** read the cursor track, never the pixels. `planAutoZoom(track, { width, height, style?, params? })` emits `source: 'auto'` zoom spans from click clusters (`z…`), typing sessions (`k…`) and dwells (`d…`); `planAutoSpeed` proposes speed-ups over idle gaps and scroll runs; `planAutoTilt` leans the card toward each zoom's focus. Every planner honors the wand contract: `source: 'manual'` spans are never touched, and a deleted proposal stays deleted (`rejectSpan` writes `doc.rejected`, `isRejected` filters the next plan).
- **`lowerStudioDoc(doc)`** lowers a document to a constant vos program plus a `ctx.data` payload. Zoom, tilt and cam-motion spans expand into output-time keyframe tracks; trims, speed, cursor follow, click effects and audio envelopes all bake into data. Because the program string is constant, edits replay live through `SET_DATA` and `SET_DURATION`; nothing recompiles for a retime or a zoom tweak. `lowerToComposition` is the recording-only path underneath it.

## Two documents, one editor

`StudioDoc = ProjectDoc | ProgramAnchorDoc`, discriminated on `source`. A `ProjectDoc` is a recording: footage, `segments` (the kept source spans), `zoom`, `speed`, `tilt`, `camMotion`, the frame and cursor styles, plus the shared layers. A `ProgramAnchorDoc` is a vos program that gained the same shared layers (text, image and video overlays, 3D objects, audio clips, speed spans, a tween-retime overlay) without those being written into its config. `anchorKindOf`, `isRecordingDoc` and `isProgramDoc` read the discriminator; `lowerProgramDoc` lowers the program kind. Hosted documents carry `docSchemaVersion` (`DOC_SCHEMA_VERSION`, currently 2) and are upgraded on read with `migrateHostedDoc`.

The shared layers lower as one engine `stack` entry, `STUDIO_ENTRY_ID` (`'vosso.studio'`), with its own data (`studioLayerData`), so either document kind hosts them and the engine's `SET_DATA { target }` updates them alone. `studioAudioPlan` turns the entry's audio clips and duck curve into the plan `@vosjs/core/audio` mixes.

## Time and space conventions

- **Seconds everywhere.** Zoom, speed, tilt and cam-motion spans and the cursor samples are anchored in source time, so they follow footage through trims. Overlays, audio clips and click effects are anchored in output time, so a title keeps its perceived length through a speed change. `ratedSegments`, `effectiveSegments`, `docOutputDuration` and `outputRangeToSource` are the remaps.
- **Normalized coordinates.** A zoom's `cx`/`cy` and an overlay's `transform.x`/`y` are fractions of the frame in `[0, 1]`, never pixels, so a document survives an aspect-ratio switch. `focusBounds` and `clampFocus` keep a focus inside the card at a given `level`.
- **Camera styles.** `ZOOM_STYLES` names eight camera personalities (`glide`, the default, then `focus`, `cinema`, `snappy`, `cut`, `keynote`, `drift`, `none`); a style parametrizes both the planner and the camera motion, and `doc.zoomParams` layers per-document overrides.
- **The stage.** `CARD_FOV`, `CARD_Z`, `OVERLAY_Z`, `BACKGROUND_Z` and `planeSizeAtDepth` define the frustum-filling planes the program draws (background, the tiltable card, the overlay); `cardVisibleExtent` and `cardOverscanFor` are how far a posed card is seen past the frame, which is what the card layer's canvas and plane grow by (so a lean over zoomed footage never shows the texture's edge); `computeCardLayout` and `docCardLayout` are the host-side mirror of the program's card math, pinned to it by tests.
- **Backdrops.** `withBackdrop(frame, backdrop)` and `backdropMedia` put a looping video or a still behind the card, output-anchored modulo its duration. The package carries the mechanism and `BASE_FRAME_STYLE`; which loop a host opens on is the host's choice.

## Seeing a recording: the digest

`momentsFromDoc`, `sceneChanges` and `buildDigest` derive the moments of a recording from its cursor track (click clusters, typing sessions, scroll runs, dwells, idle gaps, head, tail, frame-diff scene changes), each with source and output extents, a normalized focus rectangle a zoom span can copy, and the ids of the planner's proposals over it. `zoomCoversRect` and `zoomWindow` are the framing lint that closes the loop. The CLI's `vos digest` writes it as `digest.json` beside footage frames and crops; `STYLE_FIELDS`, `copyStyle` and `pickStyle` carry a signed-off document's look onto the next take.

## Destinations

`DESTINATIONS` is the table of launch destinations (store listings, Product Hunt, social, OG cards, README loops) with exact pixel sizes, byte and duration ceilings, generated from `channel-specs.json` in `@vosjs/cli` and hash-gated by a test. `destinationById`, `destinationsForChannel`, `exportSizeFor(ratio, resolution)` and `resolveExportSize` size an export; `ExportResolution` is `720p | 1080p | 2k | 4k`.

## Exports by area

| Area           | Exports                                                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ingest         | `projectFromArtifact`, `normalizeCaptureSpace`, `deriveViewportCrop`, `docToCropSpace`, `docToFullSpace`, `CAPTURE_COVERAGE_MIN`, `WINDOW_FOCUS_MIN`                                                                                                              |
| Document       | `StudioDoc`, `ProjectDoc`, `ProgramAnchorDoc`, `anchorKindOf`, `isRecordingDoc`, `isProgramDoc`, `DOC_SCHEMA_VERSION`, `migrateHostedDoc`, `DEFAULT_FRAME_STYLE`, `BASE_FRAME_STYLE`, the constants (`ZOOM_LEVELS`, `TILT_DEG_MAX`, …)                            |
| Planners       | `planAutoZoom`, `planAutoSpeed`, `planAutoTilt`, `smoothCursor`, `idleGaps`, `scrollRuns`, `rejectSpan`, `isRejected`, `withoutRejected`                                                                                                                          |
| Camera styles  | `ZOOM_STYLES`, `ZOOM_STYLE_OPTIONS`, `DEFAULT_ZOOM_STYLE`, `resolveZoomStyle`                                                                                                                                                                                     |
| Lowering       | `lowerStudioDoc`, `lowerProgramDoc`, `lowerToComposition`, `zoomTrackFromDoc`, `tiltTrackFromDoc`, `camTrackFromDoc`, `motionTrack`, `followFocusEvents`, `extractClicks`, `cursorIdleFade`, `ratedSegments`, `STUDIO_ENTRY_ID`, `studioEntry`, `studioLayerData` |
| Layout         | `computeCardLayout`, `docCardLayout`, `focusBounds`, `clampFocus`, `camBubbleRectAt`, `overlayRect`, `overlayHit`, `CARD_FOV`, `CARD_Z`, `planeSizeAtDepth`, `recommendedExportResolution`                                                                        |
| Text           | `TEXT_PRESETS`, `OVERLAY_FONT_FACES`, `resolveOverlayStyle`, `resolveOverlayBox`, `resolveText3dAsset`                                                                                                                                                            |
| Audio          | `studioAudioPlan`, `clipEnvelope`, `duckCurve`, `computePeaks`, `computeMicRms`, `voiceKey`, `musicBedClip`, `refillAudioBeds`                                                                                                                                    |
| Backdrops      | `withBackdrop`, `backdropMedia`                                                                                                                                                                                                                                   |
| Digest         | `momentsFromDoc`, `planForDigest`, `buildDigest`, `sceneChanges`, `zoomCoversRect`, `zoomWindow`, `cropBox`, `frameGeometry`, `STYLE_FIELDS`, `copyStyle`, `pickStyle`, `DIGEST_VERSION`                                                                          |
| Destinations   | `DESTINATIONS`, `destinationById`, `destinationsForChannel`, `exportSizeFor`, `resolveExportSize`, `ASPECT_RATIOS`                                                                                                                                                |
| Timeline lanes | `videoLane`, `micLane`, `camLane`, `zoomLane`, `tiltLane`, `camMoveLane`, `speedLane`, `overlaysLane`, `objectsLane`, `audioLane`; range actions `outputRangeToSource`, `removeSourceRange`, `setSpeedInRange`, `zoomSpanForRange`                                |

The full document shape is in [`src/types.ts`](src/types.ts); the JSON Schema that ships to users is [`doc.schema.json`](../cli/schema/doc.schema.json) in `@vosjs/cli`.

## Design rules

- **Never bake a document value into the program string.** The program is a structural hash; all editable state travels in `ctx.data`. Baking a value breaks live editing.
- **Lowering is deterministic.** No stateful springs, no wall clock: `seek(t)` is a pure function of `t`, so cursor follow, click effects and zoom are computed from the document up front.
- **Perception reads the recording, never the composition.** The planners and the digest read the cursor track and the footage; they never inspect a rendered frame.

## Development

```bash
pnpm --filter @vosjs/studio-core test
pnpm --filter @vosjs/studio-core typecheck
```

The test suite pins the invariants that are easy to break: the capture-space fail-closed matrix, zoom keyframe expansion, click extraction, layout-to-program parity, byte-identical lowering when a feature is absent, and the destinations hash. Extend it when touching the lowering.

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
