# @vosjs/studio-core

## 0.30.0

### Minor Changes

- 8c2cbfe: The zoom planner clusters presses by what one window can hold, not by time alone. A press joins a cluster only while the cluster's targets still share one window at the style's level floor; otherwise it starts a new span and the chain gap pans between them. A cluster's level is capped so the union of its targets stays within the window. Before, a corner press two seconds from a press at the top of the frame became one span aimed at their midpoint, which framed neither. `vos validate` now says split when the presses under a span cannot share a window.

## 0.29.0

### Minor Changes

- 2ff0cd5: The recorder looks at what a signed-in take shows. After the page opens and after every step it reads the text visible in the viewport and reports the KIND of sensitive-looking thing it saw and where, never the string: an email address (demo domains excepted), something shaped like an API key or a JWT, a card number that passes the Luhn check, a masked card's tail. They land in `meta.exposures[]`, the `record` and `create` done events, the end of a rehearsal, `vos validate <take>` and the digest's `take.exposures`, as warnings.

  `actions.json` gains `mask: [{ selector, as?: "blur" | "text", text? }]`: hidden before the first frame is captured and kept hidden across navigations and re-renders, so the real value is never in a frame, never in the recording, never pushed. A mask whose selector reached nothing fails `--strict` and a rehearsal. `meta.masks[]` records each mask's hits.

## 0.28.0

### Minor Changes

- b46b867: `vos record`, `vos create` and `--dry-run` check where the first navigation landed before a frame is captured. A take that met a sign-in instead of the page it was asked for (a 401 or 403, an identity provider, a sign-in path, a sign-in form rendered in place) is refused with exit 4 and a sentence naming what was asked and where the recorder landed; a redirect elsewhere with no sign-in in sight is refused under `--strict` and warned about otherwise. The check runs before a re-record clears the old footage, so an expired session never costs the recording it failed to replace. `--allow-wall` records the page anyway, and `meta.wall` plus the digest's `take.wall` then carry the verdict.

## 0.27.0

### Minor Changes

- f53544a: A copied style no longer carries the seed's export RESOLUTION. `export` is the one style field that is part taste and part fact, so it merges per key instead of replacing whole: the seed's frame rate and format land, and the target keeps the resolution its own footage earned. Copying it entire meant a 1280x720 seed stamped 720p onto a 2560x1440 take, so a series looked consistent by throwing away half of every later take's pixels — and nothing said so, because the doc was perfectly valid at the smaller size. A seed carrying no export block now leaves the target's alone rather than deleting a field the doc needs to render.

## 0.26.0

### Minor Changes

- 9ad8984: Camera styles re-founded on the stage camera at 60 fps. `focus`, `cinema`, `snappy` and `cut` are re-timed in the default's traced curve family with two structural rules: a chain gap never sits below its pump-free floor (`pumpFreeChainGap`; `resolveZoomStyle` raises an override that does), and the lowering fits a ramp longer than its span to the room it has, never below `RAMP_FLOOR` (0.14 s), instead of compressing it into a one-millisecond cut. Levels come down to the reference field (snappy 2.5 → 2.2, focus and cut 2.2 → 2.0), holds gain a beat, and every style's tilt track moves at its own zoom tempo so a lean lands with its zoom. `keynote` and `drift` are retired names: they resolve to `glide` + medium tilt and `cinema` + subtle tilt, `migrateHostedDoc` (docSchemaVersion 5) rewrites a stored document onto the pair, and `vos validate` warns. `none` spells its camera as the default's, never a frozen copy. The planner never dwells on the opening run (the cursor parked before its first move), which had opened six of eight real takes on a corner zoom at the ceiling.

## 0.25.0

### Minor Changes

