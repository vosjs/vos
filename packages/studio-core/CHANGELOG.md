# @vosjs/studio-core

## 0.5.0

### Minor Changes

- c6fdb8f: The release kit composes. studio-core: `frame.inset` (per-side card placement as fractions, a negative side bleeds), `frame.shadowContact` and `frame.shadowColor`, a pure `look` module (plate, gradient, dark; `lookFromBrand`, `cardInset`, `applyLook`), `frame.entrance` (tilt-in, pull-out, rise) lowered into the tilt or zoom track's head plus a card-pose track, a segment `hold`, `doc.endCard`, `frame.focusFollow`; the channel specs carry a word policy, a safe rect and a default poster template per destination.

  CLI: `vos deliver` presents cards and cuts in a look read from `BRAND.md` beside the take (or `--look`), picks its still moments from the step timeline and drops blank or duplicate frames with the reason, renders every card destination from a bundled poster template (`split-cover`, `card-on-gradient`) filled with the brand's colours and faces and `LAUNCH.md`'s headline, bakes the shot as an object, and plans each video by kind (entrance, end card, beat captions from `actions.json`, a music bed and click sounds where the channel plays sound, the 9:16 reframe). `vos validate <kit.json> --picture` reads what each asset looks like (blank, duplicate, subject, separation, halfsize, sliced, safe, contrast, firstlast) with a code, a fix hint and a box. `vos judge <kit.json> --against <manifest>` composes pairwise sheets beside a reference set and reports the win rate. `vos brand` writes a `look` role.

## 0.4.1

### Patch Changes

- 598cec7: READMEs rewritten against the current API: every example compiles against the exported signatures, each package lists its real exports, and stale package names and moved modules are gone.
- Updated dependencies [598cec7]
  - @vosjs/timeline@0.4.1
  - @vosjs/editor@1.3.1
  - @vosjs/shared@0.4.1

## 0.4.0

### Minor Changes

- baaa9c8: The overlay preset faces resolve through the hosted font catalog instead of three literal URLs, so the package carries no URL of its own (same bytes, same faces). The digest's `images.tokensEstimateClaude` is `images.tokensEstimate`; the old key is emitted beside it for one minor.

### Patch Changes

- Updated dependencies [baaa9c8]
  - @vosjs/shared@0.4.0

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
