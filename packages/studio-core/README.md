# @vosso/studio-core

The studio's editing model. This package holds the product opinions that turn a raw
screen recording into an editable, re-renderable video: the `ProjectDoc` schema,
the element-aware auto-zoom planner, and the lowering that compiles a doc down to
a vos composition.

It is pure logic — no DOM, no React, no vos-render dependency. The generic
editing mechanisms (patch store, edit classifier, editor-bridge client, timeline
view-model) live in the open-source [`@vosjs/editor`](https://www.npmjs.com/package/@vosjs/editor);
what stays here is studio-specific. Consumed in-source by the vosso web app and bundled
into [`@vosso/vos-plugin`](../vos-plugin). MIT.

## The pipeline

```
RecordingArtifact ──projectFromArtifact──▶ ProjectDoc ──lowerToComposition──▶ { config, data, duration }
   (footage +          (normalize capture      (editable       (constant program +
    cursor track)       space, plan zoom)        document)       ctx.data — live edits)
```

- **`projectFromArtifact(artifact)`** — build the initial `ProjectDoc` from a
  recording: normalize the capture space (`normalizeCaptureSpace`, viewport crop
  for window takes), then seed auto-zoom.
- **`planAutoZoom(doc, options)`** — element-aware zoom planner. Emits
  `source: 'auto'` spans from click/dwell clusters; honors the wand contract
  (never touches `source: 'manual'` spans). Camera dynamics come from a named
  style preset (`ZOOM_STYLES` — glide / focus / cinema / snappy / cut).
- **`lowerToComposition(doc)`** — lower the doc to a **constant** vos program
  plus a `ctx.data` payload. Zoom spans expand into an output-time keyframe
  track; trims, speed, cursor follow, click effects, and audio envelopes all bake
  into `data`. Because the program string is constant, edits replay live via
  `SET_DATA`/`SET_DURATION` — nothing recompiles for a retime or a zoom tweak.

## Key exports

| Area           | Exports                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Ingest         | `projectFromArtifact`                                                                                                         |
| Capture space  | `normalizeCaptureSpace`, `deriveViewportCrop`, `docToCropSpace`, `docToFullSpace`, `CAPTURE_COVERAGE_MIN`, `WINDOW_FOCUS_MIN` |
| Planner        | `planAutoZoom`, `smoothCursor`                                                                                                |
| Zoom styles    | `ZOOM_STYLES`, `DEFAULT_ZOOM_STYLE`, `resolveZoomStyle`                                                                       |
| Lowering       | `lowerToComposition`, `zoomTrackFromDoc`, `followFocusEvents`, `extractClicks`, `ratedSegments`                               |
| Layout / focus | `computeCardLayout`, `docCardLayout`, `focusBounds`, `clampFocus`, `recommendedExportResolution`                              |
| Audio          | `clipEnvelope`, `duckCurve`, `computePeaks`, `computeMicRms`                                                                  |
| Timeline lanes | `zoomLane`, `speedLane`, `camLane`, `audioLane`, `videoLane`                                                                  |

See [`src/types.ts`](src/types.ts) for the full `ProjectDoc` shape.

## Design rules

- **Never bake doc values into the program string.** The program is a structural
  hash; all editable state travels in `ctx.data`. Baking values breaks live editing.
- **Lowering is deterministic.** No stateful springs or wall-clock — `seek(t)` must
  be a pure function of `t`, so cursor follow, click effects, and zoom are all
  computed from the doc up front.
- **Source-anchored spans.** Zoom and speed spans are anchored in source time and
  follow footage through trims; the lowering remaps them to output time.

## Development

```bash
pnpm --filter @vosso/studio-core test       # vitest
pnpm --filter @vosso/studio-core typecheck
```

The `__tests__` suite pins the invariants that are easy to break — capture-space
fail-closed matrix, zoom keyframe expansion, click extraction, layout↔ON_FRAME
parity. Extend them when touching lowering.