- bca523a: The callout grammar: three shapes a viewer learns once (`note`, `tag`, `code`) composed from the product's register by the distinguishability rules (the card inverts the app's value in the product's hue, keeps the accent for the kicker, sets its title at 1.35× the app's body as seen on screen, lifts on a real shadow and a hairline, rises in and fades out). studio-core exports `calloutClip` and the starters lead with the three shapes in the house register; `pinCandidates` lists the steps an unpinned layer could name.

  `vos callout <take> <note|tag|code> --step <id> …` writes a callout in the grammar from `BRAND.md` beside the take (or `--ground`/`--accent`), with its window from the step's output extent (a beat after the press, cut short by the next scroll or navigation), its type scale from the camera at its start, pinned to the step. `vos validate <take> --picture` renders the footage under every html layer and reports the ΔE between the card's ground and what it covers (under 8 a problem, under 16 a warning); an unpinned html or media layer whose window holds a step with an element gets the pin named in a warning.

## 0.24.1

### Patch Changes

- 6be1c4f: A pinned layer's referent moves with the pointer when the press began a drag: a slider thumb, a scrubber or a dragged card is placed where the pointer has taken it through the drag and held at the release, so the layer, its mark and its leader stay on the thing rather than on the spot it was pressed. A press held still keeps a still referent.

## 0.24.0

### Minor Changes

- 1ae7be2: Pinned layers: an overlay clip may name its referent (`pin: { step | press | rect, side?, gap?, mark?, leader?, color? }`) and is placed beside it, following it as the camera moves. The lowering resolves the referent (a recorder step's element rect, the press nearest a source second, or a rect in video fractions) through the frame's camera into the clip's motion track, chooses the side once (the first of right, left, below, above that fits through the layer's life) and clamps the layer inside the frame; the layer keeps its screen size. A `mark` (`ring` or `underline`) is painted on the referent inside the card's zoom transform; a `leader` draws a hairline from the layer's near edge to the referent. `transform.x/y` stay the fallback for a pin that cannot resolve.

  The recorder keeps every hover, click, type and drag step's element rect on `meta.steps[].rect`; an older take resolves a step pin from the presses inside the step's window. `vos validate` refuses a pin that names nothing (an unknown or skipped step, a step that touched nothing, a pin naming two referents, a rect in pixels) and warns when a scroll or navigation inside the layer's window may have moved the referent, or when the frame has no room beside it. The framing warning about a layer sitting over the clicked element now tests the layer's box against the element as the camera shows it, for every layer kind, and names the fix.

## 0.23.1

### Patch Changes

- 5090a63: The default camera's arrival is fitted to the reference: `css-bezier(0.36, 0, 0.4, 1)` over 0.6 s (a gentle start, half the move at about 245 ms, 90 % at about 425 ms, a long settle), matching a 60 fps corner trace of a Cursorful zoom-in at its three measured points; CSS `ease` over 0.55 s reached the midpoint 70 ms earlier and read a touch fast. The pan between chained spans takes the same curve.

## 0.23.0

### Minor Changes

- a40481e: Drags are followed. A press that travels before its release (a slider thumb, a scrubber, a thing moved across a canvas; `dragsFromTrack`, ≥ 1.5 % of the frame width over ≥ 0.2 s) plans one follow span at the style's new `dragLevel` (`g{n}`, `focusMode: 'auto'`) from the press to the release, and its press leaves the click clusters. Inside any follow span the lowering bakes a path sample every 0.1 s at the pointer's smoothed position for the whole press (`FollowEvent.path`), and the zoom track pans through them linearly after a glide into the first, so the camera moves with the pointer instead of waiting for it to leave the dead zone; the dead-zone follow resumes from the release. Under the stage camera the path is clamped to the cover band like any focus.

## 0.22.1

### Patch Changes

- 10b7580: The stage camera's slide and scale are one motion. The centring (how far the focus is pulled to the frame's centre) now rides the zoom track as a fourth component, 0 at rest and 1 at an apex, interpolated by the same ease as the level; keyed to the level over a fixed band it landed in the first frames of any ease and the card's corner then drifted back out as the scale caught up, a visible twitch. The default camera's arrival ease is `css-bezier(0.25, 0.1, 0.25, 1)` (CSS `ease`, which the measured reference follows) instead of the front-loaded `(0.16, 1, 0.3, 1)`. `zoomView`, `zoomViewport` and `focusForViewportCentre` take an explicit `centring`; a three-component track lowered before the component existed falls back to the level band.

## 0.22.0

### Minor Changes

