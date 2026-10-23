# @vosjs/render-core

## 0.9.0

### Minor Changes

- 1cbfe14: `expect` and `await` check what an app keeps in script rather than in the DOM. `{ "do": "expect", "js": "window.app.count() === 14" }` holds when the expression, evaluated in the page (a promise is awaited), is truthy; with `equals` (`"js": "window.app.count()", "equals": 14`) it holds when the value equals that one, compared as JSON, and a miss says what the app had: ``js `window.app.count()` was 15, not 14, for 5 s``. An expression that throws is read again until the timeout and a miss says what it threw. `await` takes the same in `until`. The value the expression last answered is kept on the step as `meta.steps[].value` (`StepSpan.value`, its JSON at most 2 KB) and printed beside the step in a rehearsal. Timeouts, skips and `--strict` are an `expect`'s and an `await`'s; the CLI refuses an expression that does not parse before a browser opens (`vos validate actions.json` too), and `hostedRefusals` refuses a `js` check, since a hosted browser runs no code a submitted script hands it. `vos actions script` says a `js` check as the console expression to run.
- e15e211: `actions.json` takes `peers`: other people on the page, off camera. Each peer is a browser context of its own (signed in from its own `storageState`, or signed out) on the take's `url` or its own, driven by its own steps: `wait`, `move`, `hover`, `click`, `type`, `press`, `scroll`, `drag` (an inline `path`) and `expect`, in the take's own step shapes. A peer step starts `with` a take step (as it starts) or `after` one (as it ends), named by id, else right after the peer's previous step. Only the take's page is filmed and only its own steps make the cursor track; what a peer does reaches the footage through the app's own sync. A peer's pointer and typing are paced on the take's clock, every peer step is bounded, and a miss is a skip listed with the take's (`peer` set), which `--strict` fails on. A peer that lands on a sign-in, or a storage state that is not there, refuses the take before anything is captured; a step still waiting when the take's steps end never runs and is said. `meta.peers[]` (`PeerTrack` in studio-core) places each peer step in the take's footage seconds, the done event carries `peers`, a rehearsal lists them, `vos actions script` says them as a second person's beats, a pushed script names a peer's storage state by its file name only, and `hostedRefusals` refuses peers. `RecordOpts.peerStorageState` resolves a peer's sign-in; `SkippedStep.peer` marks a peer's miss.
- 8602e80: `actions.json` steps take a `zoom` mark. On a gesture (click, drag, type, paste, press, hover), `"zoom": true` marks the step as its beat's payoff, the step `vos plan --zooms per-beat` keeps its zoom on, and `"zoom": false` means never zoom here. `validateActions` checks it, the recorder keeps it on `meta.steps[].zoom`, the pushed script carries it and `vos fetch` writes it back, and `vos actions script` says where the cut zooms in. A plain `vos plan` rejects the planner's proposal on a `false` step for good, and names a `true` step it proposed nothing for: a mark never invents a zoom. A mark is read from actions.json first, so one added after recording takes effect on the next plan without recording again.

### Patch Changes

- 1cbfe14: A pasted file travels with its take. `vos push` sends every file the take's `actions.json` pastes and lists them on the document as `source.scriptFiles` (the name the script pastes it by → where its bytes are): a picture through the same upload door as every other file the document names, a text file inside the document as a `data:` address (at most 256 kB). `vos fetch --media` and `vos pull --media` write each one back beside `actions.json` under that name, never over a file already there, and record a hosted one in `vos.json` like the footage, so a fetched take records again from anywhere. Only a name the document's own script pastes is written, and only from the platform's file door or the document itself. A paste file the take does not hold is said and left out; one that resolves outside the take directory is refused before anything is sent (exit 2). A claimable push carries a pasted text file and a pasted picture the take fetched unchanged, and says what it leaves out. A drag's `path` file needed nothing: the take's script already carries its points inline. The recorder's message for a missing paste file says the fetch now brings it.
- e15e211: A peer's `expect` keeps what its check last answered on its step (`meta.peers[].steps[].value`), as the take's own steps do: when the check reads the app's state, the value says what the peer saw at that moment, which no frame of the take can, since the peer's page is never filmed. JSON, at most 2 KB, else that JSON cut short as a string.
- e15e211: A `zoom` mark on a peer step is refused in words, `true` or `false`: a zoom mark picks a moment on the cursor track, and a peer's steps are never on it.
- Updated dependencies [4d4c17b]
- Updated dependencies [1cbfe14]
- Updated dependencies [4d4c17b]
- Updated dependencies [3465137]
- Updated dependencies [1cbfe14]
- Updated dependencies [e15e211]
- Updated dependencies [e15e211]
- Updated dependencies [4d4c17b]
- Updated dependencies [4d4c17b]
- Updated dependencies [8602e80]
  - @vosjs/studio-core@0.45.0

