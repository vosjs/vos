# @vosjs/studio-core

## 0.19.0

### Minor Changes

- 9ebcc7f: A `kind: 'html'` overlay clip: a UI component authored as markup and CSS, laid out and painted by the browser in the page and composited over the footage, sharp at any export size. The document keeps the source; the lowering hands the page a content-addressed key and the faces the CSS names, resolved against the catalog; the page inlines the faces, builds a `data:` foreignObject SVG, keeps the previous picture while an edit rasterizes, drops stale builds, and fails closed per layer on a browser that taints. `htmlLayerProblems` is the pure gate (the XML rules, the wall-clock warning, the unhosted family, the media fields a layer refuses), `htmlStarters` the five house starters, and `isKeyedOverlay` the predicate every "this layer has a key" site must use instead of `kind !== 'text'`.

## 0.18.1

### Patch Changes

- 7282032: Default the tween backend to `'vos'`

  `generateRenderTemplate` and `compileVosConfig` now default `tweenEngine` to
  `'vos'`, and `tweenBundleCode` defaults to `tweenRuntimeCode` from
  `@vosjs/tween` (already a dependency of `@vosjs/core`), so the deterministic
  recorder and sampler need nothing passed. A default render page no longer
  imports GSAP, no longer preloads it, and fetches nothing for it.

  Every renderer in this repo already passed `'vos'` explicitly; this makes the
  default match what they ship, and what the determinism guarantee assumes.

  Compatibility: the `gsap` import-map entry is still emitted, so a program
  compiled before this change keeps resolving its own `import gsap from 'gsap'`.
  Hosts that drive playback with real GSAP can opt back in with
  `tweenEngine: 'gsap'` on both calls. Passing an empty `tweenBundleCode` with
  the vos backend still throws.

  `@vosjs/studio-core` only widens its `@vosjs/core` peer range to admit the
  minor; it does not use this API.

## 0.18.0

### Minor Changes

- df692d7: Transitions at a boundary. A footage clip's `anim` says how it meets the clip beside it (`exit` at the boundary after it, `enter` at the one before: `slide`, `fade`, `scale` or `none`; a slide names its `side`, a step its `seconds`), and the card's own enter gains `slide`. The lowering turns every boundary that moves into a record in output seconds; the incoming clip plays live while the outgoing card, frozen on its last frame, moves away on a second plane fed by a ghost element (so a cold seek in an export chunk decodes it like any frame, and one recording can be both cards at a page change); the camera rests through the window; one cursor dot crosses in frame space. The recorder marks steps that changed the page's URL, `vos plan` proposes a transition at each (`transitions:` in LAUNCH.md or `--transitions`), and `vos validate` lints the kinds and refuses a transition longer than half the shorter clip.

## 0.17.0

### Minor Changes

- 20e8b1a: Many cards: a media overlay may show a document media by reference (`media:<id>`, its facts with it) and wear a card (`frame`: a browser bar, a lean, the layered shadow), drawn by the card painter on its own plane above the primary card with the media's cursor and clicks inside it. A layer without a frame stays the flat picture, byte-identically.

## 0.16.0

### Minor Changes

- e0e0b2c: The frame that stands for a document is one derivation, `docStillTime`: the author's own `still` (output seconds) wins, else the last freeze the document owns (a template's freezes, stamped `from`, never count), else the hero moment after the card and the opening clips have entered, else the old 0.5 s. An own freeze at the end of a take survives an end card laid on it.

## 0.15.1

### Patch Changes

- fa700ab: An end card laid on a take of many media freezes the LAST clip on its own media: the trailing freeze a template carries (`applyTemplate`) and the one `vos plan` proposes name the media under the last clip, instead of landing their seconds on the primary's footage.

## 0.15.0

### Minor Changes

- 9011941: A media wears its own card. `media[].frame` carries the card-owned fields (placement and size as `inset`, the browser bar, the corner, the shadow, the border, the cover fit and its focus) over the take's frame while that media plays; the bar names the media's recorded page, and an upload with no page wears none. `mediaFrame` resolves it, `docCardLayout` takes the media to lay out, the lowering hands the resolved card to ON_FRAME.

## 0.14.0

### Minor Changes

