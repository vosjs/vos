---
name: product-video
description: Record and produce the demo video of a website, app, or feature with the vos CLI — the agent scripts the click path (actions.json), the recording auto-plans zooms, and every editing decision is data in doc.json, so fixes are edits and re-renders, never re-recordings. Renders are deterministic; export is free up to 4K with no watermark. Use when asked to make a product video, demo video, screen recording of a URL or feature, or a marketing clip, including a product behind a login (the session ladder: mint one from the project's own test auth before asking anyone), or when a feature was verified in agent-browser and that walk should become a take. A whole release's video set (the launch demo and its social cuts) is the launch-kit skill, which records through this one.
license: MIT
---

# Product video (and the assets around it), end to end

You are producing a shippable product video from a live web page, with
the `vos` CLI.
Everything is data: you write a flow script, the CLI records and plans, you
tune JSON, you re-render. **Never re-record to fix pacing or zooms — edit
`doc.json` and render again.** Quality bar: `references/taste.md` — follow
its quality loop and judge stills multimodally.

## Setup

```bash
npm i -D @vosjs/cli
npx vos setup
```

One command, one package: `@vosjs/cli` is the open source (MIT) `vos`
binary with the engine verbs, the take pipeline used here (record / plan /
frames / render on screen recordings) and the vos.so platform verbs. (Until
0.9 the take pipeline shipped separately as `@vosso/vos-plugin`; a project
that still lists it can drop it.) `npx vos setup` (0.48 and later) readies
the machine: the skills into your directories, a browser found or
installed, one block in `AGENTS.md`, then `vos doctor`, which says in
words what is ready and what to do next (`--url <dev server>` checks the
product answers). On an older CLI, or to check by hand:

- **A Chromium**: system Chrome is found automatically; otherwise
  `npx playwright install chromium` or point `VOS_BROWSER_PATH` at one.
  Exit code 3 means no browser was found.
- **Network at render time**: the render page loads three/mediabunny from
  esm.sh. Recording also needs to reach the target URL. Fully offline
  sandboxes cannot render — say so instead of shipping nothing.

Conventions: logs → stderr, results → stdout; `--json` streams NDJSON ending
with `{"event":"done",…}`; exit codes 0 ok / 1 error / 2 usage or strict
failure / 3 no browser / 4 the recorder met a sign-in instead of the page
(a missing or expired SESSION, never a script bug: `references/sessions.md`).
`vos <verb> --help` prints that verb's flags (`@vosjs/cli` 0.41.1 and later).

## Step 0 — pick the destination (it decides everything)

| Destination | Viewport | Output | Extras |
|---|---|---|---|
| **Landing-page clip** (hero/section embed) | 2560×1440 (footage-native 2K) | webm → VP9 re-encode + poster | silent loop; see `references/destinations.md` |
| **Launch video** (PH, social, store promo) | 2560×1440 or 1280×720 | mp4 (`--format mp4`, needs system Chrome) | music bed via `doc.audio` |
| **Quick demo** (issue, PR, chat) | 1280×720 | webm, defaults | speed over polish; drafts acceptable here ONLY |

Per-channel dimensions and byte budgets: `references/destinations.md`.
A **how-to** (one flow in a product, from a door to its result, for a docs
page or a changelog) takes the quick demo's viewport or the launch video's,
and its own grammar: `references/how-to.md`.

## Pre-flight: six answers before the first take

A flow in somebody's product has consequences the footage does not show:
two rehearsals left two untitled drafts in a founder's projects and both
appeared in the recorded sidebar; a rehearsal that reaches "Generate"
spends a credit; a result that arrives twelve minutes later is a second
take without a plan for it. Answer these BEFORE `vos look`, the script or a
rehearsal. **Each answer either changes the script or is said to the
person before recording**; an answer that does neither was not an answer.

1. **The door.** Which way through the product does the video walk, and
   which others exist (a guided flow, a prompt box, an apps menu, a
   template)? A how-to walks ONE. When there are several, list them and
   confirm the door with the person before scripting; a door that works
   under automation beats a recommended one that does not, and hiding the
   automation from the site is never the answer (find another door, or
   hand the shot list to a person: `references/sessions.md`, rung 4).
2. **Whose account, face and work.** What the signed-in account shows ships
   in the video: its avatar, its name, its recent items, the titles of its
   other projects. A demo account is the answer; when the person records
   from their own, say what will show before the take. The rehearsal
   reports an address, a key or a card as EXPOSED (mask those), and the
   account's own name and its recent lists as NOTICES: those are the
   person's call. Say they will be on screen and offer the one-line `mask`;
   never mask a name by default, and a face is yours to notice and theirs
   to decide.
3. **What the flow CREATES.** Write the side-effect ledger: for each step,
   what it leaves in the product (a draft, a project, a message, a file, a
   row), remembering that `--dry-run` CLICKS, so every rehearsal creates
   them too. Say the ledger to the person before the first rehearsal when
   the product is a real account, and report it at the end so they can
   delete what was made. A product where creating is cheap (a sandbox, a
   seeded local instance) needs the ledger written, not asked.
   **Undo it in `teardown`** (`@vosjs/cli` 0.81 and later): the setup verbs,
   run off camera after every rehearsal and take, and when one stops
   early, so no rehearsal leaves a draft behind. When the video itself
   deletes on camera what it made (a key created, then revoked), the
   teardown is the net for a take that stopped before the delete: open it
   with a guard on what the take created (`@vosjs/cli` 0.83 and later),
   so a good take says `teardown: nothing to undo` instead of a failure.
   ```json
   "teardown": [
     { "do": "press", "key": "Escape" },
     { "do": "if", "selector": "[aria-label='Actions for CI deploy']" },
     { "do": "click", "selector": "[aria-label='Actions for CI deploy']" },
     { "do": "click", "selector": "role=menuitem[name='Revoke']" },
     { "do": "click", "selector": "role=alertdialog >> role=button[name='Revoke']" }
   ]
   ```
   A step that fails AFTER the guard is a real leftover: say it to the
   person. Read the account back before you report (a `vos session exec`
   script lists it) and say it holds what it held before.
4. **What it SPENDS.** A step that costs something real (a generation, a
   purchase, a message sent, a deploy) carries `"guard": "spend"` and an
   `id`. A rehearsal hovers it and never presses it; `vos record` refuses
   the take before a browser opens unless the command names the step
   (`--confirm <id>`), and the done event records that it was pressed.
   Name the spend to the person in words ("one generation") and get the
   yes before the record; the consent then lives in the file and the
   command line, where a reviewer can read it.
5. **Is the result async, and how long.** A product that finishes later (a
   render, a generation, a deploy) is ONE take with an `await` step: the
   capture stops, the page is polled off camera, the capture resumes when
   the predicate holds, and the cut carries the measured time
   (`{elapsed}` in the next caption; `references/how-to.md`). Wait for
   what only the NEW result has (a percentage that appears, then goes;
   never a title an older item shares), size `timeout` from what the
   product measured last time, and `download` the output into
   `take/outputs/` so the join can play it. On the hosted recorder the
   waits come out of the footage cap: say how long before choosing it.
6. **Does sound matter.** The recorder captures frames. Sound a page plays
   through a `<video>` or `<audio>` element is kept (`@vosjs/cli` 0.79 and
   later: each heard source lands in `meta.media` and the plan places a
   clip per interval); sound a page synthesizes with Web Audio is not
   heard, and a downloaded output's own sound rides as a clip through
   `vos join`. When the sound IS the point (a voice preview, a generated
   clip) and the product synthesizes it, say so before recording and plan
   the download; when it is not, say the video is silent and score it:
   `vos music pick <take>` ranks the library against THIS cut (its length,
   its captions and joins as the beats, its payoff, whether a voice plays)
   and prints the `vos score` line that places each pick, so run
   `vos score <take> --track best` (or the pick you prefer), name the
   runner-up in the version note, and ask the person to listen, because
   you cannot.

## The core loop (every destination)

1. **Explore the target page** with your own tools (fetch HTML / Playwright).
   Identify the 3–6 moments that tell ONE story. Collect STABLE selectors
   (`a[href='…']`, ids, roles — not nth-child chains).
   **Stage the content like a set**: the script must leave the product in
   the state a proud screenshot would show — labels typed, real-looking
   data, the feature mid-story. An empty canvas records fast and demos
   nothing, and no downstream composition rescues it.

   **Behind a login? Settle the session before the script.** A recorder
   with no session records the wall (the sign-in page, or the public page
   the site sends a stranger to) and the only symptom is a skipped
   selector. Walk the ladder in `references/sessions.md` top to bottom and
   stop at the first rung that holds: no wall (a demo mode, a local server
   with auth off) → MINT a session from the test auth the project already
   has (`playwright/.auth`, an `auth.setup.ts`, a seed script: look before
   you ask anyone anything) → sign in off camera with `setup` in
   `actions.json` (the password from `{ "env": "NAME" }`, never a literal) →
   the human signs in once (`vos session open <url> --name <app>`, then
   `--session <app>` on record) → the human records with the extension from the shot list
   `vos actions script actions.json` prints, and you cut it. Every
   rung ends in `setup`, a state file for `--storage-state`, or a named
   session for `--session`. Never
   type or accept a production password, keep the state file out of the
   take directory and out of git, and record from a demo account: what the
   account shows ships in the video.

   **Never script a signed-in page blind.** `vos look <url> --session <app>`
   (or `--storage-state`; `@vosjs/cli` 0.78 and later) opens the page
   through the door the recorder will use and prints a screenshot plus
   every control in view with ONE proposed selector each, counted UNIQUE
   or AMBIGUOUS by the recorder's own engine; `--click <selector>` shows
   what a click opens before the script relies on it, and refuses a control
   whose words mean spend, delete or submit. Take UNIQUE selectors into
   steps as they are. Then the side-effect ledger (pre-flight, 3), then
   rehearse.

   **Past what `look` reaches, script inside the session.** A state no
   step reaches yet, what the account holds, a check after a flow: write
   an ES module and run `vos session exec <app> script.mjs --url <page>`
   (`@vosjs/cli` 0.81 and later). Its default export gets
   `{ context, page, url, name }` on the profile exactly as `record` opens
   it, and what it returns is printed. **Never open the session's profile
   yourself** (Playwright's `launchPersistentContext`, a bundled Chromium, a
   keychain flag): a browser that cannot read the profile's cookies starts
   them over, the session is signed out for good, and the person signs in
   again. Run one verb at a time on a session; two at once lock the profile.

   **Verified the feature with agent-browser already?** Keep that walk and
   skip the second script. agent-browser's `--json` result does not say
   what ran (`scroll` answers `{scrolled:true}`), so wrap each call so the
   command rides beside its result, then convert:
   ```bash
   ab() { agent-browser "$@" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);process.stdout.write(JSON.stringify({command:process.argv.slice(1),...r})+"\n")})' -- "$@" >> steps.jsonl; }
   ab open https://target.example; ab snapshot -i -u; ab click @e27
   ab wait 800; ab snapshot -i          # the page changed: refs renumbered
   ab fill @e2 query; ab press Enter
   vos actions from-agent-browser steps.jsonl --out actions.json
   ```
   (a whole path run as one `agent-browser batch … --json > steps.jsonl`
   already has that shape). The log is `steps.jsonl` in the directory you
   stand in, so walk from one directory. Refs resolve through the last
   `snapshot -i` before them, and they RENUMBER after a navigation and
   again inside a dialog: re-snapshot after anything that changes the page
   and read the refs before you name one (`-u` gives links their href).
   Click the control, do not press its shortcut: ⌘K opens the dialog for a
   human, but a keystroke is the one step the recorder cannot replay.
   Whatever it cannot follow (a shortcut key, a drag, a second `open`) is
   NAMED in the output, never dropped: read the notes, write those steps by
   hand, then record.

2. **Write `actions.json`**:
   ```json
   {
     "url": "https://target.example",
     "viewport": { "width": 1280, "height": 720 },
     "steps": [
       { "do": "wait", "ms": 800 },
       { "do": "hover", "selector": "a[href='/pricing']", "ms": 700 },
       { "do": "click", "selector": "#cta" },
       { "do": "wait", "ms": 1500 },
       { "do": "scroll", "dy": 400 },
       { "do": "move", "x": 640, "y": 320 },
       { "do": "wait", "ms": 900 }
     ]
   }
   ```
   Verbs: `wait` `hover` `click` `type` `scroll` `move` `drag`
   (`type` = `{do:'type', selector, text, delayMs?, ms?, focus?}`: it clicks
   the field, then types `text`; `focus:false` types into what is already
   focused, for a submitting Enter)
   (drag = real edits: `{do:'drag', selector|x,y, tx, ty, ms}` — slide a range
   input, drag a canvas element, move a timeline clip). Pacing IS the zoom
   plan: open `wait ≥700ms`; hover what matters 700–900ms (dwells become
   zooms); a click's `ms` is READING time, held from the page's last change
   (`@vosjs/cli` 0.47 and later; the recorder pays the settle itself), so
   size it as a beat: about 1000ms after a navigation, 600ms after a
   control, never padded for a slow page; end settled. Route the cursor away
   from hover-triggered menus (taste.md, flow rules). Check with
   `vos validate actions.json`.

   **Mark where the camera goes** (`@vosjs/cli` 0.80 and later). A step
   with a `caption` starts a beat; put the caption on the step whose action
   it describes. Mark each beat's PAYOFF `"zoom": true`: the moment the
   viewer should see up close (the drag whose result is the point, the
   click that opens the thing, the typing that names it). Mark a gesture
   that must stay wide `"zoom": false`. Give every marked step an `id`.
   Then `vos plan take --zooms per-beat` keeps exactly the marked zooms
   and rejects the rest for good; the planner still picks level and
   focus. Why marks: no rule inferred from a script matched a person's
   zoom choices (the best got 3 of 5); marks reproduced all 5 and nothing
   else.

   **Check the app's own state** after any step that sets up the scene (a
   document loaded, a count of items): `{ "do": "expect", "js":
   "window.app.count()", "equals": 14 }`. A take can pass `--strict` with
   the product in the wrong state (loaded twice, a duplicate on screen),
   because the DOM says nothing about what a canvas app holds; with
   `equals` a miss says what the app had. Read state only, never change
   it. A collaboration product wants a second person on the page: `peers`
   in `actions.json` (https://vos.so/llms-full.txt).

   Then REHEARSE it (`@vosjs/cli` 0.39 and later):
   `vos record --actions actions.json --out take --dry-run`. Every step runs
   against the real page, in order, because a later selector usually exists
   only after an earlier click, but nothing is captured and nothing is
   written: a missed selector is named in seconds (exit 2) instead of after
   a real-time take and its encode, and a take already in `--out` keeps its
   footage and its cut. It prints each step's rect in capture px, which is
   what a pinned layer reads. Rehearse again after every script edit, and
   record only a script that passes. A signed-in product rehearses the same
   way: `--storage-state` and `--browser-arg=` apply to it too, and the
   rehearsal ends by listing what the frame EXPOSES (an address, a key, a
   card). Hide those with `mask` before you record:
   `references/sessions.md`.

3. **Record**: `vos record --actions actions.json --out take --strict --json`
   `--strict` always: a skipped selector, a failed `expect`, a click on a
   disabled control, a timed-out `await` or a capped take → exit 2 with
   `skipped[]` in the done event (a first load that never goes network-idle
   is a note, not a failure, since `@vosjs/cli` 0.78). A skip means the
   flow is broken — fix it, never ship around it. A guarded step records
   only with `--confirm <id>` (pre-flight, 4). The take auto-encodes and
   auto-plans.
   **Recording again into a take you already cut** (a fixed step, a longer
   hold, the product changed): add `--reuse` (`@vosjs/cli` 0.81 and later).
   The new footage replaces the old and your cut (zooms, captions, layers,
   cover, sound) is re-timed onto it in the same command; the last line
   names what it kept and what could not follow. Without it the take is
   planned fresh and the cut waits in `doc.prev.json`.
   (`vos create --actions actions.json out.webm --strict` is the one-shot
   record+render verb — fine for a quick first pass, but THIS skill's loop
   reviews frames before rendering, so prefer the separate verbs here.)

4. **Tune `doc.json`** (JSON Schema ships in the `@vosjs/cli` npm package:
   `schema/doc.schema.json`):
   - `zoom`: `[{in, out, level, cx, cy, source}]`, SOURCE seconds; levels
     1.4–2.8; `cx/cy` NORMALIZED [0..1] (0.5,0.5 = center) — NOT pixels; set
     `"source": "manual"` on spans you touch (survives re-plan).
   - `segments` (trims) · `speed` (`rate` 0.1–16) · `frame.*` · `cursor`.
   - `tilt`: `[{in, out, rx, ry, source}]`, SOURCE seconds — the 3D card
     leans to the pose while active, returns to rest between. DEGREES
     (±5..18 reads premium): +rx = top edge closer, +ry = left edge closer
     (lean toward a right-side focus = negative `ry`). Spans ≥ 0.8s;
     pair with zoom moments (same in/out chains the moves), one pose change
     per ~5s beat. `"source": "manual"` on spans you touch;
     `tiltStyle: "subtle"|"medium"|"strong"` records the auto wand.
   - `frame.backgroundMedia`: a video loop / image behind the card —
     `{"kind":"video","key":"/bg.webm","duration":10,"dim":0.2}`.
     `key` = a file dropped in the take dir (`"/bg.webm"`) or a media URL;
     video needs `duration` (OUTPUT-anchored modulo loop); `dim` 0..1 scrim.
     Ambience, not a subject — dim it behind dense UI.
   - `audio`: OUTPUT-anchored clips; `key` may be a file dropped into the
     take dir (`"/music.mp3"`) or a library track; gain/fades/loop. Muxed
     on full renders (Opus/AAC); `--range` stays silent; forces
     single-flight. A library bed is picked by `vos music pick`, never by
     a mood alone: the library knows each track's beat, intro, seam,
     ending and vocals, and the ranking refuses what cannot cover the
     cut, starts in a quiet intro, or sings under a voice.
   - export: `{"resolution": "720p|1080p|2k|4k", "fps": 30}` — never above
     the footage (validate warns).
   Then `vos validate take --json` — lints must pass.
   Several takes in one film, a cold open, an end card: the `vos-cut`
   skill, "Assemble".

5. **Look before you render** (the taste.md quality loop):
   - `vos frames take --at-zooms --times 0,25%,50%,75%,100% --json` → judge
     every still against taste.md, zoom apexes hardest.
   - Iterate: edit doc.json → `vos render take check.webm --range a..b --draft`
     (seconds, half res — never ship drafts) → re-frame the changed region.
   - **Trying a presentation? Use a flag, not a scratch script.** `render`/`frames`
     take doc overrides — `--set <path>=<value>` (repeatable; JSON-or-string),
     `--frame <macos|windows|minimal|none>` (render), `--background <url>` — that
     patch the doc in memory (doc.json untouched) and are lint-gated. So
     `vos frames take --frame 2.0 --set frame.browserBar.kind=mac-light --set tilt[0].rx=8`
     previews a framed, tilted card without touching the file.

6. **Final render**: `vos render take out.webm --json` (or `--format mp4`).
   Re-frame the final (`frames --at-zooms`) against taste.md before declaring
   done. Renders are deterministic — only your edits change the output.

6b. **Human review round** (when the ask involves one): `vos open take`
   serves the take into the studio — your doc.json edits arrive intact and
   every zoom span is draggable.

6c. **Pushing it to vos.so** (`vos push take`)? Set `still` in `doc.json`
   (OUTPUT seconds) to the payoff BEFORE the first push, the result the
   video is about, never the opening: without one the cover is derived near
   the start, usually a zoom on a navigation control or an empty field
   under the first caption, and moving it after costs a second version.
   `vos plan take --still <t>` writes it and `vos frames take --at-still`
   shows it: look before the push. The push writes
   `take/vos.json`: its `vosId` is the link (`https://vos.so/vos/<vosId>`).
   Read the link there, never from filtered logs or a lookup script.

7. **Package for the destination**: `references/destinations.md`.

## Launch kit (one take → every cut of a release)

The `launch-kit` skill owns this destination: it establishes the release,
plans the cut's motion, delivers every video channel against
`channel-specs.json` (the main demo, the X feed cut, the vertical cut, the
README loop), verifies each cut, writes the `kit.json` manifest and pushes
labelled for the release. The recording it cuts is this skill's. Follow it
when the ask is a release, not one video.

## Gotchas

- A WebGL-heavy page (a shader background, a 3D canvas) paints BLACK under
  headless Chromium's software GL, and the recording has no way to say so:
  the take looks right except for a dead canvas. Record such pages with
  `VOS_BROWSER_PATH` pointing at system Chrome (a real GPU), and check the
  digest's sheet for the canvas before cutting.
- Render time ≈ 1.5× real-time at 1080p (a 12.5s take ≈ 19s; ~5s fixed
  startup); `--parallel N` pays off on takes ≳30s (ignored when audio rides);
  2K ≈ 2× per-frame cost. Recording is always real-time.
- Footage resolution = viewport size — decide 2K at RECORD time, from the
  DESTINATION's specs (a 720p take cannot honestly fill a 1080p video
  spec). Coordinate steps (`x`/`y`/`drag`) are VIEWPORT pixels: a viewport
  change means scaling every coordinate; selectors survive.
