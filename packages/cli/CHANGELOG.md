# @vosjs/cli

## 0.65.2

### Patch Changes

- Updated dependencies [d5f0a8b]
  - @vosjs/studio-core@0.36.0
  - @vosjs/render-core@0.3.18

## 0.65.1

### Patch Changes

- 8f4dd62: The bundled skills say how to declare a file knob: a control of kind `asset` over a name in `config.assets`, which a person swaps from the editor.

## 0.65.0

### Minor Changes

- a8b4300: A knob can swap a file. A param of kind `asset` is bound to a name in `config.assets`: its value is that entry's `ref`, and committing it writes the manifest, so the new file is declared, uploaded by `vos push` and served like the one it replaced. `accept` lists the kinds of file the knob takes; without it the knob takes the declared file's own `kind`.

  `@vosjs/shared/params` gains `paramData` (the knob values a running program reads from `ctx.data`, file knobs left out), `applyAssetParam` and `assetParamIssues`. `vos check` warns about a file knob that would do nothing: a name the manifest does not declare, a list of files, a file the program never reads, or no kind.

### Patch Changes

- Updated dependencies [a8b4300]
  - @vosjs/shared@0.7.0
  - @vosjs/studio-core@0.35.3

## 0.64.0

### Minor Changes

- d76809b: An HTML layer's own face can be a `.woff2` beside its document.

  - The doc lint takes a face `url` that is an https URL, a hosted file (`/api/assets/<id>/file`) or a `.woff2` beside the document, and says why for anything else: another format would be embedded as woff2 and drawn in a fallback face, and a path may not leave the document's directory.
  - `vos push` (keyed or `--claimable`, program or take) uploads that face like any layer file and re-points the layer at the hosted file.
  - `vos render`, `vos still` and `vos preview` serve a program's local face to the page, so a local render draws it.

## 0.63.0

### Minor Changes

- 1a43d14: `vos assets ls`, `vos assets usage` and `vos assets why <id>` read the library: what is in it, what holds the storage, and every program that uses a file. `vos asset import <url>` fetches a file from an address and adds it with where it came from (`--license`, `--attribution`) kept beside it. `vos asset push` now prints, per file, what the platform read (`video 1920×1080 avc 34.2 s, audio`), its `asset:<id>`, the url a document key takes, and the line that declares it in a program's `assets`; the same facts are in the `--json` result. A file the platform recognises at the end of an upload is reported as already yours.

## 0.62.0

### Minor Changes