- 07eaaea: Many media in one take (concat): `doc.media` holds a take's other media (the `source` shape with an `id`), a segment and every source-anchored span (zoom, tilt, speed, freeze, cam move, a rejected proposal) name their media by that id, and an absent `media` is the primary, `doc.source`. The rated list keeps each piece's media (a segment is rated by its own media's speed spans, a freeze lands on the media it names), the span-to-track mappers and the lanes map a span through its media's pieces only, the lanes stamp a new span with the media under the playhead, the lowering hands every media to setup (one element each, decoded like the primary) with its own cursor, space and clicks, and ON_FRAME drives the element under the playhead and rests the others. A document with one media lowers byte-identically.

## 0.13.1

### Patch Changes

- a460b63: The card's layered shadow gains a wide, faint ambient bloom (120 design px of blur, dropped well below the card) beside a lighter hairline and two grounding layers, so a large card on a light ground reads as lifted rather than outlined. `frame.shadow` stays the one strength the layers share.

## 0.13.0

### Minor Changes

- e4328d2: The card is on screen exactly while its clip runs (the footage, freezes included) and is gone after it, like every layer: past the footage the clips play over the ground alone, and the card's `anim.exit` plays over the clip's last seconds and ends gone (a recede steps back first and fades last). An end card is a freeze of the last frame under its words: a legacy `endCard` migrates to one, the house end card writes one (`from: 'endcard'`), a template that ends on a freeze lays it onto the take with its clips, and a loop drops it with them. A freeze takes `from`.

## 0.12.0

### Minor Changes

- 680fc50: A freeze is a retime primitive beside the speed spans: `doc.freeze` holds source moments frozen for output seconds, anywhere in the footage, placed by the lowering as rated pieces from one seam (`placeFreezes`), drawn by a `freezeLane` on the same row as the speed bands, and read as the rest where the last one begins. A segment's `hold` is the legacy spelling, migrated on read into a freeze at that segment's end (hosted documents step to schema version 4). The CLI's schema and lints take `freeze`, `plan --reuse` re-times freezes like the manual spans, and `plan --style <poster>` carries the trailing freeze.

## 0.11.1

### Patch Changes

- a247147: The footage element stays paused on its last frame past the footage's end and inside a hold's freeze piece while the composition plays. An ended element's `play()` rewinds it to zero and the drift guard then seeks it back, which read as frames jumping back and forth under an end card; a hold crawling at the clamped 1/16 speed toward that same end was the same bug in slow motion.

## 0.11.0

### Minor Changes

- 58a9812: One animation vocabulary on every visual primitive, and the output ends at the last clip.

  - `anim` (`enter`, `exit`, `idle`; a kind, or a step with its seconds and, for words, the per-unit grammar) on the card (`frame.anim`), on text, image and video clips, and on props. `frame.entrance`, a clip's `enter`, `exit` and `fx`, and a prop's `animation` are read into it on migration and lower to the same picture; the fields stay accepted as legacy input for one cycle.
  - The output lasts until the last visual clip ends (`docOutputDuration`, the lowering's `duration`); past its footage the card holds its last frame at the pose its `anim.exit` settled into (`recede` keeps it small and dim behind whatever plays after it, `fade` takes it out), and a `hold` stays the freeze primitive. A document that ends on its footage lowers byte-identically. Audio never extends the output.
  - `doc.endCard` migrates on read into clips placed after the footage (stamped `from: 'endcard'`) plus a card `exit` of `recede`, so an end card is nothing but primitives a timeline can show and a person can retype in place. `expandEndCard` survives, deprecated.
  - `from` on overlay, prop and audio clips: the template that placed them, provenance the lowering never reads.
  - `applyTemplate(template, take, { at, words, keys, from, look })`: a template is a plain take document on a shelf, applied at an anchor (`start`, `end`, or an output second) with the release's words and keys patched in by id; `clipsFrom` and `dropTemplate` read and remove what one template placed. `copyLayout` stays, and a layout's frame fields now carry the card's `anim` in place of `entrance`.
  - `docSchemaVersion` 3; `migrateHostedDoc` rewrites a recording document's motion spellings into the vocabulary.
  - The CLI's schema and `vos validate` accept `anim` and `from`, checked per primitive (the card cannot typewrite, a word cannot tilt in, only a prop idles).

## 0.10.0

### Minor Changes

- ea7f169: A poster is a document, and `vos deliver` renders it. A layout is a poster document on a shelf, never a name the document learns: studio-core gains `copyLayout` (and `copyStyle(from, to, { layout: true })`), which carries an exemplar's card placement and presentation (`LAYOUT_FRAME_FIELDS`), its `stage-*` clips by id (a same-id text clip keeps the words this take already has, an image clip keeps its own key or takes one handed in), its rest lean as a whole-take `rest` span where the take has no tilt spans, and its trailing hold; `layoutOf` reports what a document carries, and `docRestTime` is the one convention for THE REST (the trailing hold's start, null with an end card), for every still-taking surface. `vos plan --style <poster>` carries the layout and patches the release's words into the stage clips (LAUNCH.md's headline and kicker roles, BRAND.md's wordmark, or `--headline` and `--kicker`); the brand's mark is fetched into `<take>/brand/` for the layout's `stage-mark` and the end card. The cut's MOTION is the document's too: `vos plan` proposes the card's entrance, the end card, a caption per actions.json step, a music bed and click sounds from LAUNCH.md's roles on a fresh plan (`--motion` re-proposes onto an existing doc.json, replacing only its own ids and fields), so the studio shows exactly what the kit renders and a deleted proposal stays deleted. `vos deliver` composes nothing any more: card-genre destinations render from the poster document of their aspect class (landscape, square, portrait, tile), found beside the take as `poster/<class>/doc.json` (`poster/doc.json` serves every class) or named in LAUNCH.md (`poster: <path>`, `poster-<class>: <path>`; a path to a doc.json, or to a pulled poster take that renders over its own footage), at the document's rest; kit.json records `source: 'poster'`, the class, the file, the vos it tracks, and the shot rect and text boxes read from the document, which `vos validate --picture` checks. A class with no document is the take's own frame, said once. Deliver applies each video destination's mechanics and no taste: the README loop drops the entrance, the end card, the captions and the sound; a channel that autoplays muted drops the bed; the 9:16 cut reframes and follows the camera. Removed: `--poster`, `--shot-time`, `--poster-time` and the bundled template and stage legs from `deliver`, whose `--headline`, `--kicker`, `--music`, `--entrance`, `--end-card`, `--captions` and `--clicks` move to `plan`.

## 0.9.1

### Patch Changes

- de94195: mediabunny moves from 1.27.3 to 1.55.7 everywhere it is pinned: the capture-video template's importmap, the recording composition's WebCodecs provider, the render harness's mux and the CLI's render and encode pages. Explicit bitrates render as before; a subjective quality (`QUALITY_HIGH` and friends) now means constant quality, which halves a screen recording's file for the same picture.

## 0.9.0

### Minor Changes

- 2649873: Capture harnesses paint each frame once. A program can register frame-prep hooks (`window.__vos__.framePrep`, a Map by id) that a capture loop runs right after seeking the timeline and before the paint, so the decodes a frame needs are requested up front and awaited with `waitForVideosReady`; the capture-video template runs them by default (`capture.prepareFrame: false` keeps the two-phase settle for A/B measurement). studio-core's recording composition registers one: it asks the WebCodecs provider (or seeks the element, the webcam and the background loop) for the frame's source moment before ON_FRAME runs, and the paused step it uses is the same source ON_FRAME's `syncVid` runs, so the paint finds its target met and registers nothing. Every take frame used to paint twice, once with the previous footage and again after the decode, on every harness.

## 0.8.0

### Minor Changes

- 48b0f03: A tilted card no longer shows the backdrop through its own edge when the camera is zoomed (or the card is bled past the frame, or it recedes under an end card). The card layer's canvas and plane now grow by exactly how far the pose lets the frame see past its edges, derived from the stage geometry at the live aspect from the tilt and card-pose tracks (`cardVisibleExtent`, `cardOverscanFor` in `@vosjs/studio-core`), replacing the fixed 1.25 overscan that applied only to bled insets.

## 0.7.1

### Patch Changes

- b5cbe55: The studio entry registers the house text faces the first time a text overlay paints, not only in SETUP. A title added to a fresh session used to paint in the stack's system fallback until the next cold load, because a live data update never re-runs SETUP. SETUP now marks the faces it loads, so the live path never registers one twice.

## 0.7.0

### Minor Changes

- c2c6b8a: The brand's mark is placed, not only recorded. `vos brand` prefers a bare mark the site names in its design.md over a favicon or app icon (which carry a tile) and records the on-dark twin as `logoOnDarkUrl`; `vos deliver` fetches the mark into the take's `brand/` folder (a site's logo URL rarely carries a CORS header, and a cross-origin image taints the canvas), reads its aspect from the bytes, and composes the site's own lockup: the mark beside the wordmark on the stage cards, alone in a wordless tile's top band, and above the wordmark on the end card (`endCard.mark`); a wide mark, a stylised wordmark asset, stands in for the word. A dark ground takes the on-dark twin or keeps the word alone.

## 0.6.0

### Minor Changes

- c10176b: The card shadow is layered: three shadows whose blur and offset grow while each stays at a low alpha share `frame.shadow`, so the card reads as lifted a little off the ground instead of sitting in a dark pool (the house looks are retuned for it and carry no contact layer). A frame that bleeds the card past an edge (a negative `frame.inset` side) overscans the card layer's canvas and plane (`CARD_OVERSCAN`), so a tilt that turns the bled edge back toward the viewer shows card there, not the texture's edge. Footage draws with the high-quality resampler, so a large downscale no longer aliases. A text clip takes `shadow` as a strength (0 = none); the end card's words carry none.

## 0.5.1

### Patch Changes

- 1c9dec2: The card's straight edges no longer show a thin dark seam at fractional sizes and while zoomed. The card's shadow is cast from a body drawn off-canvas instead of an opaque fill under the footage, and the footage and browser bar overdraw the rounded clip by one device pixel so the clip is the only edge.

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