- `vos plan take` regenerates only `source:"auto"` spans; manual spans survive.
- Take dirs: `frames/` is a deletable encode intermediate (~1GB at 2K);
  `recording.webm` is the re-render source — keep it.
- A take of a local app prints `localhost/…` in the browser bar. Set
  `frame.browserBar.url` to the real address, or `frame.browserBar.showUrl`
  to `false`, in `doc.json`; it is data, so no re-record.
- Started the app yourself to record it? Stop THAT process, by the PID you
  saved or by its port (`lsof -ti :3000 -sTCP:LISTEN | xargs kill`). Never
  `pkill -f "node server.js"` or any kill by pattern: it takes down every
  matching process on the machine, the maker's other work included.
- A take that opens on the wrong page, with its first selector skipped,
  is usually a missing or expired session, not a broken script: re-walk
  `references/sessions.md` before touching `actions.json`.
- More failure modes: `references/troubleshooting.md`.


## Avoid (the traps that shipped)

- A zoom that opens before the click it frames: `validate` names it ("points
  beside what was clicked"); start the span after the click, or aim at it.
- A focus point in pixels: `cx`/`cy` are fractions of the frame.
- A `type` verb's field click as a zoom target: the field's centre is empty;
  frame the text, and open the span after the click.
- Routing the cursor through a hover-triggered menu between beats.
- A first frame or a last frame that cannot stand alone as a poster.
- A push with no `still`: the shelf, the watch page and the share card
  show a frame near the start instead of the result.
- A frozen opening: a static landing page records as freeze-then-bang;
  trim it or speed it, the story opens near the money shot.
- A sign-in in `steps`: every step there is in the footage and a typed
  value is logged. It goes in `setup`, with the password from the shell
  (`references/sessions.md`).
- A real customer's account on screen: addresses, names and keys ship in
  the video. Record from a demo or seeded account, read the rehearsal's
  `EXPOSED` list, and `mask` what is left.
- A `mask` with `as: "text"` over product copy or a number: that is no
  longer a recording of the product.
- Picking zooms by hand from a long proposal list (a canvas take proposes
  one per gesture): mark the payoff steps and plan `--zooms per-beat`.
- Trusting `--strict` for the scene: it proves the steps ran, not that the
  app holds what the beat shows. Check with `expect` + `js` + `equals`.
- Trusting a zoom because the track lists it: two of a film's four zooms
  never rendered and the list said they did. `frames --at-zooms` renders
  each apex beside its zoom-off twin and names an apex that matches its
  twin; read the stills, never the list.
- A rehearsal that presses a step that spends: `--dry-run` CLICKS. A
  spending step carries `"guard": "spend"` and an `id`, so the rehearsal
  hovers it and `record` refuses it without `--confirm <id>`; a step that
  only creates goes in the side-effect ledger before the first rehearsal.
- Scripting a signed-in product blind: `vos look` first, then the ledger,
  then the rehearsal. Guessing selectors from a public page costs a take
  per guess.
- Opening a session's profile with your own Playwright: it signed a
  founder's session out minutes after `vos look` had used it. Script
  inside it with `vos session exec`.
- Recording again into a cut take without `--reuse`: the fresh plan takes
  the cut's place.
- A teardown that undoes an on-camera delete with no `if` in front of its
  undoing: every good take reports `TEARDOWN FAILED`, and a person learns
  to ignore the line that one day is true.
- Cutting a caption's `duration` because the plan said it outlasts its
  step: the words then cannot be read. Shorten the words, or give the step
  more `ms` and record again.