- 07dfbf9: A program push carries every file it names, and a claimable push carries them too.

  - `vos push --claimable` no longer leaves a local sound out or refuses a program that declares local files. It opens the claim's own upload session (no credential), sends each file through the same door a key uses, and names the session in the claim: at most 12 files and 50 MB, sound up to 5 minutes, video up to 60 seconds. The done event says how many files rode the claim.
  - Every push now carries a file an element names as `src` or a font names as `url` (lifted into `config.assets`, the element then naming `"$assets.<name>"`) and a file path in `data` (uploaded, rewritten to the hosted file's path). Before, these went up as the bare local name and loaded nothing on a hosted page. A file typed inside a function is said, with the manifest line to write.
  - `--prompt "<text>"` shows the prompt that made a program on its watch page (any program push), and `--share` makes a claimable push's claim page lead with "Claim and share". `--share` on a keyed push is refused: a key never publishes.
  - Warnings are `{"event":"warning","message":…}` events under `--json`. They were stderr lines, which `--json` silenced, so an agent never heard that a file was left behind.

## 0.61.0

### Minor Changes

- c1aac71: Every upload goes through the platform's one door: a file is declared, sent as parts and sealed, whatever its kind or size. `vos asset push` and a program's declared files now take fonts, HDR maps, SVGs and captions beside models, pictures, sound and video; a large file can be filed into a project; and the platform answers what each file is, the name it is stored under and anything worth saying about it (an SVG's scripts removed, a codec Chrome may not decode). A file the platform has no use for is refused in words before anything is sent.

## 0.60.1

### Patch Changes

- 3691549: Declared files (`config.assets`) are held to the program's own directory, and six defects in how the CLI served, uploaded and fetched them are fixed.

  - **A manifest path reaches only into the config's directory.** A `ref` could name any file on the machine (`../.env`, an absolute path, a link pointing away), and `vos render`, `still`, `preview` and `compare` served it to a page whose code comes from the same config, while `vos push` uploaded it. A path outside the directory is now refused in words by every verb, a config loaded from a URL reads no local file, and `vos check` reports it. `vos preview` listens on loopback only.
  - **A manifest name is an identifier everywhere.** `vos fetch --media` named the files it brought home after manifest names that, in a fetched document's own config, had passed no schema; a name with `../` in it wrote outside `assets/`.
  - **A file with a space or an accent in its name loads in a render.** The served path carried the raw file name, and the page asked for the percent-encoded one.
  - **Served files answer `Range` and wear a content type**, in the render page's route and in the preview server: a video element seeks by range, and an SVG needs its type to draw.
  - **`vos fetch --media` fetches again when a name means a different hosted file.** A file kept by name alone stayed under a changed manifest, and the next push stored the old one. `assets/.hosted.json` remembers which hosted file each one is.
  - **A push says what it cannot carry yet.** A font, an HDR or a `.gltf` in the manifest was sent and refused as a bare 415; it is now refused before anything is sent, with what to do instead.
  - Hosted files a render downloads are cached under `~/.cache/vos/assets` (private to the user, written whole through a `.part`, named with their type), not the shared temp directory; a hosted file spelled as its absolute URL is read with the key too; and the same path on a host that is not vos.so stays a URL.

## 0.60.0

### Minor Changes

- 7002822: A program declares the files it uses, by name. `config.assets` (`{ name: { ref, kind? } }`) is the manifest; a function reads `ctx.assets.<name>` and an element, object or font names one as `"$assets.<name>"`. A file typed into a function as a URL is invisible to every host: it cannot be served to a render page on another origin, brought along when the program is copied, or known to be in use. A declared one can.

  **Core.** The URL a program sees is resolved nearest first: `deps.assets` handed to `initVos` for the surface (`capture.assets` on a capture page), then the default baked at compile time through the new `resolveAssetRef` compile option, then the `ref` as written. `lintVosAssets` (`@vosjs/core/lint`) reports a `"$assets"` string that names nothing, a function that reads an undeclared name, and a declared file nothing reads. A program with no manifest compiles as before, with `ctx.assets` an empty object.

  **CLI.** `vos render`, `vos still`, `vos preview` and `vos compare` serve a manifest's local files to the page from disk and read a hosted one with your key. `vos push` uploads the local files and stores the program naming them `asset:<id>`; the config on disk keeps its paths. `vos fetch --media` brings a program's hosted files home under `assets/`. `vos check` gains the declared-file lints, including a hosted file named in code instead of the manifest.

### Patch Changes

- Updated dependencies [7002822]
- Updated dependencies [3000d61]
  - @vosjs/core@0.27.0
  - @vosjs/studio-core@0.35.1

## 0.59.1

### Patch Changes

- f2a2230: A text layer can mix weights. Emphasis is OPT-IN per clip: with `emphasis` set (`{}` is enough), `*words between asterisks*` are set in the emphasis weight (the family's bold step, or `emphasis.weight`) and colour (`emphasis.color`), so a light line can carry bold words, the two-weight caption, and a word-by-word or char-by-char reveal keeps every word in its own weight; `\*` is a literal asterisk there. Without `emphasis`, asterisks are text as typed, so no existing caption changes. The markers become two control characters around every emphasized word at lowering (`parseEmphasis`, `overlayDisplayText`, `stripEmphasis`); ON_FRAME measures and draws run by run, switching fonts at them, and the host's picking rect and wrap measure through `measureEmphasized`, its mirror. The emphasis face loads with the rest, so the first frame has it. `vos validate` checks `emphasis` and says so when a clip has marked words but emphasis is off; the doc schema documents both.
- 53057e5: A zoom can hold its target to one side: `zoom[].screen` (`{ x, y }`, fractions of the frame) is where the target lands at the apex under the stage camera, instead of the centre, so a deep zoom can keep its subject at the left third with the ground open beside it for a caption. A placed span is the author's composition, so the stage camera's cover band does not clamp it; a span that follows the cursor ignores it, and the magnifier has no use for it. ON_FRAME, `zoomView`, `zoomViewport` and its inverse `focusForViewportCentre`, `focusBounds`/`clampFocus`, the pin projection and the framing lint (`zoomWindow`/`zoomCoversRect`) all take the point; the track carries it as two more components only when some span is placed, so every other document lowers its four-component track byte-identically. `vos validate` and the doc schema take `screen`, refuse pixels in words, and warn when it cannot act.
- Updated dependencies [f2a2230]
- Updated dependencies [53057e5]
  - @vosjs/studio-core@0.35.0
  - @vosjs/render-core@0.3.16

## 0.59.0

### Minor Changes

- 5e62180: `vos delete` moves a vos to Trash on vos.so, and `vos trash` and `vos restore` see and undo it. A push now carries every local file a document names.

  - **Deleting is undoable.** vos.so keeps a deleted vos in Trash until the date the delete prints. `vos delete` says that date and the way back (`vos restore <id>`), sends who is asking so Trash can name the tool, and gains `--dry-run`, which names what would move and changes nothing. `vos trash` lists what is there (what, moved by whom, restorable until when), `vos restore <id|url> [...]` brings things back as they were, and `vos trash restore --since <30m|1h|2d|ISO> [--by <key name>]` undoes everything a key moved to Trash since a moment. There is no verb that empties Trash: that is the person's act, on the web. The rules block `vos setup` writes says so in one line.
  - **A take push keeps its voice and its webcam.** A local `micKey` or `camKey` was dropped from the push as "local-only", while `vos fetch --media` writes both beside the take: fetch, then push, and the hosted take had lost them. They now upload through the same content-addressed door as the recording, so a re-push sends nothing twice. A sidecar whose file is missing is still left out, and said.
  - **3D props and a program's overlays upload too.** A document's object clips (a GLB) were never walked, and a program push uploaded only its sound, so a pushed document could key files only the pusher's disk held. Overlays, props and sound now ride the push for both kinds of document. A `.glb` is known by its bytes and its name (`model/gltf-binary`).
  - The README and the port scaffold named a verb that does not exist (`vos asset upload`); it is `vos asset push`.

## 0.58.1

### Patch Changes

- 4feac4f: The card can wait before it enters: `frame.anim.enter.at` (OUTPUT seconds, 0..30). The ground plays alone until then, so a film can open on its title over the ground, and the card arrives from nothing rather than from its softened first pose. Every head of the entrance (the tilt-in pose, the pull-out level, the camera's rest, the card-pose track and a slide's start in the transitions table) holds until `at` and moves over the step's seconds after it; the exit never begins before the card has arrived, and the cover moves past the arrival. Absent, every track lowers byte-identically. `vos validate` and the doc schema take `at` on the card's enter only and say why anywhere else.
- de6a34b: `vos validate` tells a caption from a callout. The "not pinned" advice now fires only on a layer that is ABOUT a step: its words name what the step touched (the text a selector quotes, `has-text('OHLC Bars')` or `[aria-label='Save']`, never a test id), or its box sits beside the element as the camera shows it then. Sharing the step's window is no longer enough, since every caption in a product video shares one with something, and a step that touched a whole surface (a chart, a canvas) is beside everything on it, so only words count there. A strong lean is said once per document, listing its spans, rather than once per span. A layer that outlasts the footage no longer claims the frame is bare backdrop (the card holds its last frame), offers `frame.anim.exit: 'fade'` for a closing card on the ground, and is silent when the card already leaves with its footage.
- Updated dependencies [081ac42]
- Updated dependencies [4feac4f]
- Updated dependencies [1579f50]
  - @vosjs/studio-core@0.34.0
  - @vosjs/render-core@0.3.15

## 0.58.0

### Minor Changes

- 42b3d67: A program can declare its canvas with `size: { width, height }`, at any shape (9:16, 4:5, 21:9 or any width and height): `vos render` and `vos still` output it by default, one of `--width`/`--height` keeps its aspect, `vos info` prints it, `vos preview` letterboxes to it, and `vos check` and `vos push` keep it instead of dropping it. `@vosjs/core` exports the shared rule (`programSize`, `resolveOutputSize`, `fitWithinEdges`) so every host sizes a program the same way.

### Patch Changes

- Updated dependencies [42b3d67]
  - @vosjs/core@0.26.0

## 0.57.0

### Minor Changes

- bf37561: A `spring(damping, stiffness, mass)` ease (defaults 10, 100, 1; bare `spring`, `spring.in`, `spring.inOut` too), dialect-only like `css-bezier`: a damped spring released from rest, run for its natural settle time (until it stays within 0.5 % of the target) stretched over the tween, landing exactly on 1, as Remotion's `durationInFrames` stretches its `spring()`. A damping ratio of 1 or more settles critically at the natural frequency, as Remotion's does. A tween whose duration is the spring's settle time moves as Remotion's spring does, frame for frame (`springSettleTime(damping, stiffness, mass)` in `@vosjs/timeline`; `content.refs.lib.springSeconds(config)` in a ported program). The dialect lint accepts it in every spelling; GSAP has no such ease, so the GSAP backend falls back to its default. `@vosjs/tween`'s runtime bundle carries it to every render page. The port scaffold's hint now puts a source's springs on the timeline with the ease, never in `onFrame`.

### Patch Changes

- Updated dependencies [bf37561]
- Updated dependencies [699d2e5]
- Updated dependencies [bf37561]
  - @vosjs/tween@0.8.3
  - @vosjs/core@0.25.6
  - @vosjs/elements@0.10.1
  - @vosjs/timeline@0.5.0
  - @vosjs/studio-core@0.33.3

## 0.56.1

### Patch Changes

- 924ab08: The bundled skills are 0.17.0: `vos-authoring` finishes by pushing the program and giving the watch and studio links (the claim link when there is no credential), and `vos-create` ends its reply with the links.

## 0.56.0

### Minor Changes

- fee085e: `vos port scaffold` writes the painter starter: when the piece needs a painter, or its code reaches for a spring or noise (the inventory now records the source's `uses`), `createContent` defines `content.refs.lib`, shared by `createTimeline` and `onFrame`. `spring({ frame, fps, config, from, to, delay, durationInFrames })` matches Remotion's spring to machine precision in every measured case (under-, critically and over-damped, where Remotion settles critically at the natural frequency; overshoot clamping; 30 and 60 fps; the `durationInFrames` stretch, landing on `to` past it), written from the physics. `springTo(tl, target, { key: [from, to] }, at, opts)` puts that spring on the timeline as one linear step per frame, since the tween dialect takes named eases only. Also `springFrames` (Remotion's `measureSpring`), `interpolate` with extrapolation and easing, `bezier`, seeded simplex `noise2D`/`noise3D` (the character of `@remotion/noise`, not its values) and `random`/`rng`. The report names the starter, and a spring-using source gets `data.fps` and a `springTo` line where the motion goes. Also: the Remotion reader keeps tag-numbered text ids, so the scaffold names its keys after the words (`motion`), where 0.55.0 named them `div00`.

## 0.55.1

### Patch Changes

- a87b795: Bundles skills 0.15.0: the element reference says a split element's `props` move the whole word (letters through `segments`, the word through `props`), and `vos-authoring` covers a program's own render passes and depth of field.
- Updated dependencies [a87b795]
  - @vosjs/elements@0.10.0

## 0.55.0

### Minor Changes

- 7afd3ee: `vos port inventory` reads a Remotion project, where it read only its render. The project is bundled with its own `@remotion/bundler` and its first composition mounted the way Remotion's renderer mounts it: the composition's size, fps, length and `defaultProps`; the `<Sequence>`s as scenes, named by the component each holds, with a sequence lying over a longer one (a wipe) kept out as a transition; every word read nine tenths into its scene, where it has settled and a scramble has resolved, with its rendered face; the palette named after the colour constants the source declares; `<Audio>` as the score. Without the project's dependencies it says to run `npm install` and reads only the render. For every source, a word animated one span per letter is read as one `split` word in its letters' face, a line with a styled word inside it is read run by run, a face is reported as it renders (a family loaded only italic is italic), and each scene's ground (the frame-filling colour behind it) is measured; `vos port scaffold` emits the split words, hides a split word's units outside its scene, and stands each scene on its ground by palette key. On the Remotion showreel the untouched scaffold scores a mean SSIM of 0.67 against its render where it had no words at all; on the HyperFrames showreel 0.82, from 0.73.

## 0.54.2

### Patch Changes

- e70d284: `vos port scaffold` places the source's score. Run on a folder (`vos port inventory .`), the inventory stored the folder's bare name, so the scaffold looked for `assets/score.wav` one level too deep, wrote `doc.json` with no audio, and its report still said the score was a track. The inventory now records the source's absolute folder (`root`) and the scaffold resolves media against it; the report names the score only when it placed one. `vos check` no longer lints the studio's own layer code that a program document composes in: its five timer and network warnings pointed at lines the author never wrote.

## 0.54.1

### Patch Changes

- ea97b8a: A program whose `createContent` returns objects it never added to a scene now says so. The engine never adds `content.objects` for you (the list is what the program added, for cleanup), so a forgotten `ctx.scene.add()` drew nothing and raised no error. The engine warns `[vos] createContent returned N objects that no scene holds…` after creating and after rebuilding content (a returned `Scene` is exempt, since a program may render a private one), and `vos still` and `vos render` print that warning beside the flat-colour one.
- Updated dependencies [ea97b8a]
  - @vosjs/core@0.25.4

## 0.54.0

### Minor Changes

- 288d8a3: Bringing a finished piece into vos has its tools. `vos port inventory <page|project>` reads a HyperFrames composition, a hand-rolled page or a Remotion project's render as a browser renders it (words with their computed faces, sizes and colours, the palette from custom properties, faces matched to the catalog, media with their windows, the scenes a timeline reveals, the CSS no element can say, the words and faces a canvas script paints) into `port/inventory.json`, laying each HyperFrames word out where it settles in its scene, with stills from its render. `vos port scaffold` turns that into a data-first program: every word a bound text element, every colour a data key, the knobs over them, a label and a TODO per scene with each scene's words shown in its window, a painter starter only where needed, the score as a `doc.json` track, and `port/REPORT.md`. `vos build <program.mjs>` turns real functions into `config.json`, refusing a module-scope read, syntax the page cannot run and non-JSON data, with `config.sources.json` mapping each function to its line. `vos compare <program> --against <render>` scores every sampled frame (SSIM) and writes source | vos | difference sheets, exiting 1 when any frame is under the threshold. The bundled skills are 0.13.0, whose `vos-port` procedure uses them.

## 0.53.6

### Patch Changes

- 419bc50: `vos still` checks the frame it wrote: a fully transparent still (every pixel alpha 0, what a custom blend that clears the destination alpha leaves, which most viewers show as black while the live preview draws over its page) and a single flat colour are said as `warn:` lines and in the `--json` done event, and an uncaught exception the page threw is said on a still or a render that otherwise succeeded, not only on a timeout.

  `vos render`, `vos still` and `vos check` given a program's `config.json` read the program document beside it (`doc.json` without `source`), as they do for the directory: a render of `program/config.json` used to leave out the document's sound and layers without a word.

- a31a556: The bundled skills are 0.12.0: `vos-port`'s reference says where a split element's units sit, how a text stroke draws, that `onFrame` wins over a binding, where an element sits (`position`, which `transform` fields are read) and which staggers the dialect runs.
- Updated dependencies [85c4df3]
  - @vosjs/shared@0.6.0
  - @vosjs/studio-core@0.33.2

## 0.53.5

### Patch Changes

- a552219: The bundled skills are 0.10.0: `vos-port` keeps every visible word a bound element (a per-letter knob word is one bound split element), and its reference page carries the knob schema, the binding rules and the raster ceiling.

## 0.53.4

### Patch Changes

- Updated dependencies [df479e8]
- Updated dependencies [0a4f08d]
  - @vosjs/render-core@0.3.9
  - @vosjs/elements@0.9.0
  - @vosjs/core@0.25.3

## 0.53.3

### Patch Changes

- c6623a0: The bundled skills are 0.9.1: `vos-port` says text written in a frame is in that frame and a re-raster keeps a tweened offset (with the versions that brought both), how to set a hosted italic, and carries the reference page regenerated from core 0.25.2.

## 0.53.2

### Patch Changes

- e541410: `vos push --wait` says when the still and preview links it prints belong to a private vos: they answer 404 to a request without a credential, so a bare fetch read as "the still is missing" when it was only fenced. The line names the fix (the key as a bearer, or a signed-in browser).
- Updated dependencies [f4ec253]
- Updated dependencies [e541410]
- Updated dependencies [9614531]
  - @vosjs/render-core@0.3.8
  - @vosjs/core@0.25.2
  - @vosjs/elements@0.8.3
  - @vosjs/shared@0.5.0
  - @vosjs/studio-core@0.33.1

## 0.53.1

### Patch Changes

- 6d34049: The bundled skills are 0.9.0: `vos-port` says where a painter goes between elements and that a still misses text `onFrame` writes, carries the element, context and ease declarations as a reference page, and maps a CSS `cubic-bezier` timing to `css-bezier`.

## 0.53.0

### Minor Changes

- fca054a: A program chooses its cover.

  - studio-core: `ProgramAnchorDoc.still` (output seconds) and `programStillTime(doc)`, which clamps it to the program's output length after any retime and says nothing when none is declared, so a host keeps its default.
  - cli: `vos push config.json --still <seconds>` writes the cover into the program's `doc.json` (minting a minimal program document when there is none), so every later push keeps it; a new vos pushed without one says the platform picks an early frame. A take's cover stays its own `doc.json` `still`, and `--still` on a take push is refused in words. `schema/doc.schema.json` documents the field.

### Patch Changes

- Updated dependencies [fca054a]
  - @vosjs/studio-core@0.33.0
  - @vosjs/render-core@0.3.7

## 0.52.2

### Patch Changes

- 39bb447: Knobs stay honest.

  - `@vosjs/editor`: retyping or recolouring a text element whose `content`, `font.family` or `font.color` is bound to data (`{ $data: key }`) now writes `data[key]` and keeps the binding. It used to write a literal over the binding, so the knob and any later data patch stopped reaching that text. New export `boundDataKey`.
  - `@vosjs/cli`: `vos check` warns about every knob or Look vos.so would drop (past 12 knobs or 8 Looks, or a field over its limit), and `vos push` prints the warnings the platform returns.

- Updated dependencies [39bb447]
  - @vosjs/editor@1.4.0

## 0.52.1

### Patch Changes

- be30d7c: Element colours render as authored. Text, svg and image element textures are now marked sRGB; without it the renderer treated their pixels as linear and encoded them again, so every element colour came out lighter (`#FF4D2E` rendered as `#FF9576`). Programs render darker and more saturated than before, which is the colour their authors wrote. The CLI ships the 0.7.1 skills catalog, with `vos-port`.
- Updated dependencies [be30d7c]
  - @vosjs/elements@0.8.2

## 0.52.0

### Minor Changes

- bd00ca2: Sound rides every push and every program render; finished footage ingests bare.

  - `vos asset push` sends sound and video through the recording door (typed by their bytes, in parts when large, filed with `--folder`), so a score lands in Sound > Uploads.
  - `vos push` of a program (and of a take) uploads the local files its `doc.audio` names; a claimable push sends the composed config and says which local sounds it left out.
  - `vos render` of a program mixes the sound its document adds, inlining files the capture page cannot fetch; `vos check` warns that an `audio` element is not a track.
  - The output's name picks mp4 or webm, and a contradicting `--format` is refused. `vos still` takes `--times` in one browser and writes PNG or JPEG by name. `--set data.<key>=<value>` reaches a program on `render` and `still`.
  - `vos push --wait` stays until the version's still renders; `vos delete <id|url|dir>` takes a vos down; a push without `--folder` says it landed unfiled.
  - studio-core: `FOOTAGE_FRAME_STYLE` and `projectFromArtifact(…, { footage: true })`. `vos ingest` reads a file with no cursor trace as finished footage (no card, no bar, no drawn cursor, its own frame rate); `--as footage|take` says it outright.

### Patch Changes

- Updated dependencies [bd00ca2]
  - @vosjs/studio-core@0.32.0
  - @vosjs/render-core@0.3.6

## 0.51.0

### Minor Changes

- 94db7e0: A push names the coding agent that ran it. With no `VOS_CLIENT` set, the client string a pushed version self-reports is now the host agent read from the environment (the `AI_AGENT` convention first, then Claude Code, Cursor, Codex, Gemini CLI, OpenCode, Copilot, Replit, Augment, Antigravity and Devin's own markers), for example `claude-code vos-cli`, and `vos-cli` only when no agent is found. The string stays display-only; attribution still rests on the credential.

## 0.50.4

### Patch Changes

- a335999: `vos record`'s clock-driven motion yields a tick when a sample cost no clock time, so a take on a runtime whose clock moves only across I/O (a Worker) no longer spins in its scroll.
- Updated dependencies [a335999]
  - @vosjs/render-core@0.3.5

## 0.50.3

### Patch Changes

- d77f269: `vos record` scrolls the container under the cursor inside the page, by the clock, instead of sending wheel events: a take on a fleet's background tab no longer stalls in its scroll, and a slow machine records every frame of the travel.
- Updated dependencies [d77f269]
  - @vosjs/render-core@0.3.4

## 0.50.2

### Patch Changes

- 6d32377: `vos record`'s scroll waits for the screencast's next frame between deltas (capped), not for `requestAnimationFrame`, so a take recorded in a background tab no longer stalls inside its scroll.
- Updated dependencies [6d32377]
  - @vosjs/render-core@0.3.3

## 0.50.1

### Patch Changes

- 8fc1560: `vos record` scrolls by the clock: a scroll step's wheel deltas are paced over the travel with a paint between them, so a fleet or a slow machine records intermediate positions instead of jumps, and the pace report counts the travel as a gesture rather than overhead.
- Updated dependencies [8fc1560]
  - @vosjs/render-core@0.3.2

## 0.50.0

### Minor Changes

- e0e8545: `vos ingest <video> [--cursor <trace>] [--out take]`: a take directory from a recording someone else made. The file becomes `recording.<container>` (stream-copied into a seekable container, or copied as it is), `meta.json` comes from its own dimensions, length and frame rate, and a trace beside it becomes `cursor.json`: a Playwright `trace.zip` (clicks with their points and times, from the page's creation), stamped JSON records, or a CSV of `t,x,y,type`. The fresh plan then zooms on the trace's clicks; without a trace nothing is planned and the done event says so. What a trace cannot give is named, never guessed.

### Patch Changes

- Updated dependencies [e0e8545]
  - @vosjs/studio-core@0.31.0
  - @vosjs/render-core@0.3.1

## 0.49.0

### Minor Changes

- e7e9e24: `vos record --hosted`: the take recorded on vos.so's fleet, for a machine with no browser. The same actions.json goes up, the platform records, plans and lands it as a private vos with its doc.json and its digest, and the take comes home into `--out` with its media through `vos fetch --media`. The script, the viewport, `--header` values and the value of every `{ "env": "NAME" }` a setup step reads travel with the job; a session never does (`--session` and `--storage-state` are refused), a page behind a sign-in fails in words naming the local ladder with exit 4, and a private-network URL is refused before a job exists. The recorder's mechanism itself moved to `@vosjs/render-core/record`; the CLI's `recordTake` wraps it with a take directory and writes the same four files, byte for byte.

### Patch Changes

- Updated dependencies [e7e9e24]
  - @vosjs/render-core@0.3.0

## 0.48.1

### Patch Changes

- d5a26c2: `vos login --handoff <url>`: a signed-in person's "hand it to your agent" line from vos.so carries a setup link, and this exchanges it, once, for a content key named for the machine, with no click from the person. The origin is the link's own, the key goes straight to the credentials file, and a spent, expired or unknown link fails in words with `vos login` as the next step.

## 0.48.0

### Minor Changes

- 28af22e: The machine: `vos setup` readies a computer for the loop in one command (the vos skills into your agent's directories through skills.sh, else the copy this package now ships; a browser found or installed; one idempotent block in `AGENTS.md` or `CLAUDE.md`; then `doctor`), `vos doctor [--url <dev server>]` says in words what is ready (node, browser, ffmpeg, skills per agent, a credential present or absent and never printed, the dev server; exit 3 when no browser), `vos whoami` answers the key's name and the account's handle, never the key, and `vos logout` removes the credentials file. `vos open` now opens the studio at vos.so by default (`VOS_ORIGIN` or `--studio` for a dev server). These four verbs print NDJSON whenever stdout is not a TTY, each `done` event carrying `next_step`.

## 0.47.0

### Minor Changes

- c427963: A click's `ms` is reading time, held from the page's last visual change; the recorder pays the settle itself. It watches the screencast after the press: a change within 400 ms says the page is answering, 250 ms with no new frame says it has settled, no change within 400 ms says the page did not change, and 1.2 s bounds a page that never stops. Before, the hold started at the press, so the same `ms` was read on one run and dead on the next as the settle varied. Measured on one script twice: every hold within 2 ms of its `ms`, the takes differing by the settle alone. A script whose `ms` was sized to cover the settle now holds longer: size `ms` as a reading beat, about 1 s after a page changed and 0.6 s after a control. The pace report counts a click's `ms` as the script's ask.

### Patch Changes

- 5d7f2df: The actions schema says what a click's `ms` is: the read after the page settled, held from its last visual change.
- 82ad707: No planned zoom span runs past the footage: the planner takes the footage's `duration` and clamps every span to it (the cursor track ends at the last event, before the footage does). A take whose last press sat closer to the end than the style's hold planned a span past the end, which `vos push` refused.
- Updated dependencies [82ad707]
  - @vosjs/studio-core@0.30.2

## 0.46.1

### Patch Changes

- c08d761: Two click spans the cluster rule split, less than a lead plus a hold apart, no longer overlap: the earlier span ends where the later one enters, and they chain into a pan. A push of such a take was refused for overlapping spans.
- Updated dependencies [c08d761]
  - @vosjs/studio-core@0.30.1

## 0.46.0

### Minor Changes

- 1892423: The record done event reports `dead`: a still frame under a parked cursor past the beat it takes to read what changed, per step, with how long each hold ran after its page settled. `freezePct` stays as the plain fact of stillness and no longer warns: a page being read is content. The warning is the dead share (over 20 %) or one dead hold over 1.5 s, and the take-ready line names the steps whose `ms` to cut.

## 0.45.2

### Patch Changes

- 8c2cbfe: The zoom planner clusters presses by what one window can hold, not by time alone. A press joins a cluster only while the cluster's targets still share one window at the style's level floor; otherwise it starts a new span and the chain gap pans between them. A cluster's level is capped so the union of its targets stays within the window. Before, a corner press two seconds from a press at the top of the frame became one span aimed at their midpoint, which framed neither. `vos validate` now says split when the presses under a span cannot share a window.
- Updated dependencies [8c2cbfe]
  - @vosjs/studio-core@0.30.0

## 0.45.1

### Patch Changes

- e8198a3: `vos session open` asks the person to QUIT Chrome, not close the window: on a Mac the last window closing leaves Chrome running, and the command waits for the process, so a closed window left it hanging with nothing saved.

## 0.45.0

### Minor Changes

- 2b98671: `vos session open <url> --name <app>` opens a plain Chrome window on a vos-owned profile, waits for the person to sign in and close it, and says what the session holds as counts and dates, never a value. `vos session check <name> [--url]` asks whether it still opens the page, in words. `vos record --session <name>` records on it. The system Chrome with the real keychain is the one binary a session is ever read with, because the bundled Chromium cannot decrypt a profile Chrome wrote. `vos push` refuses a take directory holding a storage-state-shaped JSON.

## 0.44.0

### Minor Changes

- 5e41305: `vos actions script <actions.json>` prints the flow as numbered beats in plain words, with the holds the script asked for, for a person who will record it by hand in their own signed-in browser: the last rung of the session ladder, handed over as the agent's knowledge of the flow rather than an apology. A step's caption leads its beat, a text selector is said as its words, and an id is said as a name.

## 0.43.0

### Minor Changes

- 26de34b: `actions.json` gains `setup`: steps that run before the camera rolls (a sign-in form, a cookie banner, an onboarding tour), as plain actions with no cursor, no frames, no pace and nothing in `meta.steps`; then the recorder opens `url` again and the take begins where the setup left it. A `type` step's text may be `{ "env": "NAME" }`, read at run time and never logged or stored; a literal typed into a password field is refused. A setup selector that never appears fails the take before anything is recorded. `--header name=value` (repeatable) puts a request header on every request the recording browser makes.

## 0.42.0

### Minor Changes

- 2ff0cd5: The recorder looks at what a signed-in take shows. After the page opens and after every step it reads the text visible in the viewport and reports the KIND of sensitive-looking thing it saw and where, never the string: an email address (demo domains excepted), something shaped like an API key or a JWT, a card number that passes the Luhn check, a masked card's tail. They land in `meta.exposures[]`, the `record` and `create` done events, the end of a rehearsal, `vos validate <take>` and the digest's `take.exposures`, as warnings.

  `actions.json` gains `mask: [{ selector, as?: "blur" | "text", text? }]`: hidden before the first frame is captured and kept hidden across navigations and re-renders, so the real value is never in a frame, never in the recording, never pushed. A mask whose selector reached nothing fails `--strict` and a rehearsal. `meta.masks[]` records each mask's hits.

### Patch Changes

- Updated dependencies [2ff0cd5]
  - @vosjs/studio-core@0.29.0

## 0.41.1

### Patch Changes

- 18b2d33: Four fixes from agents recording apps behind a login. `vos <verb> --help` prints that verb's usage lines and exits 0 instead of a one-line usage error. The rehearsal's `Next:` line carries `--storage-state`, `--browser-arg=` and `--allow-wall`, so the command it hands you records what it rehearsed instead of the sign-in page. The wall message says a wall is a session problem and not a script bug, and names every way past it, including a person signing in once with `npx playwright open --channel chrome --save-storage`. `vos help` lists exit 4.

## 0.41.0

### Minor Changes

- b46b867: `vos record`, `vos create` and `--dry-run` check where the first navigation landed before a frame is captured. A take that met a sign-in instead of the page it was asked for (a 401 or 403, an identity provider, a sign-in path, a sign-in form rendered in place) is refused with exit 4 and a sentence naming what was asked and where the recorder landed; a redirect elsewhere with no sign-in in sight is refused under `--strict` and warned about otherwise. The check runs before a re-record clears the old footage, so an expired session never costs the recording it failed to replace. `--allow-wall` records the page anyway, and `meta.wall` plus the digest's `take.wall` then carry the verdict.

### Patch Changes

- Updated dependencies [b46b867]
  - @vosjs/studio-core@0.28.0

## 0.40.0

### Minor Changes

- f53544a: `vos check` catches two programs that used to pass clean and then disappoint at render.

  `repeat: -1` on a tween is now a dialect error. GSAP answers an infinite repeat by giving the timeline its infinity sentinel, so the program's duration reads 10000000000 seconds instead of its real length and anything placed after that tween is unreachable. The compiled timeline already loops on its own, so the infinite repeat was never buying the loop it looked like it was buying. A finite `repeat` is untouched.

  A postprocessing chain that never applies `{ type: 'output' }` is now a warning, and so is one where that pass is not last. The output pass is what applies tone mapping and converts to the renderer's output color space; every pass before it works in linear space on a render target. A chain that simply stops after its last effect hands the screen an image the renderer never got to finish, so the same scene looks different with the chain than without it. The schema cannot see this — `postprocessing` is a list, and every ordering of a list is a valid list. Both composer chains are checked, and the message names which one it means.

- f53544a: A program push lands where `vos.json` says. A directory that tracks a vos now ITERATES it, so the loop the contract describes — fetch, edit, `vos check`, push, pull — finally needs no flags, and `--remix-of` is the one door that makes something separate. Before this, a bare `vos push config.json` read the tracked id as LINEAGE rather than as a target: the second push in a directory created a fresh vos remixed from the first, the third remixed the second, and a shelf filled up with "… remix remix" siblings while the vos anyone was actually editing never changed. `--vos <id>` still names a target outright, for a directory that tracks nothing or tracks something else. Create-only flags (`--title`, `--slug`) against a tracked directory are refused in words naming both doors, rather than being dropped on the floor — the ambiguity is real, and guessing at it is what caused the original defect. The decision is pure and tested (`programPushTarget`).

### Patch Changes

- Updated dependencies [f53544a]
- Updated dependencies [f53544a]
  - @vosjs/core@0.25.0
  - @vosjs/studio-core@0.27.0

## 0.39.0

### Minor Changes

- 9c20818: `vos record --dry-run` rehearses a script before a take is spent on it. A missed selector used to cost a full real-time recording and its encode to discover. A rehearsal runs every step against the real page, in order, because a later selector usually exists only after an earlier click, but captures nothing and writes nothing: the pointer lands instead of travelling, every pause is cut to a beat, and the take directory keeps its footage, its cut and its script exactly as they were. Selector lookups keep their whole timeout, so a miss in the rehearsal is a miss in the take. It prints each step with the rect it resolved, in capture px (the rects a pin or `vos callout --step` reads), and exits 2 on any miss or a first load that never reached networkidle. `--storage-state` and `--browser-arg=` apply to it.

## 0.38.0

### Minor Changes

- 0032bae: `vos callout --body-px <n>` is the body size on the delivered frame. The size used to be multiplied by the footage scale and then floored, so on a rich capture (a 2560-wide take on a padded frame sits near 0.6) both 14 and 21 printed the same 11 / 20 / 15 and the flag read as ignored: the richer the capture, the smaller the note. An explicit size is no longer rescaled; without the flag the grammar's default stands, a note sized to the app as seen. The verb now prints the three sizes it chose and the footage scale it measured, in words and in `--json` as `sizes`, so a floor is visible instead of silent. The usage line says what `--color` paints: the pin's mark and leader, never the kicker, which is `--accent`.
- 0032bae: A brand kit can name the hue its callouts speak in. `vos callout` coloured the kicker and the card from the kit's `accent`, and some brands reserve theirs: a recorder's red marks time and nothing else, so a note kicker in it broke the brand's own rule, twice over when the product's playhead was in the same frame. `BRAND.md` may now carry a `callout` role, which wins over `accent` (`--accent` still wins over both). The composer cannot know what a brand reserves; a role is how the kit says it.
- 0032bae: A flag a verb never read is no longer swallowed. The parsers accept any `--name`, so `vos frames <take> --at 3,5,8` used to write five evenly spread stills and exit 0: the flag is `--times`, and nothing ever looked at `at`. Every verb now records which flags it actually read, and a run that succeeded while ignoring one exits 2 and says so: the command RAN, which flag it ignored, the documented flag it most likely meant, and the flags the verb reads. Reading is recorded rather than declared per verb, so a real flag can never be refused by a list that drifted.
- 0032bae: `vos push <take> --vos <id>` does what it says. A take push read its target from `vos.json` and nowhere else, so `--vos` on a directory without one was ignored and a second vos was created, silently, every time a take was re-recorded from scratch. It now ADOPTS that vos: the head is read, named as the base, and the take becomes the next version. `vos pull` was never the answer for this take, because it writes the hosted doc over the local one. `--vos` that disagrees with `vos.json`, and the flags only a program push reads (`--slug`, `--desc`, `--tags`, `--base`, `--remix-of`), are refused before anything uploads.
- 0032bae: `vos record` and `vos create` take `--browser-arg=<switch>`, repeatable:
  extra Chromium switches for the recording browser. A switch starts with
  `--`, so it is written with `=`, and every one given is kept, in order.

  Some product surfaces cannot be reached from a clean context. A recorder
  page needs a fake capture device to get past a permission prompt, and an
  extension page needs the extension loaded. The switches pass through to
  `chromium.launch` verbatim.

- 0032bae: `vos record` and `vos create` take `--storage-state <file>`: a Playwright
  storage state, so the recorder drives a SIGNED-IN product.

  Recording a demo of anything behind a login needed the sign-in to be part of
  the script, which is impossible when the flow is an emailed code, an SSO hop
  or a passkey. The flag hands the recorder a session that already exists, the
  way a person would arrive at their own app. Export one from a real browser,
  or with `context.storageState({ path })`.

- 0032bae: `vos record` and `vos create` release the screencast frames once the recording is encoded. The JPEGs are the bulk of a take (one hero take was 437 MB of a 452 MB directory) and nothing needs them afterwards: `vos digest` reads frames from them when present and from the video otherwise, which is the path every pulled take already runs on. They are dropped only after the recording exists and has bytes, so a failed encode never costs the only copy of the footage. `--keep-frames` keeps them.

### Patch Changes

- 0032bae: `vos brand` and `vos callout` write a face under the name the hosted catalog carries. A site ships `Inter Variable` or `Lexend Variable`, which is what a page's computed style reports, while the catalog hosts the same family as `Inter` or `Lexend` and a render page registers it under that name. CSS written with the site's name matched nothing and fell back to a system stack, silently on the fleet. The suffix is dropped where the name is written, only when the catalog hosts the base family; a family it does not host is left alone.
- 0032bae: `vos validate` says when a layer outlives the footage. A recording's output runs to the end of its last visual clip, on purpose, so words can play after the footage. The same rule meant a layer left behind by a trim silently lengthened the render, and the clip ended on bare backdrop with a note floating on nothing. The lint caught an out-of-range zoom and had no check for this at all. It is a warning and never a problem, because a problem would refuse every legacy end card; a freeze counts as footage, so an end card over its freeze stays silent.

## 0.37.0

### Minor Changes

- 01d7d75: A take's media is named and declared by its bytes, never by its name

  `vos fetch --media` wrote every recording to `recording.webm`, and `vos push`
  then declared that file `video/webm` whatever it held. A hosted take whose
  footage is mp4 under a `.webm` name (the in-page recorder remuxes to mp4 and
  keeps the name) therefore round-tripped into an asset typed webm holding mp4
  bytes, and every render of the new version died in the video element with a
  format error.

  The bytes now decide, at each place a claim used to be believed:

  - A pull sniffs the container it downloaded and names the file for it
    (`recording.mp4`, `mic.m4a`, `media/<id>.png`), so the take directory never
    holds a file whose extension lies. Files are streamed to a `.part` sibling
    and renamed, so a failed transfer leaves nothing behind.
  - A take directory tolerates any container: `takePaths().recording` resolves
    what is on disk, and render, frames, digest, plan, open and push all read the
    resolved name. `record` still writes WebM.
  - A push declares the type it finds in the bytes and corrects the uploaded
    filename to match, saying so.
  - The local take server serves by signature, so a page can decode a take
    whatever it is called.
  - `vos validate <take>` warns when a take's footage and its name disagree, and
    names the rename that fixes it.

  A name or a Content-Type is only ever the fallback for bytes that say nothing
  (an SVG, a recipe), so a name is corrected only on positive evidence.

## 0.36.0

### Minor Changes

- 0e1aa3d: `vos push` sends a long recording in parts.

  A request body has a ceiling the platform cannot raise from inside a
  handler: the edge refuses anything past it before the request arrives, with
  its own error page rather than a worded refusal. A screen recording of any
  real length clears that ceiling at any watchable bitrate, so pushing a take
  of more than a couple of minutes failed with a bare status and nothing to
  act on.

  A file past 32 MB is now declared, sent as parts, and sealed. The part size
  comes from the platform's reply rather than a constant here, so the split
  can change without a CLI release. Quotas are weighed at the declaring call,
  before a byte moves, so a refusal costs nothing and arrives in words; the
  content-addressed dedupe answers there too, so re-pushing a hosted take
  still sends nothing at all. A part that fails transiently is retried, and
  an upload that cannot finish hands its parts back instead of leaving them
  held.

  Applies to the take's recording and to the other media a document keys
  beside it. Small files still go in one request, unchanged.

## 0.35.0

### Minor Changes

- 9ad8984: Camera styles re-founded on the stage camera at 60 fps. `focus`, `cinema`, `snappy` and `cut` are re-timed in the default's traced curve family with two structural rules: a chain gap never sits below its pump-free floor (`pumpFreeChainGap`; `resolveZoomStyle` raises an override that does), and the lowering fits a ramp longer than its span to the room it has, never below `RAMP_FLOOR` (0.14 s), instead of compressing it into a one-millisecond cut. Levels come down to the reference field (snappy 2.5 → 2.2, focus and cut 2.2 → 2.0), holds gain a beat, and every style's tilt track moves at its own zoom tempo so a lean lands with its zoom. `keynote` and `drift` are retired names: they resolve to `glide` + medium tilt and `cinema` + subtle tilt, `migrateHostedDoc` (docSchemaVersion 5) rewrites a stored document onto the pair, and `vos validate` warns. `none` spells its camera as the default's, never a frozen copy. The planner never dwells on the opening run (the cursor parked before its first move), which had opened six of eight real takes on a corner zoom at the ceiling.

### Patch Changes

- Updated dependencies [9ad8984]
  - @vosjs/studio-core@0.26.0

## 0.34.0

### Minor Changes

- a56a2a5: The recorder's pace is the script's. A pointer gesture (the travel to a target, a drag) is driven by the clock: its position is a function of the elapsed time and it ends when its duration has elapsed, so a page that answers each pointer sample slowly (a slider re-rendering per move) costs samples, never seconds. The pointer travels at a hand's pace (0.7 ms per px, 250 to 800 ms). Typing is paced by the clock at `delayMs`. The fixed sleeps are gone: a selector lookup settles only when it scrolled the page, the press is 80 ms lead and 70 ms hold, and the settle after a click, a type or a scroll is data (`ms` on the step, defaults 150, 150 and 200), the script's own `wait` steps carrying the pauses that mean something. `vos record` ends with a pace line (what the script asked, what the gestures added, what the page cost, the steps that ran slow) and the `--json` done event carries it as `pace`. Measured on the same tweakcn script: 41.2 s before, 26.2 s after, with hovers from 2× to 1.4× of their ask and drags from 4.8× to 1.7×.

## 0.33.0

### Minor Changes

- bca523a: The callout grammar: three shapes a viewer learns once (`note`, `tag`, `code`) composed from the product's register by the distinguishability rules (the card inverts the app's value in the product's hue, keeps the accent for the kicker, sets its title at 1.35× the app's body as seen on screen, lifts on a real shadow and a hairline, rises in and fades out). studio-core exports `calloutClip` and the starters lead with the three shapes in the house register; `pinCandidates` lists the steps an unpinned layer could name.

  `vos callout <take> <note|tag|code> --step <id> …` writes a callout in the grammar from `BRAND.md` beside the take (or `--ground`/`--accent`), with its window from the step's output extent (a beat after the press, cut short by the next scroll or navigation), its type scale from the camera at its start, pinned to the step. `vos validate <take> --picture` renders the footage under every html layer and reports the ΔE between the card's ground and what it covers (under 8 a problem, under 16 a warning); an unpinned html or media layer whose window holds a step with an element gets the pin named in a warning.

### Patch Changes

- Updated dependencies [bca523a]
  - @vosjs/studio-core@0.25.0

## 0.32.0

### Minor Changes

- 1ae7be2: Pinned layers: an overlay clip may name its referent (`pin: { step | press | rect, side?, gap?, mark?, leader?, color? }`) and is placed beside it, following it as the camera moves. The lowering resolves the referent (a recorder step's element rect, the press nearest a source second, or a rect in video fractions) through the frame's camera into the clip's motion track, chooses the side once (the first of right, left, below, above that fits through the layer's life) and clamps the layer inside the frame; the layer keeps its screen size. A `mark` (`ring` or `underline`) is painted on the referent inside the card's zoom transform; a `leader` draws a hairline from the layer's near edge to the referent. `transform.x/y` stay the fallback for a pin that cannot resolve.

  The recorder keeps every hover, click, type and drag step's element rect on `meta.steps[].rect`; an older take resolves a step pin from the presses inside the step's window. `vos validate` refuses a pin that names nothing (an unknown or skipped step, a step that touched nothing, a pin naming two referents, a rect in pixels) and warns when a scroll or navigation inside the layer's window may have moved the referent, or when the frame has no room beside it. The framing warning about a layer sitting over the clicked element now tests the layer's box against the element as the camera shows it, for every layer kind, and names the fix.

### Patch Changes

- Updated dependencies [1ae7be2]
  - @vosjs/studio-core@0.24.0

## 0.31.1

### Patch Changes

- a40481e: Drags are followed. A press that travels before its release (a slider thumb, a scrubber, a thing moved across a canvas; `dragsFromTrack`, ≥ 1.5 % of the frame width over ≥ 0.2 s) plans one follow span at the style's new `dragLevel` (`g{n}`, `focusMode: 'auto'`) from the press to the release, and its press leaves the click clusters. Inside any follow span the lowering bakes a path sample every 0.1 s at the pointer's smoothed position for the whole press (`FollowEvent.path`), and the zoom track pans through them linearly after a glide into the first, so the camera moves with the pointer instead of waiting for it to leave the dead zone; the dead-zone follow resumes from the release. Under the stage camera the path is clamped to the cover band like any focus.
- Updated dependencies [a40481e]
  - @vosjs/studio-core@0.23.0

## 0.31.0

### Minor Changes

- 89eaf07: The stage camera: `frame.camera: 'stage'` makes a take's zoom a camera instead of a magnifier. The card scales and slides so the zoom's focus lands at the frame's centre (blended in over the first 0.3 of level, so level 1 stays the identity), the focus is clamped only so the card still covers the central 80 % of the frame, and past the card's edge the frame shows the ground, radius and shadow. New takes open on it (`BASE_FRAME_STYLE`); a document without the field keeps the clamped magnifier it was cut with, byte-identically. `zoomView`, `zoomViewport`, `focusForViewportCentre`, `cameraModel` and `cameraCentring` are the camera-aware layout helpers; `focusBounds`, `clampFocus`, the digest's `zoomWindow` / `zoomCoversRect` and the CLI's framing lint take the model. The doc schema and `vos validate` know the field.

### Patch Changes

- 2e4acb1: `cursor.style: 'arrow'` draws an OS-style pointer (a black arrow with a white edge, its tip on the recorded point) in place of the white dot, in the card and across a transition's ghost alike; click effects bloom under the tip. New takes open on it (`projectFromArtifact`); `DEFAULT_CURSOR_STYLE` and every stored `'default'` keep the dot. The doc schema's cursor description names the field.
- Updated dependencies [2e4acb1]
- Updated dependencies [6c0d4d7]
- Updated dependencies [89eaf07]
  - @vosjs/studio-core@0.22.0

## 0.30.1

### Patch Changes

- Updated dependencies [5c00f8f]
  - @vosjs/studio-core@0.21.0

## 0.30.0

### Minor Changes

- d339264: HTML layers: two rungs. **Images by URL**: an image the source names on `https://assets.vos.so/` (`<img src>`, `url()`) is fetched by the page and inlined the way faces are, keyed by URL in the same cache, so a design system's hosted icon paints; the lint now names any other host as one that paints blank. **Live layers** (`live: true`): the picture is a function of clip-local time. CSS `@keyframes` inside the layer are scrubbed to `t` (paused, delayed by `-t`), and `{{t}}` / `{{data.<name>}}` placeholders in the markup and CSS fill per frame from the clock and the clip's `data`, so a counter, a progress bar or a typed line come out on the timeline's clock in the preview and in every export chunk alike. One rasterize per frame while on screen, keyed by the moment on a 60 Hz grid, one picture per clip in the cache, the last landed picture drawn while the next composes; in capture the build rides the frame settle so the export is exact. A still layer is byte-identical to before. `vos validate` reads `live` and `data`, warns on an authored `animation-delay` under `live`, on placeholders in a still, and no longer on `animation` under `live`.

### Patch Changes

- Updated dependencies [d339264]
  - @vosjs/studio-core@0.20.0

## 0.29.1

### Patch Changes

- 12ad384: A program directory pushes whole: a fresh `vos push` of a `config.json` with a `doc.json` beside it now carries the program document (it rode the version path only, so the vos it created had no doc), and both push paths store the COMPOSED config, the studio's own save shape, so the fleet renders a layered program's layers in its still and preview instead of the ground alone. A template may be a program document: `--with` a one-layer member on the shelf lays its layer instead of throwing on the segments it never had.
- Updated dependencies [12ad384]
  - @vosjs/studio-core@0.19.1

## 0.29.0

### Minor Changes

- 9ebcc7f: `doc.json` accepts a `kind: 'html'` overlay clip (`html`, `css`, `box`, `bleed`, `fonts`): `vos validate` runs the layer's gate and says in words what would silently not paint, `push` and `pull --media` pass it through untouched (it has no key and is never an upload), and a template's html clips apply with nothing to swap.

### Patch Changes

- Updated dependencies [9ebcc7f]
  - @vosjs/studio-core@0.19.0

## 0.28.1

### Patch Changes

- Updated dependencies [7282032]
  - @vosjs/core@0.24.0
  - @vosjs/studio-core@0.18.1

## 0.28.0

### Minor Changes

- df692d7: Transitions at a boundary. A footage clip's `anim` says how it meets the clip beside it (`exit` at the boundary after it, `enter` at the one before: `slide`, `fade`, `scale` or `none`; a slide names its `side`, a step its `seconds`), and the card's own enter gains `slide`. The lowering turns every boundary that moves into a record in output seconds; the incoming clip plays live while the outgoing card, frozen on its last frame, moves away on a second plane fed by a ghost element (so a cold seek in an export chunk decodes it like any frame, and one recording can be both cards at a page change); the camera rests through the window; one cursor dot crosses in frame space. The recorder marks steps that changed the page's URL, `vos plan` proposes a transition at each (`transitions:` in LAUNCH.md or `--transitions`), and `vos validate` lints the kinds and refuses a transition longer than half the shorter clip.

### Patch Changes

- Updated dependencies [df692d7]
  - @vosjs/studio-core@0.18.0

## 0.27.0

### Minor Changes

- 20e8b1a: Many cards in the schema and the lints: a media overlay's `key` may be `media:<id>` (a document media, with its facts) and `frame` makes it a card (a browser bar, a lean, the layered shadow); `vos validate` names a stranger reference and a foreign card field; a push never treats a media reference as a take file.

### Patch Changes

- Updated dependencies [20e8b1a]
  - @vosjs/studio-core@0.17.0

## 0.26.0

### Minor Changes

- e0e0b2c: `still` in doc.json (the frame that stands for a take, output seconds), `vos plan --still <t>` and LAUNCH.md `still:`, `vos frames --at-still`; the kit's card stills read the same derivation as the shelf's cover; an end card keeps a freeze the take owns at its end.

### Patch Changes

- Updated dependencies [e0e0b2c]
  - @vosjs/studio-core@0.16.0

## 0.25.1

### Patch Changes

- fa700ab: An end card laid on a take of many media freezes the LAST clip on its own media: the trailing freeze a template carries (`applyTemplate`) and the one `vos plan` proposes name the media under the last clip, instead of landing their seconds on the primary's footage.
- Updated dependencies [fa700ab]
  - @vosjs/studio-core@0.15.1

## 0.25.0

### Minor Changes

- 9011941: `media[].frame`: a media's own card (placement and size, the bar, the corner, the shadow, the border, the cover fit and its focus) in the schema, linted to the card-owned fields.

### Patch Changes

- Updated dependencies [9011941]
  - @vosjs/studio-core@0.15.0

## 0.24.0

### Minor Changes

- 07eaaea: Many media in one take: `doc.json` carries `media[]` (the take's other recordings, each the `source` shape with an `id`) and `media` on a segment and on every source-anchored span; the schema and the lints know them (a span is measured against its own media's length, an unknown id is a problem), `vos plan` proposes zoom and speed spans on every media from its own cursor track, and `vos push` and `vos pull --media` carry every media's recording and sidecars through the recording door.

### Patch Changes

- Updated dependencies [07eaaea]
- Updated dependencies [07eaaea]
  - @vosjs/render-core@0.2.5
  - @vosjs/studio-core@0.14.0

## 0.23.0

### Minor Changes

- ed184a1: A template ref resolves on vos.so's official shelf by title as well as by id or slug (`--with "End card"`, `--style "Split cover, landscape"`), and the end card `vos plan` proposes when `LAUNCH.md` leaves `endCard` on or unsaid is the official `End card` template, laid at the end and stamped `from: endcard`; the house clips stand in offline. A template stamped `from: endcard` is the end card: `endCard: none` drops it and a re-plan replaces it.

## 0.22.0

### Minor Changes

- e4328d2: The card is on screen exactly while its clip runs (the footage, freezes included) and is gone after it, like every layer: past the footage the clips play over the ground alone, and the card's `anim.exit` plays over the clip's last seconds and ends gone (a recede steps back first and fades last). An end card is a freeze of the last frame under its words: a legacy `endCard` migrates to one, the house end card writes one (`from: 'endcard'`), a template that ends on a freeze lays it onto the take with its clips, and a loop drops it with them. A freeze takes `from`.

### Patch Changes

- Updated dependencies [e4328d2]
  - @vosjs/studio-core@0.13.0

## 0.21.0

### Minor Changes

- 680fc50: A freeze is a retime primitive beside the speed spans: `doc.freeze` holds source moments frozen for output seconds, anywhere in the footage, placed by the lowering as rated pieces from one seam (`placeFreezes`), drawn by a `freezeLane` on the same row as the speed bands, and read as the rest where the last one begins. A segment's `hold` is the legacy spelling, migrated on read into a freeze at that segment's end (hosted documents step to schema version 4). The CLI's schema and lints take `freeze`, `plan --reuse` re-times freezes like the manual spans, and `plan --style <poster>` carries the trailing freeze.

### Patch Changes

- Updated dependencies [680fc50]
  - @vosjs/studio-core@0.12.0

## 0.20.0

### Minor Changes

- 6c4fb1b: The CLI writes the one animation vocabulary and assembles templates.

  - `vos plan` proposes the card's `anim.enter` (never `frame.entrance`), lays the templates the recipe names at their anchors (`LAUNCH.md` `with: <ref>[@end|@start|@step:<id>|@<seconds>], …`, `--with` repeatable, `endCard: <ref>` at the end; a ref is a doc.json, a take dir or a vos id) with the release's words and the brand's mark patched in by id and every clip stamped `from`, writes the house end card as clips after the footage plus a card exit (`from: 'endcard'`) when `endCard` is on or absent, and gives the captions `anim`. A previous cut carried by `--reuse` is read into the vocabulary first.
  - `vos deliver`'s loop mechanics drop the card's `anim`, every clip a template placed and the captions; the cuts and the stills read the output's end (the clips after the footage included) rather than the footage's.
  - `vos validate` warns on the older spellings (`frame.entrance`, `endCard`, a clip's `enter`/`exit`/`fx`, a prop's `animation`), which are read into `anim` on the way in.

## 0.19.0

### Minor Changes

- 58a9812: One animation vocabulary on every visual primitive, and the output ends at the last clip.

  - `anim` (`enter`, `exit`, `idle`; a kind, or a step with its seconds and, for words, the per-unit grammar) on the card (`frame.anim`), on text, image and video clips, and on props. `frame.entrance`, a clip's `enter`, `exit` and `fx`, and a prop's `animation` are read into it on migration and lower to the same picture; the fields stay accepted as legacy input for one cycle.
  - The output lasts until the last visual clip ends (`docOutputDuration`, the lowering's `duration`); past its footage the card holds its last frame at the pose its `anim.exit` settled into (`recede` keeps it small and dim behind whatever plays after it, `fade` takes it out), and a `hold` stays the freeze primitive. A document that ends on its footage lowers byte-identically. Audio never extends the output.
  - `doc.endCard` migrates on read into clips placed after the footage (stamped `from: 'endcard'`) plus a card `exit` of `recede`, so an end card is nothing but primitives a timeline can show and a person can retype in place. `expandEndCard` survives, deprecated.
  - `from` on overlay, prop and audio clips: the template that placed them, provenance the lowering never reads.
  - `applyTemplate(template, take, { at, words, keys, from, look })`: a template is a plain take document on a shelf, applied at an anchor (`start`, `end`, or an output second) with the release's words and keys patched in by id; `clipsFrom` and `dropTemplate` read and remove what one template placed. `copyLayout` stays, and a layout's frame fields now carry the card's `anim` in place of `entrance`.
  - `docSchemaVersion` 3; `migrateHostedDoc` rewrites a recording document's motion spellings into the vocabulary.
  - The CLI's schema and `vos validate` accept `anim` and `from`, checked per primitive (the card cannot typewrite, a word cannot tilt in, only a prop idles).

### Patch Changes

- Updated dependencies [58a9812]
  - @vosjs/studio-core@0.11.0

## 0.18.0

### Minor Changes

- ea7f169: A poster is a document, and `vos deliver` renders it. A layout is a poster document on a shelf, never a name the document learns: studio-core gains `copyLayout` (and `copyStyle(from, to, { layout: true })`), which carries an exemplar's card placement and presentation (`LAYOUT_FRAME_FIELDS`), its `stage-*` clips by id (a same-id text clip keeps the words this take already has, an image clip keeps its own key or takes one handed in), its rest lean as a whole-take `rest` span where the take has no tilt spans, and its trailing hold; `layoutOf` reports what a document carries, and `docRestTime` is the one convention for THE REST (the trailing hold's start, null with an end card), for every still-taking surface. `vos plan --style <poster>` carries the layout and patches the release's words into the stage clips (LAUNCH.md's headline and kicker roles, BRAND.md's wordmark, or `--headline` and `--kicker`); the brand's mark is fetched into `<take>/brand/` for the layout's `stage-mark` and the end card. The cut's MOTION is the document's too: `vos plan` proposes the card's entrance, the end card, a caption per actions.json step, a music bed and click sounds from LAUNCH.md's roles on a fresh plan (`--motion` re-proposes onto an existing doc.json, replacing only its own ids and fields), so the studio shows exactly what the kit renders and a deleted proposal stays deleted. `vos deliver` composes nothing any more: card-genre destinations render from the poster document of their aspect class (landscape, square, portrait, tile), found beside the take as `poster/<class>/doc.json` (`poster/doc.json` serves every class) or named in LAUNCH.md (`poster: <path>`, `poster-<class>: <path>`; a path to a doc.json, or to a pulled poster take that renders over its own footage), at the document's rest; kit.json records `source: 'poster'`, the class, the file, the vos it tracks, and the shot rect and text boxes read from the document, which `vos validate --picture` checks. A class with no document is the take's own frame, said once. Deliver applies each video destination's mechanics and no taste: the README loop drops the entrance, the end card, the captions and the sound; a channel that autoplays muted drops the bed; the 9:16 cut reframes and follows the camera. Removed: `--poster`, `--shot-time`, `--poster-time` and the bundled template and stage legs from `deliver`, whose `--headline`, `--kicker`, `--music`, `--entrance`, `--end-card`, `--captions` and `--clicks` move to `plan`.

### Patch Changes

- Updated dependencies [ea7f169]
  - @vosjs/studio-core@0.10.0

## 0.17.4

### Patch Changes

- de94195: mediabunny moves from 1.27.3 to 1.55.7 everywhere it is pinned: the capture-video template's importmap, the recording composition's WebCodecs provider, the render harness's mux and the CLI's render and encode pages. Explicit bitrates render as before; a subjective quality (`QUALITY_HIGH` and friends) now means constant quality, which halves a screen recording's file for the same picture.
- Updated dependencies [de94195]
  - @vosjs/core@0.23.5
  - @vosjs/studio-core@0.9.1
  - @vosjs/render-core@0.2.3

## 0.17.3

### Patch Changes

- b858500: `vos render` decodes a take's recording through the WebCodecs sequential provider (frames by PTS, the recording kept as a Blob) instead of an element seek and a settle wait per frame. A 14 s take at 2560×1440 rendered in 9.8 s where it took 59.6 s; the element path could also land footage a frame late in fast motion, which the by-PTS path does not.

## 0.17.2

### Patch Changes

- Updated dependencies [2649873]
  - @vosjs/core@0.23.3
  - @vosjs/studio-core@0.9.0

## 0.17.1

### Patch Changes

- 48b0f03: A tilted card no longer shows the backdrop through its own edge when the camera is zoomed (or the card is bled past the frame, or it recedes under an end card). The card layer's canvas and plane now grow by exactly how far the pose lets the frame see past its edges, derived from the stage geometry at the live aspect from the tilt and card-pose tracks (`cardVisibleExtent`, `cardOverscanFor` in `@vosjs/studio-core`), replacing the fixed 1.25 overscan that applied only to bled insets.
- Updated dependencies [48b0f03]
  - @vosjs/studio-core@0.8.0

## 0.17.0

### Minor Changes

- c2c6b8a: The brand's mark is placed, not only recorded. `vos brand` prefers a bare mark the site names in its design.md over a favicon or app icon (which carry a tile) and records the on-dark twin as `logoOnDarkUrl`; `vos deliver` fetches the mark into the take's `brand/` folder (a site's logo URL rarely carries a CORS header, and a cross-origin image taints the canvas), reads its aspect from the bytes, and composes the site's own lockup: the mark beside the wordmark on the stage cards, alone in a wordless tile's top band, and above the wordmark on the end card (`endCard.mark`); a wide mark, a stylised wordmark asset, stands in for the word. A dark ground takes the on-dark twin or keeps the word alone.

### Patch Changes

- Updated dependencies [c2c6b8a]
  - @vosjs/studio-core@0.7.0

## 0.16.0

### Minor Changes

- c10176b: Stills render supersampled: a destination under 1800 px on its long side renders at two or three times its pixels and downscales once with the browser's high-quality resampler (`stillSupersample`), so a 440 px store tile is sharp instead of one bilinear tap away from a 1920 px recording. The stage's headline is the brand's display face (a serif only when the brand's is one) set at -2% tracking, and its words carry no shadow. The baked poster shot's shadow is two low-alpha layers.

### Patch Changes

- Updated dependencies [c10176b]
  - @vosjs/studio-core@0.6.0

## 0.15.0

### Minor Changes

- 5dc27dc: The split cover renders as a STAGE by default: the take's own card leaning in perspective with its chrome, radius and shadow on the brand's ground, bled off the right and the bottom, beside a serif headline column (the brand's display face when it is a serif, else Fraunces); `--poster split-cover` keeps the program template. Composed cards sharing one frame is a note, not a problem; `vos judge` counts a tie as a half.

## 0.14.0

### Minor Changes

- c6fdb8f: The release kit composes. studio-core: `frame.inset` (per-side card placement as fractions, a negative side bleeds), `frame.shadowContact` and `frame.shadowColor`, a pure `look` module (plate, gradient, dark; `lookFromBrand`, `cardInset`, `applyLook`), `frame.entrance` (tilt-in, pull-out, rise) lowered into the tilt or zoom track's head plus a card-pose track, a segment `hold`, `doc.endCard`, `frame.focusFollow`; the channel specs carry a word policy, a safe rect and a default poster template per destination.

  CLI: `vos deliver` presents cards and cuts in a look read from `BRAND.md` beside the take (or `--look`), picks its still moments from the step timeline and drops blank or duplicate frames with the reason, renders every card destination from a bundled poster template (`split-cover`, `card-on-gradient`) filled with the brand's colours and faces and `LAUNCH.md`'s headline, bakes the shot as an object, and plans each video by kind (entrance, end card, beat captions from `actions.json`, a music bed and click sounds where the channel plays sound, the 9:16 reframe). `vos validate <kit.json> --picture` reads what each asset looks like (blank, duplicate, subject, separation, halfsize, sliced, safe, contrast, firstlast) with a code, a fix hint and a box. `vos judge <kit.json> --against <manifest>` composes pairwise sheets beside a reference set and reports the win rate. `vos brand` writes a `look` role.

### Patch Changes

- Updated dependencies [c6fdb8f]
  - @vosjs/studio-core@0.5.0

## 0.13.1

### Patch Changes

- 598cec7: `vos deliver --composed` parses as a bare flag (it used to demand a value), `vos help` lists `vos actions` and says the recording cap is read live, and the README documents every verb and flag the binary accepts.
- 4dbb8ed: `vos pull <take> --check` reports what changed without writing, and `--since <versionId>` walks the changelog from a base you name, on the take path as the help always said. Every engine verb now tells a take from a program directory by what its `doc.json` carries, so a program directory that holds a program document renders as the composed program (its layers and tween edits ride) instead of dying in the take renderer; a take handed to `still`, `info` or `check` is refused in words that name the take pipeline.
- Updated dependencies [598cec7]
  - @vosjs/core@0.23.2
  - @vosjs/elements@0.8.1
  - @vosjs/timeline@0.4.1
  - @vosjs/tween@0.8.2
  - @vosjs/editor@1.3.1
  - @vosjs/studio-core@0.4.1
  - @vosjs/render-core@0.2.1
  - @vosjs/shared@0.4.1

## 0.13.0

### Minor Changes

- d4b1f0f: `vos record` and `vos create` read the hosted recording cap live from the platform's public `GET /api/limits` before a take (the caller's own plan when a key resolves), so a change on the platform reaches the next take without a release. The built-in 30 minutes is the offline fallback, said in words when it applies; `--max-duration` overrides either.

## 0.12.0

### Minor Changes

- baaa9c8: `vos record` states the hosted recording cap from its own constant (`--max-duration` still overrides it); the plan table it used to read left `@vosjs/shared`. `vos digest` reports `tokensEstimate` (the old `tokensEstimateClaude` name stays in the JSON for one minor).

### Patch Changes

- Updated dependencies [baaa9c8]
- Updated dependencies [baaa9c8]
  - @vosjs/shared@0.4.0
  - @vosjs/studio-core@0.4.0

## 0.11.1

### Patch Changes

- Updated dependencies [7b25557]
- Updated dependencies [7b25557]
  - @vosjs/render-core@0.2.0
  - @vosjs/shared@0.3.0
  - @vosjs/studio-core@0.3.1

## 0.11.0

### Minor Changes

- 007529f: The backdrop a new take opens on is the host's pick, not the document model's. `@vosjs/studio-core` keeps the mechanism only: `withBackdrop(frame, backdrop)` and `backdropMedia(backdrop)` write a loop and its ground onto a frame, `BASE_FRAME_STYLE` is exported as the frame with no backdrop, `DEFAULT_FRAME_STYLE` is that bare frame, and `projectFromArtifact(artifact, url, { frame })` opens a take on whatever frame the host hands it (the browser bar is still derived from the footage). `DEFAULT_BACKDROP`, `BACKDROP_DEFAULT_ON`, `defaultBackdropMedia` and `withDefaultBackdrop` are removed. The stub compositor tests build on `BASE_FRAME_STYLE`.

  `vos record`, `vos create` and `vos plan` open a fresh take on the platform's house backdrop: the first ready loop of `GET /api/backdrops` (the set the studio publishes), with its poster, period and ground. `--background <slug|url|none>` picks another or none; when the set cannot be read the take opens on the bare frame and the command says so. A `--style` or `--reuse` reference's frame still wins.

### Patch Changes

- Updated dependencies [007529f]
  - @vosjs/studio-core@0.3.0

## 0.10.1

### Patch Changes

- Updated dependencies [a3ab9f8]
  - @vosjs/shared@0.2.0
  - @vosjs/studio-core@0.2.1

## 0.10.0

### Minor Changes

- 14799a9: A deleted planner proposal stays deleted. `doc.rejected` records the lane and the source extent of an `auto` zoom, tilt or speed span that was removed (its step anchor along with it), and every re-plan drops a fresh proposal that lands on it: `vos plan`, `plan --reuse` (which re-times the rejections onto the new footage the way it re-times manual spans) and the studio's re-plans through the new `isRejected` / `withoutRejected` / `rejectSpan` helpers. `vos validate` lints the list; `schema/doc.schema.json` documents it.

### Patch Changes

- Updated dependencies [14799a9]
  - @vosjs/studio-core@0.2.0

## 0.9.2

### Patch Changes

- e2f6b24: A type step takes `focus: false`, and a converted `press Enter` uses it, so the keystroke that submits a field no longer clicks it a second time and rings a click effect on empty space beside the text.

## 0.9.1

### Patch Changes

- e9c403c: The library surface exports the take server (`startTakeServer`, `waitForPageDone`, the `TakeServer` type) and `RECORDING_NAME`, so a script that serves a take directory to a render page the way `vos open` does no longer needs the package's internals.

## 0.9.0

### Minor Changes

- 62ac21e: One package, every verb. The take pipeline and the vos.so verbs that shipped as `@vosso/vos-plugin` (record, plan, digest, frames, deliver, brand, validate, actions, open, fetch, push, pull, login, duplicate, folder, asset, recipe) now live inside `@vosjs/cli`: `npm i -D @vosjs/cli` is the whole install, `vos help` lists them under the engine verbs, and the delegate-on-unknown seam, the plugin manifest handshake and the "install the plugin" error path are gone. The three libraries under them publish as `@vosjs/studio-core`, `@vosjs/render-core` and `@vosjs/shared`. `@vosso/vos-plugin` ships once more as a forwarding shim that says so.

## 0.8.5

### Patch Changes

- f17ca0f: `vos still` refuses a `.png`/`.jpg` output name in words: the capture template writes WebP, and a still named `.png` shipped WebP bytes under a lying extension, which stores refuse as a mislabelled image.

## 0.8.4

### Patch Changes

- Updated dependencies [f02a80f]
  - @vosjs/core@0.23.0
  - @vosjs/tween@0.8.1

## 0.8.3

### Patch Changes

- Updated dependencies [d621857]
- Updated dependencies [d621857]
  - @vosjs/core@0.22.0
  - @vosjs/elements@0.8.0
  - @vosjs/tween@0.8.0

## 0.8.2

### Patch Changes

- Updated dependencies [a165ecb]
- Updated dependencies [cf84b4c]
- Updated dependencies [ab92044]
  - @vosjs/core@0.21.0
  - @vosjs/elements@0.7.1

## 0.8.1

### Patch Changes

- 8b601ec: `VosConfigJson` requires `version` again, and authoring gets its own type.

  The canonical shape is the one that gets stored, served and read back later,
  and it always carries a version. Typing the field optional described the
  exception (a config being written and played right now) as though it were the
  rule, and told every TypeScript author the field was theirs to skip.

  - `VosConfigJson.version` and `VosConfig.version` are required.
  - `AuthoredVosConfigJson` is the new authoring shape: the canonical one with
    `version` optional. `compileVosConfig` takes it, because playing a config is
    transient and watched.
  - `migrateConfig` is the bridge, and its overloads say so: an authored config
    in, a canonical one out. Untrusted JSON in returns untrusted JSON with a
    guaranteed `version` and no claim about the rest.
  - `vosConfigJsonSchema` requires `version` again. Every caller already migrates
    before parsing, so the schema describes the canonical shape and
    `migrateConfig` is the single tolerant door.

- Updated dependencies [8b601ec]
  - @vosjs/core@0.20.0

## 0.8.0

### Minor Changes

- 880b4ee: Config version 2 is the floor. The v1 migration is removed.

  The engine was never public at v1: `migrations.ts` arrived in the first public
  commit already reading `CURRENT_CONFIG_VERSION = 2`, so no config outside
  vos.so was ever authored against v1, and the last v1 artifact there has been
  carried forward.

  - `migrateConfig` refuses a v1 config (`No migration from config version 1 to
2.`) instead of migrating it. The migration map is empty but kept: a future
    v2 to v3 registers there and the loop runs it unchanged.
  - `vos check` reports a v1 config as an error, and now warns when a config
    declares no version at all: it plays locally, but a host that stores configs
    refuses it.

### Patch Changes

- Updated dependencies [1d29a86]
- Updated dependencies [880b4ee]
  - @vosjs/core@0.19.0

## 0.7.1

### Patch Changes

- Updated dependencies [26e8d41]
  - @vosjs/core@0.18.0

## 0.7.0

### Minor Changes

- 2543f59: The CLI is now engine-only: `render` / `still` / `info` / `check` / `preview` / `versions`, local and account-free. The platform verbs (`fetch` / `push` / `pull`) moved to the vos plugin (`@vosso/vos-plugin`, npm), next to the service they talk to — installed plugin verbs surface through `vos <verb>` exactly as before via a new delegate-on-unknown seam, appear in `vos help` through the plugin's manifest, and get a version row in `vos versions`. Existing installs keep working: the earlier plugin package names still resolve as fallbacks, and `vos voila <verb>` remains a hidden alias.

## 0.6.4

### Patch Changes

- Updated dependencies [beb07a0]
  - @vosjs/core@0.17.0
  - @vosjs/elements@0.7.0

## 0.6.3

### Patch Changes

- Updated dependencies [0fb1305]
  - @vosjs/core@0.16.0

## 0.6.2

### Patch Changes

- Updated dependencies [77fa2c8]
  - @vosjs/elements@0.6.0
  - @vosjs/core@0.15.0

## 0.6.1

### Patch Changes

- Updated dependencies [f49ab19]
  - @vosjs/elements@0.5.0
  - @vosjs/core@0.14.0

## 0.6.0

### Minor Changes

- c1bddb3: `config.fonts` — webfonts as first-class config. Declare faces as `fonts: [{ family, url, weight?, style? }]` and the compiled template registers them via the FontFace API and AWAITS them (capped 4s, fail-open) before scene setup and element rendering, so canvas text rasterizes with the real face in preview and in every capture path, including per-chunk fresh pages. Headless render environments have near-zero system fonts, so any non-generic family a text element uses should carry a declaration — the new `lintVosFonts` (exported from `@vosjs/core/lint`, wired into `vos check` as the `fonts` source) warns on undeclared families. Schema keeps the block passthrough (nothing stripped); a declaration without a `url` is rejected.

### Patch Changes

- Updated dependencies [c1bddb3]
  - @vosjs/core@0.13.0

## 0.5.2

### Patch Changes

- Updated dependencies [27264cf]
  - @vosjs/elements@0.4.0
  - @vosjs/core@0.12.0

## 0.5.1

### Patch Changes

- Updated dependencies [25d1d7d]
  - @vosjs/core@0.11.0

## 0.5.0

### Minor Changes

- 9c8b074: `vos pull` — the other half of the iteration loop: fetch the attributed, typed changelog of what changed on vos.so since your base (versions with origin/label/note + semantic summaries + the protected human-edited node set), sync `config.json` to the head (previous copy kept as `config.backup.json`), and repoint the tracked base. `vos push` now tracks its base automatically through `meta.json`, accepts `--label` and `--overrides`, distinguishes stale-base from protected-node 409s, and — like `pull` — delegates take directories to the take pipeline.

## 0.4.0

### Minor Changes

- 61a0e2a: Platform verbs: `vos fetch` (pull a program's config + metadata from vos.so, params preserved), `vos check` (local validation: migrate → schema → syntax → compile → determinism/dialect lints), and `vos push` (create a private remix with lineage, or iterate an existing vos with `--vos`, forwarding `--base`/`--note`). Credentials resolve from `VOS_API_KEY` or `~/.config/vos/credentials` and are never printed; `VOS_ORIGIN` overrides the platform origin.

## 0.3.0

### Minor Changes

- 51b6119: The take pipeline's verbs are promoted to the top level: `vos create / record / plan / frames / open / validate` delegate to the separately installed `@vosso/cli` (previously `@vosso/voila-cli`, which remains an install fallback), and `vos render` is now polymorphic — a take directory (recognized by its `doc.json`) renders through the take pipeline, anything else renders as an engine config. `vos voila <verb>` keeps working as a hidden alias and prints a one-line pointer at the new spelling. The `vos orbit` and `vos riff` stubs are removed: both are unknown commands again (3D showcase renders as a plain vos config; the remix contract stays at vos.so/llms-remix.txt).

## 0.2.2

### Patch Changes

- 76d4f17: Remove the `vos orbit` stub: 3D showcase is part of riff (a showcase program is a plain riff program), so the pointer to the working 3D path — drop a GLB at vos.so/riff, or remix a program from the 3D shelf — now lives in the `vos riff` stub. `vos orbit` is an unknown command again.

## 0.2.1

### Patch Changes

- d6c48db: The `vos orbit` stub now points at what actually works: the 3D showcase programs in the vos.so catalog (params + the documented buildProduct() swap point), the HTTP remix contract, and local `vos render`.

## 0.2.0

### Minor Changes

- 32e0732: Reserve the `vos riff` and `vos orbit` product namespaces. Both are honest stubs for now: they print what works today (riff's HTTP remix contract at vos.so/llms-remix.txt, `vos render` for 3D configs) and exit non-zero so scripts and agents never mistake a stub for a successful run.

## 0.1.3

### Patch Changes

- Updated dependencies [b7b0e7d]
  - @vosjs/core@0.10.0

## 0.1.2

### Patch Changes

- Updated dependencies [32a69a9]
  - @vosjs/core@0.9.0

## 0.1.1

### Patch Changes

- Updated dependencies [c6c5075]
  - @vosjs/core@0.8.0