## 0.8.0

### Minor Changes

- 96fab94: The recorder's scan notes, as information and never as a strict failure, where the signed-in account's own name shows in the frame (never printing the name, not even inside a selector) and any list of the account's recent items with the mask that hides it: `meta.notices[]`, the done events, the rehearsal and `vos validate`.
- 753af27: `actions.json` speaks canvas. `press` takes `keys`: a chord (`"Shift+D"`, `"Mod+Z"`, with `Mod` Meta on macOS and Control elsewhere), a plain key (`"r"`) or a sequence (`["v", "Escape"]`), each a typing ping that never carries the key. `drag` takes `modifiers` held for the whole drag, and `path`: viewport points inline or in a file beside the actions file, replayed point by point by their own times or evenly over `ms`, drawn with a pen when the points carry pressure. `click` takes `count: 2 | 3`, `button: "right" | "middle"` and `modifiers`, and `click` and `hover` take a viewport point (`x`, `y`) instead of a selector. A new `paste` step pastes words through the browser's clipboard with a trusted chord, and an image file as its own bytes in a paste dispatched in the page (the clipboard re-encodes a picture and drops its density); a hosted take refuses it. A gesture may `settle` (per step, or for the whole script): it waits until the page has made no DOM change and painted no new frame for 300 ms since its last change, and goes on at once on a page already still. A paced gesture that ran more than a fifth past its script is reported as `meta.steps[].overrunMs`, `overruns` in the done event and one line. `vos actions script` says the new steps in words. The recorder's driver contract gains `mouse.down`/`up` options, `keyboard.down`/`up` and an optional `grantPermissions`; `RecordOpts.files` reads the files a script names. `StepSpan` gains `overrunMs` and `settleMs`. The script a take keeps is self-contained: a path a file held is written inline in the take's `actions.json` (what a push embeds, a fetch writes back and a hosted take runs), `--hosted` sends it inline, and a pasted file is kept beside the script as `paste-<name>`.
- 96fab94: Sound a page plays during a take is kept: every video or audio element heard (in the page or a same-origin frame) lands in `meta.media[]` with the footage stretches it was heard, its file is fetched with the page's cookies into the take's `page-sound/`, and the plan places one audio clip per stretch at its output time with `source: "page"`, which a re-plan replaces.
- 96fab94: The recorder starts a take once the first page has stopped changing (after load, 800 ms with no DOM change, at most 8 s) instead of waiting for network idle, which a page holding a socket open never reaches (`ready: "dom"`, the default); `ready: "networkidle"` in actions.json or `--ready networkidle` keeps the old wait, and the done event reports `ready: { mode, ms, capped }`.
- 96fab94: Every recorder step is bounded by its own timeout (an `expect`'s or an `await`'s, or a gesture's planned time plus 30 s): a page that stops answering ends the step as a skip with the real time it took, `--strict` stops the take there, `--json` reports a `step` event as each step starts and ends, and a rehearsal no longer warns of dead time it cannot have.

### Patch Changes

- 501054b: The encoder draws every frame at its own size and refuses, in words, a take whose frames changed size mid-take, instead of stretching them onto the first frame's size.
- 96fab94: A fresh plan exports at the resolution the footage holds: a 1280×720 take opens on 720p instead of a 1080p that `vos validate` then warns upscales.
- 501054b: The recorder fits the browser window to the viewport before the camera rolls, so a take on headless Chrome records the whole viewport instead of losing the bottom 87 px.
- Updated dependencies [96fab94]
- Updated dependencies [cd42672]
- Updated dependencies [753af27]
- Updated dependencies [96fab94]
- Updated dependencies [81f0fbd]
- Updated dependencies [cd42672]
  - @vosjs/studio-core@0.44.0

## 0.7.0

### Minor Changes

- 934e890: The recorder takes four new kinds of step: `expect` checks the page on camera, `await` waits off camera so the footage runs straight across a slow result, `download` keeps a file the page makes, and `"guard": "spend"` holds a step that costs something real until the recording names it; a click on a disabled control is reported, and `hostedRefusals` says what a hosted recorder cannot run.

### Patch Changes

- 23c755d: An exposure's selector names the element by what the page wrote for it (an id, a test id, an aria-label, a field's name or placeholder) before its classes, and never by a value that holds what the scan found.
- Updated dependencies [175fcd7]
- Updated dependencies [934e890]
  - @vosjs/studio-core@0.43.0

