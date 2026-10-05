# @vosjs/render-core

## 0.3.20

### Patch Changes

- 2a65524: The audio page imports `@vosjs/core` 0.27.1's audio module, the core a host installs beside this release.

## 0.3.19

### Patch Changes

- Updated dependencies [4415d33]
  - @vosjs/studio-core@0.37.0

## 0.3.18

### Patch Changes

- Updated dependencies [d5f0a8b]
  - @vosjs/studio-core@0.36.0

## 0.3.17

### Patch Changes

- d2d28bf: The audio page imports `@vosjs/core` 0.27.0's audio module, the core a host installs beside this release.

## 0.3.16

### Patch Changes

- Updated dependencies [f2a2230]
- Updated dependencies [53057e5]
  - @vosjs/studio-core@0.35.0

## 0.3.15

### Patch Changes

- Updated dependencies [081ac42]
- Updated dependencies [4feac4f]
- Updated dependencies [1579f50]
  - @vosjs/studio-core@0.34.0

## 0.3.14

### Patch Changes

- 8e59b72: The audio page imports `@vosjs/core` 0.26.1's audio module, the core a host installs beside this release.

## 0.3.13

### Patch Changes

- f3bb7f5: The audio page imports `@vosjs/core` 0.26.0's audio module, the core a host installs beside this release.

## 0.3.12

### Patch Changes

- da2728a: The audio page imports `@vosjs/core` 0.25.6's audio module, the core a host installs beside this release.

## 0.3.11

### Patch Changes

- e8f1f28: The audio page imports `@vosjs/core` 0.25.5's audio module, the core a host installs beside this release.

## 0.3.10

### Patch Changes

- d3ad899: The audio page imports `@vosjs/core` 0.25.4's audio module, the core a host installs beside this release.

## 0.3.9

### Patch Changes

- df479e8: The audio page imports `@vosjs/core` 0.25.3's audio module, the core a host installs beside this release.

## 0.3.8

### Patch Changes

- f4ec253: The audio page imports `@vosjs/core` 0.25.2's audio module, the core a host installs beside this release.
  - @vosjs/studio-core@0.33.1

## 0.3.7

### Patch Changes

- Updated dependencies [fca054a]
  - @vosjs/studio-core@0.33.0

## 0.3.6

### Patch Changes

- Updated dependencies [bd00ca2]
  - @vosjs/studio-core@0.32.0

## 0.3.5

### Patch Changes

- a335999: The clock-driven motion loops (`clockMotion`, `clockTyping`) yield a tick when a sample cost no clock time. On a Cloudflare Worker `Date.now()` advances only across I/O, so a scroll tick that owed no pixels yet awaited nothing, read the same instant, computed a zero wait and spun on a frozen clock for good: the fleet's first three clock-driven scrolls each held a session until they were canceled by hand. The pointer never hit it because its every sample awaits a mouse move. Pinned by a test on a clock that moves only while sleeping.

## 0.3.4

### Patch Changes

- d77f269: A scroll step moves the page's own scroll container by the clock, inside the page: each tick evaluates a `scrollBy` on the first scrollable ancestor under the cursor (else the window), which returns at once. Not wheel events, whose CDP dispatch waits for the renderer to handle them and never returns from a tab that paints no frame for a small delta, which a connected fleet browser's background tab is; not `requestAnimationFrame`, which such a tab never fires; not a page timer, which it throttles to once a second. Under a software-rasterized browser the same scroll now records every frame of its travel (44 distinct frames where the chunked wheel gave 16) and no torn composite, because a layout moved by `scrollTo` composites whole.

## 0.3.3

### Patch Changes

- 6d32377: The scroll's "painted" signal is the screencast's next frame, capped at 80 ms, never `requestAnimationFrame`: Chrome fires no animation frame in a tab that is not its window's active one, and a connected fleet browser records in exactly that tab while CDP keeps the screencast flowing, so the previous patch's scroll waited forever there. A rehearsal, which has no screencast, skips the wait.

## 0.3.2

### Patch Changes

- 8fc1560: The recorder's scroll travels by the clock, like the pointer: each tick sends the wheel delta the eased position owes (0.9 ms per px, a 240 ms floor, a 1000 ms cap) and waits for the page to paint a frame before the next, so every captured frame is a settled composite and the motion is paced by the clock rather than by whatever the browser's own smooth scroll manages to draw. On a software-composited browser the old 120 px chunks with a 40 ms sleep landed as five jumps held by the encoder, with a torn frame where the sticky nav and the content were captured at different offsets. The travel now counts as gesture time in the pace report.

## 0.3.1

### Patch Changes

- Updated dependencies [e0e8545]
  - @vosjs/studio-core@0.31.0

## 0.3.0

### Minor Changes

- e7e9e24: `@vosjs/render-core/record`: the recorder's mechanism, host-free. The step executor with its clock-driven pointer, the screencast collector, the cursor synthesis, the pace and dead-time accounting, the wall probe and verdict, the exposure scan and masks, the `setup` steps, `actions.json` validation, the frames-to-WebM encode page and the fresh plan of a take all live here now, over a structural driver that Playwright's `Browser` and `@cloudflare/playwright`'s both satisfy, with frames leaving through a `FrameSink` instead of a filesystem. Every vos.so fact (the hosted cap, the default origin, the house backdrop) is handed in by the host. The CLI wraps it with a take directory; a fleet wraps it with object storage and a connected browser.

## 0.2.9

### Patch Changes

- 7c1bb48: The audio producer decodes every source through an `OfflineAudioContext` pinned to the mix rate (48 kHz), never a bare `AudioContext`. `decodeAudioData` resamples to its context's rate, and a live context runs at the output device's, so a headset in its hands-free profile (24 kHz) handed the encoder stereo at 24 kHz, which mediabunny reads as HE-AAC v2 and Chrome's AAC encoder refuses. The offline context also holds no device and needs no gesture.

## 0.2.8

### Patch Changes

- 244c1bd: An EMPTY timeline under a declared `duration` is a carrier of that length. A program whose `createTimeline` returns a bare timeline (a ground under studio layers, a scene that only reads `ctx.time`) had a 0 s timeline the play driver never wrapped, so the studio's transport counted past the duration forever with the playhead pinned at the end. The compiled program now pads such a timeline to `duration` and marks it `vosCarrier`, so playback wraps at the duration like every program and a duration edit retimes live. render-core's `@vosjs/core/audio` pin moves with the release.

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
