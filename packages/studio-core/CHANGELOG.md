# @vosjs/studio-core

## 0.3.1

### Patch Changes

- Updated dependencies [7b25557]
  - @vosjs/shared@0.3.0

## 0.3.0

### Minor Changes

- 007529f: The backdrop a new take opens on is the host's pick, not the document model's. `@vosjs/studio-core` keeps the mechanism only: `withBackdrop(frame, backdrop)` and `backdropMedia(backdrop)` write a loop and its ground onto a frame, `BASE_FRAME_STYLE` is exported as the frame with no backdrop, `DEFAULT_FRAME_STYLE` is that bare frame, and `projectFromArtifact(artifact, url, { frame })` opens a take on whatever frame the host hands it (the browser bar is still derived from the footage). `DEFAULT_BACKDROP`, `BACKDROP_DEFAULT_ON`, `defaultBackdropMedia` and `withDefaultBackdrop` are removed. The stub compositor tests build on `BASE_FRAME_STYLE`.

  `vos record`, `vos create` and `vos plan` open a fresh take on the platform's house backdrop: the first ready loop of `GET /api/backdrops` (the set the studio publishes), with its poster, period and ground. `--background <slug|url|none>` picks another or none; when the set cannot be read the take opens on the bare frame and the command says so. A `--style` or `--reuse` reference's frame still wins.

## 0.2.1

### Patch Changes

- Updated dependencies [a3ab9f8]
  - @vosjs/shared@0.2.0

## 0.2.0

### Minor Changes

- 14799a9: A deleted planner proposal stays deleted. `doc.rejected` records the lane and the source extent of an `auto` zoom, tilt or speed span that was removed (its step anchor along with it), and every re-plan drops a fresh proposal that lands on it: `vos plan`, `plan --reuse` (which re-times the rejections onto the new footage the way it re-times manual spans) and the studio's re-plans through the new `isRejected` / `withoutRejected` / `rejectSpan` helpers. `vos validate` lints the list; `schema/doc.schema.json` documents it.