- 2e4acb1: `cursor.style: 'arrow'` draws an OS-style pointer (a black arrow with a white edge, its tip on the recorded point) in place of the white dot, in the card and across a transition's ghost alike; click effects bloom under the tip. New takes open on it (`projectFromArtifact`); `DEFAULT_CURSOR_STYLE` and every stored `'default'` keep the dot. The doc schema's cursor description names the field.
- 6c0d4d7: The default camera (`glide`) is re-timed against a measured reference: a zoom-in of 0.55 s on a heavy ease-out that starts 0.35 s before the click and lands 0.2 s after it (it started 0.75 s before and took 1.1 s), a zoom-out of 0.5 s, a pan of 0.55 s, a 1.2 s hold after a beat's last click and a 3 s chain gap. A cursor-follow span now enters at the span's own focus (the clicked element's rect) instead of the cursor's position before the click, so a click zoom lands on its target and the follow steers from there. New takes export at 60 fps. Existing documents keep their spans and focus; their camera moves take the new timing when they are next lowered.
- 89eaf07: The stage camera: `frame.camera: 'stage'` makes a take's zoom a camera instead of a magnifier. The card scales and slides so the zoom's focus lands at the frame's centre (blended in over the first 0.3 of level, so level 1 stays the identity), the focus is clamped only so the card still covers the central 80 % of the frame, and past the card's edge the frame shows the ground, radius and shadow. New takes open on it (`BASE_FRAME_STYLE`); a document without the field keeps the clamped magnifier it was cut with, byte-identically. `zoomView`, `zoomViewport`, `focusForViewportCentre`, `cameraModel` and `cameraCentring` are the camera-aware layout helpers; `focusBounds`, `clampFocus`, the digest's `zoomWindow` / `zoomCoversRect` and the CLI's framing lint take the model. The doc schema and `vos validate` know the field.

## 0.21.0

### Minor Changes

- 5c00f8f: The auto-zoom planner tests a press against the frame ONE PRESS AT A TIME. A click on a frame-sized element (a canvas, a panel, a modal clicked to focus or dismiss it) is set aside before clustering and only reserves its window against dwells; the button presses around it keep their zoom. The cluster-wide test read the chain's largest element, so one press on a panel inside a chain of clicks threw every zoom in the chain away. A `down` echoing the previous one within 4 ms and 2 px is one press (a recorder listening to pointer and mouse events records each click twice), so the digest's click counts are honest and a lone click is never a pair. The glide and keynote styles zoom a lone click (`minClusterClicks: 1`); the two-click rule they carried was never in effect on a recorded take. Digest click moments on a surface carry `surface: true`.

## 0.20.0

### Minor Changes

- d339264: HTML layers: two rungs. **Images by URL**: an image the source names on `https://assets.vos.so/` (`<img src>`, `url()`) is fetched by the page and inlined the way faces are, keyed by URL in the same cache, so a design system's hosted icon paints; the lint now names any other host as one that paints blank. **Live layers** (`live: true`): the picture is a function of clip-local time. CSS `@keyframes` inside the layer are scrubbed to `t` (paused, delayed by `-t`), and `{{t}}` / `{{data.<name>}}` placeholders in the markup and CSS fill per frame from the clock and the clip's `data`, so a counter, a progress bar or a typed line come out on the timeline's clock in the preview and in every export chunk alike. One rasterize per frame while on screen, keyed by the moment on a 60 Hz grid, one picture per clip in the cache, the last landed picture drawn while the next composes; in capture the build rides the frame settle so the export is exact. A still layer is byte-identical to before. `vos validate` reads `live` and `data`, warns on an authored `animation-delay` under `live`, on placeholders in a still, and no longer on `animation` under `live`.

## 0.19.1

### Patch Changes

- 12ad384: A program directory pushes whole: a fresh `vos push` of a `config.json` with a `doc.json` beside it now carries the program document (it rode the version path only, so the vos it created had no doc), and both push paths store the COMPOSED config, the studio's own save shape, so the fleet renders a layered program's layers in its still and preview instead of the ground alone. A template may be a program document: `--with` a one-layer member on the shelf lays its layer instead of throwing on the segments it never had.

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
