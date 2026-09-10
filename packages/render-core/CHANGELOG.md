# @vosjs/render-core

## 0.2.7

### Patch Changes

- aa86c71: Move the pinned `@vosjs/core/audio` CDN build to 0.24.0

  `CORE_AUDIO_CDN_URL` is the `mixAudio` build a render page imports, pinned by
  hand because render-core has no engine dependency. It still named 0.23.7,
  so a fleet audio page would mix with a build older than the engine its host
  runs. No behavior change beyond the version the page fetches.

## 0.2.6

### Patch Changes

- f12f2ac: The audio producer's engine pin moves to @vosjs/core 0.23.7.

## 0.2.5

### Patch Changes

- 07eaaea: The audio splice treats a segment of another media (concat) as silence of its own output length: its seconds are not this file's.

## 0.2.4

### Patch Changes

- 96aef60: The capture template takes `capture.stack` (each stack entry's data by id, the shape the bridge's LOAD carries) and hands it to `initVos` as `deps.stack`, so a host that resolves the main data's media URLs for a capture page can resolve the entries' too. Without it a program's own layers ran on the data baked into the module, and a relative key there (a studio image overlay on a hosted take) never loaded on a render page's synthetic origin: the still and the preview drew the words and lost the mark. render-core's `@vosjs/core/audio` pin follows the core patch.

## 0.2.3

### Patch Changes

- de94195: mediabunny moves from 1.27.3 to 1.55.7 everywhere it is pinned: the capture-video template's importmap, the recording composition's WebCodecs provider, the render harness's mux and the CLI's render and encode pages. Explicit bitrates render as before; a subjective quality (`QUALITY_HIGH` and friends) now means constant quality, which halves a screen recording's file for the same picture.

## 0.2.2

### Patch Changes

- 9292f58: The audio mix page imports `@vosjs/core/audio` at 0.23.3, the current engine.

## 0.2.1

### Patch Changes

- 598cec7: READMEs rewritten against the current API: every example compiles against the exported signatures, each package lists its real exports, and stale package names and moved modules are gone.

## 0.2.0

### Minor Changes

- 7b25557: The fleet's pages leave the package: `buildFinalizeConcatPage`, `buildAudioMixPage`, `buildDigestPage` and `buildImageDiffPage` were a hosted render fleet's own harness (an ingest route's part names, a finalize stage contract, an ops canary), not the render math any host needs. What stays is what the local `vos render` runs: `planChunks`, the mediabunny concat and mux, and the audio producer. A host that needs those pages keeps them beside its queue consumer, in sync with `concat.ts` for packet parity.