## 0.6.0

### Minor Changes

- ed34744: `buildEncodePage` takes `mediabunnyUrl`, and `coreAudioUrl(mirror)` names the bundled `@vosjs/core/audio` mixer on a host's module mirror (`<base>/@vosjs/core@<version>/audio.js`), esm.sh with none; `CORE_AUDIO_VERSION` is the pin, moved to 0.31.0.

### Patch Changes

- Updated dependencies [ed34744]
  - @vosjs/studio-core@0.42.3

## 0.5.3

### Patch Changes

- 837314c: `validateActions` and `validateSetup` refuse a script `url` or a setup `goto` on any scheme but http and https, in words (`urlSchemeProblem` is exported for a host that reads a URL of its own), so a `file:` or `javascript:` address never reaches the recorder's browser.

## 0.5.2

### Patch Changes

- 1f0a00e: The audio page's core pin follows @vosjs/core 0.30.1.

## 0.5.1

### Patch Changes

- 5e53e20: The audio build pin follows core to 0.30.0.
- Updated dependencies [5e53e20]
  - @vosjs/studio-core@0.42.2

## 0.5.0

### Minor Changes

- 90dd9f1: A take's `headers` ride the requests to the origin the take is of and no other (`headersFor`; a driver without request interception keeps the old whole-context headers and the recorder says so). The take keeps its page address without query or hash, the type step's log line counts characters instead of printing them, and the audio producer's baked plan is script-safe.

## 0.4.0

### Minor Changes

- 391cd2d: The take carries its payload. Every recorded step keeps the page it left (`meta.steps[].url`, origin and path, never a query or a hash), and a step with `read: "<selector>"` in `actions.json` keeps that element's words once the step has settled (`meta.steps[].text`, trimmed, at most 2 KB; on a click, what the click opened), so a layer quotes the take instead of a second run of the flow. `vos digest` lists the script's steps (`steps`: each with its source and output windows through the cut, the page it left and the words it kept), and `vos validate actions.json` holds `read` to a selector.
- 9b2d2d7: Three things a form needs from the recorder. `type` takes `replace: true` (the field's value is selected first, so what is typed replaces it: a form that opens filled in, a search box holding the last query) and `at: "end" | "start"` (the caret goes there after the focusing click, before the first character, so a code editor line is typed at its end). A `press` step presses one named key (`Escape`, `Enter`, `Tab`, `Backspace`, `Delete`, the arrows, `Home`, `End`, `PageUp`, `PageDown`, `Space`; never a character), recorded as a typing ping where the pointer is, or on `selector` with no click, so an Escape closes what a click opened and an Enter submits what was typed without a second click ringing on the field. `vos validate actions.json` holds all three, and `vos actions script` says them in words. And `read` on a field (an input, a textarea, a select) keeps its VALUE, what was typed, which its textContent never carried.

### Patch Changes

- Updated dependencies [3d476ab]
- Updated dependencies [5676482]
- Updated dependencies [391cd2d]
  - @vosjs/studio-core@0.42.0

## 0.3.28

### Patch Changes

- Updated dependencies [0dbbced]
  - @vosjs/studio-core@0.41.0

## 0.3.27

### Patch Changes

- c2d82b2: The audio page loads `@vosjs/core` 0.29.1's audio module.

## 0.3.26

### Patch Changes

- 7d16867: The audio page loads `@vosjs/core` 0.29.0's audio module.

## 0.3.25

### Patch Changes

- a8f9099: The audio page imports `@vosjs/core` 0.28.0's audio module, the core a host installs beside this release.

## 0.3.24

### Patch Changes

- Updated dependencies [04840e0]
  - @vosjs/studio-core@0.40.0

## 0.3.23

### Patch Changes

- b293dcf: The audio page imports `@vosjs/core` 0.27.2's audio module, the core a host installs beside this release.

## 0.3.22

### Patch Changes

- Updated dependencies [3f4c6f3]
  - @vosjs/studio-core@0.39.0

## 0.3.21

### Patch Changes

- Updated dependencies [0f45fcd]
  - @vosjs/studio-core@0.38.0

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
