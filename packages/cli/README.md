# @vosjs/cli

> The `vos` binary. Render vos configs to video and stills, record the real product from a scripted browser flow, plan zooms and pacing from the cursor track, cut as data, deliver a release's media per channel spec, and sync with vos.so. One package, every verb, MIT.

[![npm](https://img.shields.io/npm/v/@vosjs/cli)](https://www.npmjs.com/package/@vosjs/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so). Designed to be driven by coding agents (Claude Code, Codex, Cursor) as well as by hand: logs on stderr, results on stdout, `--json` everywhere, and every editing decision in a JSON file.

```bash
npm i -D @vosjs/cli          # into the repo; npx vos … from there (or npm i -g for a shell)
npx vos setup                # the skills into your agent, a browser, one rules block, then doctor
npx vos render animation.json out.webm
```

Deterministic: the preview is the render, and every edit is a data patch to `doc.json`, never a re-record. Rendering is local and free at every resolution up to 4K, no watermark. The workflow skills for agents install with `npx skills add vosjs/skills` (`product-video` records and cuts one video, `vos-cut` cuts an existing recording, `launch-kit` ships the media with a release); `vos setup` runs that for you, and falls back to the copy of the catalog this package ships when skills.sh cannot be reached. A coding agent gets the whole procedure from one line: `Read https://vos.so/agent.md and do what it says.`

Until 0.9 the take pipeline and the vos.so verbs shipped separately as `@vosso/vos-plugin`, and before that as `@vosso/cli` and `@vosso/voila-cli`; those names are deprecated on npm and forward here.

## Contents

- [Requirements](#requirements)
- [Engine verbs](#engine-verbs)
- [The take pipeline](#the-take-pipeline)
- [The take directory](#the-take-directory)
- [actions.json](#actionsjson)
- [doc.json](#docjson)
- [Overrides on render and frames](#overrides-on-render-and-frames)
- [Delivering a release](#delivering-a-release)
- [The vos.so loop](#the-vosso-loop)
- [CI](#ci)
- [For scripts and agents](#for-scripts-and-agents)
- [Programmatic use](#programmatic-use)

## Requirements

Node 18 or newer and a Chromium-family browser. A system Chrome is used when present; otherwise `npx playwright install chromium` once, or set `VOS_BROWSER_PATH`. mp4 output needs Chrome (Chromium ships no AVC encoder). Render pages load `three` and mediabunny from a CDN, so rendering needs network access.

```bash
vos setup [--agent claude,cursor,codex,copilot|all] [--global] [--no-skills] [--no-rules] [--no-browser] [--url <dev server>]
vos doctor [--url <dev server>]     # what is ready, in words; exit 3 when no browser
vos whoami                          # the key's name and the account it belongs to, never the key
vos logout                          # remove ~/.config/vos/credentials
```

`vos setup` detects the agents present by their directories (`.claude/`, `.cursor/`, `.codex/` or `.agents/`, `.github/copilot`; the home forms under `--global`), installs the skills into them through skills.sh (`npx skills add vosjs/skills -y`) or, when that cannot be reached, from the copy of the catalog this package ships (`skills/`), finds a browser in the recorder's own order or installs Chromium, writes one block between `<!-- vos:begin -->` and `<!-- vos:end -->` markers into `AGENTS.md` (or `CLAUDE.md` when only that exists), so a second run replaces its own text and never yours, and ends with `doctor`. These four verbs print NDJSON whenever stdout is not a TTY, and every `done` event carries `next_step`.

## Engine verbs

```bash
vos render  <config.json|url|take> [out]   # config → video (a take directory renders through the take pipeline)
vos still   <config.json|url> [out.webp]   # config → one frame, WebP
vos info    <config.json|url>              # inspect a config
vos check   <config.json|url>              # migrate → schema → syntax → compile → determinism and dialect lints, all local
vos preview <config.json|url> [--port N]   # serve a local playback page
vos versions                               # installed @vosjs/* versions
```

| Verb     | Flags and defaults                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `render` | `--width 1920` `--height 1080` `--fps 30` `--duration <config.duration>` `--format webm\|mp4` (webm); `out` defaults to `<name>.<format>` |
| `still`  | `--time 0` `--width 1280` `--height 720`; the output is always WebP (a `.png` name is refused)                                            |
| `check`  | Exits 1 on any error. Runs the same compiler a hosted push runs, so a clean check is a config that compiles anywhere                      |

Configs can be local files or URLs; a platform `{ "config": … }` envelope is unwrapped. Rendering compiles the config with `@vosjs/core`, wraps it in the engine's capture template, and encodes frame by frame (WebCodecs) in headless Chromium. Same input, same video: locally, in CI, or on a server. Every engine verb takes a directory too: a take (its `doc.json` is a recording document) renders through the take pipeline, and a program directory (`config.json`, composed with the program document beside it when there is one) renders as what the studio plays. A deterministic sniff of the document, never a flag.

## The take pipeline

A **take** is a directory: the recording of a scripted browser flow, its exact cursor track, and `doc.json`, the editable cut.

```bash
vos create --actions actions.json out.webm --strict     # one shot: record, auto-plan, render
vos record --actions actions.json --out take --dry-run  # rehearse the script first: which selectors resolve, their rects, in seconds
vos record --actions actions.json --out take --strict   # drive the page, record it with an exact cursor track, plan the cut
vos digest take                                         # SEE the recording before cutting: moments, frames, crops (an agent's eyes)
# … edit take/doc.json (zoom spans, trims, speed, overlays) by hand or by agent …
vos frames take --at-zooms --at-moments                 # PNG stills: contact sheet, every zoom apex, every moment
vos render take check.webm --range 4..8 --draft         # spot-check an edit in seconds (half res, low bitrate)
vos render take out.webm                                # the polished render
vos frames take --frame 2.5 --size 1280x800             # an exact-size still: posters, OG cards, store screenshots
vos open take                                           # hand the take to the studio; a human drags every span
```

When the product ships again, re-record the same script and keep the cut:

```bash
vos record --actions actions.json --out take --strict   # footage replaced; the previous cut survives as doc.prev.json
vos plan take --reuse                                   # re-time that cut onto the new recording; what could not follow is named
```

| Verb     | Flags                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record` | `--actions <file>` (or positional) `--url` `--out take` `--strict` `--dry-run` `--allow-wall` `--keep-frames` `--storage-state <file>` or `--session <name>` `--header name=value`... `--browser-arg=<switch>`... `--max-duration <s>` `--background <slug\|url\|none>`                                                                                                                                                                                                   |
| `create` | The `record` flags plus the render flags (`--width` `--height` `--fps` `--format` `--parallel` `--draft` `--frame` `--set`), no `--range`. With `--strict` an incomplete recording exits 2 before anything is rendered                                                                                                                                                                                                                                                    |
| `plan`   | `--fresh` (discard the current plan) `--reuse` `--from <doc.json>` (defaults to `<take>/doc.prev.json`) `--style <doc.json\|take\|vosId>` `--with <doc.json\|take\|vosId>[@end\|@start\|@step:<id>\|@<seconds>]` (a template, repeatable) `--background` `--motion` (re-propose the motion) `--headline` `--kicker` `--launch` `--brand` `--music` `--entrance` `--transitions slide\|fade\|scale\|none` `--end-card on\|none\|<ref>` `--captions` `--clicks` `--release` |
| `digest` | `--out <take>/digest` `--full 960` `--crop 640` (image long edges, the token budget) `--no-frames` `--transcript <file>` (Whisper-shaped segments merged as `said`) `--style <ref>` (report a reference document's style fields)                                                                                                                                                                                                                                          |
| `frames` | `--times 0,25%,50%,75%,100%` (the default selector, output seconds or percent) `--frame <t>` `--at-zooms` `--at-moments` `--size WxH` `--out <take>/stills` `--background` `--set …`; writes `stills.json`                                                                                                                                                                                                                                                                |
| `render` | `--width` `--height` `--fps` `--format webm\|mp4` `--parallel N` (1..16 sessions) `--range a..b` (output seconds; keeps its audio) `--draft` `--frame <kind>` `--background` `--set …`; `out` defaults to `<take>/out.<format>`                                                                                                                                                                                                                                           |
| `open`   | `--studio <url>` (the studio; `https://vos.so` by default, `VOS_ORIGIN` moves it) `--print` (print the URL, do not launch a browser)                                                                                                                                                                                                                                                                                                                                      |

**The wall check.** Once the first navigation settles, and before a frame is captured, `record`, `create` and `--dry-run` ask whether the recorder landed where it was sent. A take that met a sign-in instead is refused with exit 4 and a sentence (`asked for /dashboard, landed on /login: no session for app.acme.com`): the asked URL answered 401 or 403, the recorder was sent to an identity provider or a sign-in path, or the page is a sign-in form (one password field, or a one-time-code field) rendered in place. A redirect somewhere else with no sign-in in sight, which is what a site that shows strangers a public page looks like, is refused under `--strict` and in a rehearsal, and said as a warning otherwise. The check runs before a re-record clears anything, so a session that expired since the last take never costs the footage it failed to replace. The way past a wall is a session: `--storage-state <file>`, minted from the test auth the project already has wherever that exists. `--allow-wall` records the page anyway (a video OF a sign-in page is a legitimate take), and the take's `meta.wall` and its digest then say so.

**`vos session`: takeover mode, local.** A production app behind an emailed code, SSO, a passkey or a CAPTCHA has no form to script and no test auth to mint from, so a person signs in once and the recorder reuses that session:

```bash
vos session open https://app.acme.com --name acme   # a plain Chrome window opens; sign in, quit it (⌘Q on a Mac, closing the window is not quitting)
vos session check acme --url https://app.acme.com/dashboard   # does it still open the page? exit 0, or 4
vos record --actions actions.json --out take --session acme --strict
vos session list · vos session rm acme
```

`open` runs the SYSTEM Chrome as an ordinary child process on a profile under `~/.config/vos/sessions/<name>`, with no automation switch and no debugging pipe, so a sign-in that refuses automated browsers (Google's) goes through, and it waits for the window to EXIT, because Chrome writes its cookie store when it quits and not before. It then prints what the session holds as counts and dates (`holds cookies for app.acme.com (7), accounts.google.com (12); newest expires in 29 days`), never a value, and `--json` does not either. `check` reads the session through the same Chrome and, with `--url`, asks the wall check whether the page still opens signed in: a session that expired says so in words with the command to sign in again, and exits 4. `record --session` records in that profile; it is one door and `--storage-state` is the other, never both.

Measured before this was written: a profile plain Chrome signed in reopens signed in ONLY under the system Chrome with the real keychain. Playwright's bundled Chromium keeps its own keychain entry and can never decrypt Chrome's cookies, so every reader of a session here is the system Chrome (`VOS_BROWSER_PATH` overrides it) with Playwright's `--use-mock-keychain` removed. Two things `check` says because they cost real runs: an app whose session cookie has no expiry leaves nothing to reuse once the window closes, and a Chrome that was killed rather than quit never wrote its store.

A session never enters a take directory and never reaches vos.so: `vos push` refuses a take holding a storage-state-shaped JSON, naming the file.

**`setup`: the steps that run before the camera rolls.** A sign-in form, a cookie banner, the "choose your editor" modal, an onboarding tour: things a take must get past and must not show. `actions.json` takes `setup: [...]` beside `steps`, with the verbs `goto`, `click`, `type`, `press`, `wait`. They run after the first navigation and before a frame is captured, as plain actions with no cursor, no frames, no pace and nothing in `meta.steps`; then the recorder opens `url` again and the take begins where the setup left it. A `type` step's `text` may be `{ "env": "DEMO_PASSWORD" }`, read from the shell at run time and never logged or stored (the log names the field, never the value; a literal typed into a password field is refused by `validate`, because `actions.json` is committed and pushed with the take). A selector that never appears fails the take before anything is recorded (exit 2), because a take that begins at a half-finished sign-in is the wall by another name; rehearse the setup with `--dry-run` like everything else. This is rung 2 of the session ladder made scriptable: a local or self-hosted instance with a seeded user, no state file needed.

```json
"setup": [
  { "do": "goto", "url": "http://localhost:3000/login" },
  { "do": "type", "selector": "#email", "text": "demo@acme.test" },
  { "do": "type", "selector": "#password", "text": { "env": "DEMO_PASSWORD" } },
  { "do": "press", "key": "Enter", "ms": 800 }
]
```

**`vos actions script <actions.json>`: the flow as a shot list.** When no rung of the session ladder holds and a person has to record the take themselves (in their own signed-in browser, with the vosso extension), the agent hands over the flow it worked out rather than an apology: numbered beats in plain words with the holds the script asked for, the page to start on and about how long. A step's `caption` leads its beat, a `text=` or `:has-text()` selector is said as its words, and a step's `id` is said as a name (`new-order` reads as "new order"), so give steps ids and captions that a person could follow. `--json` carries the beats beside the text. The take comes back through the ordinary handoff, and the agent cuts it (`vos pull --media`, then the `vos-cut` skill).

**`--header name=value`**, repeatable: a request header on every request the recording browser makes, the way past a preview deployment protected by a bypass header alone (`--header x-vercel-protection-bypass=$TOKEN`). The rehearsal's `Next:` line carries it.

**What the frame shows.** Getting past a login puts the account's own data in the picture, and asking for a demo account does not hold that line: a person asked to sign in signs in as themselves. So the recorder looks. After the page opens and after every step it reads the text visible in the viewport and reports the KIND of thing it saw and where, never the string: an email address (one on `example.com` or a `.test`, `.example`, `.invalid` or `.localhost` domain is demo data and is not reported), something shaped like an API key or a JWT, a card number that passes the Luhn check, a masked card's visible tail. They land in `meta.exposures[]` (`step`, `kind`, `selector`, `rect`, `seen`), in the `record` and `create` done events, at the end of a rehearsal (before anything is recorded), as warnings in `vos validate <take>`, and in the digest's `take.exposures`. They warn; they do not fail a take, because a product may legitimately show addresses. The `selector` reaches that element and no other, so it can be pasted into a mask.

**`mask`** in `actions.json` hides a selector BEFORE the first frame is captured and keeps it hidden across navigations and re-renders, so the real value is never in a frame, never in the recording, never pushed:

```json
"mask": [
  { "selector": "nav > span", "as": "text", "text": "jane@acme.test" },
  { "selector": ".card-number" }
]
```

`as: "blur"` (the default) blurs the element; `as: "text"` swaps its words, which reads as a product where a blur reads as a redaction. Use `text` for IDENTIFIERS (an email, a name, an account id), never for product copy or numbers: the video stays true to the product. A form control is always blurred, since writing into an input would change what the app submits. A mask whose selector reached no element hid nothing, so it fails `--strict` and a rehearsal (exit 2) and is named; `meta.masks[]` records each mask's `hits`.

**Rehearse before you record.** `vos record … --dry-run` runs every step against the real page, in order, because a later selector usually exists only after an earlier click. Nothing is captured and nothing is written: the pointer lands instead of travelling, every pause is cut to a beat, and the take directory beside it keeps its footage, its cut and its script exactly as they were (a real re-record moves `doc.json` aside; a rehearsal does not). Selector lookups keep their whole timeout, so a miss here is a miss in the take. It prints each step with the rect it resolved, in capture px, which are the rects a pin or `vos callout --step` reads, and exits 2 on any miss or a first load that never settled. Add `--dry-run` to the exact command you were about to run; `--storage-state` and `--browser-arg=` apply to it too, and the `Next:` line it prints carries them, so the command it hands you records what it rehearsed.

**Digest first.** `vos digest <take>` is how an agent sees a recording without reading the video. It writes `digest/digest.json`: one moment per thing the cursor track says mattered (click clusters, typing sessions, scroll runs, dwells, idle gaps, head, tail, and frame-diff scene changes), each with source and output extents, a normalized `focus` and `rect` you can copy into a zoom span, per-second `activity`, and the planners' `proposed` span ids; plus one footage frame and a crop around the target per moment, and `sheet.png`, the contact sheet. Read the JSON, then the sheet, then a crop only where you must decide. `vos validate` then warns when a zoom does not contain what was clicked under it, and `vos frames --at-moments` renders the composed output at every moment so a still and its footage crop share an id.

**Many media in one take (concat).** `doc.json` may carry `media: [{ id, videoKey, cursor, meta, … }]`, the take's OTHER recordings or uploads, each the `source` shape with an `id`; a segment on one (`{ in, out, media: "m1" }`) plays it, and a zoom, tilt, speed, freeze or cam-move span names the media its source seconds belong to (absent = the primary, `source`). The Video row shows the clips in order, a span is drawn where its media plays, `vos plan` proposes zoom and speed spans on every media from its own cursor track, `vos validate` measures each span against its own media's length, and `vos push` and `vos pull --media` carry every media through the recording door. A media wears its OWN card: `media[].frame` carries the card-owned fields (its placement and size as `inset`, the browser bar, the corner, the shadow, the border, the cover fit and its focus) over the take's frame while it plays; the bar names that media's recorded page, an upload with no page wears none, and the frame-wide fields (the aspect, the padding, the ground, the backdrop, the card's animation) stay the take's. Sound: the primary's tracks play at the primary's moments; another media's own audio is not spliced into the cut yet. **Many cards**: an image or video overlay may show a document media by reference (`key: "media:<id>"`, `media:` alone the primary; its cursor track and recorded page come with it) and wear a card (`frame`: `browserBar`, a `lean` `{rx, ry}` in degrees, `shadow`, `shadowContact`, `shadowColor`, `cursor`), drawn by the card painter on its own plane above the primary card with the media's cursor dot and click rings inside it; a layer without `frame` stays the flat picture. The primary card stays primary: the sequence, the camera and the cut are its.

**A series shares its look by data.** `vos plan <take> --style <seed doc.json | vosId>` copies the seed's `zoomStyle`, `zoomParams`, `speedParams`, `tiltStyle`, `frame`, `cursor`, `cam` and `export` onto a new take (never its spans, overlays or audio) and re-plans the automatic spans under them. A seed that is a POSTER carries its layout too: its card placement, its `stage-*` clips by id (with the release's words from LAUNCH.md's `headline` and `kicker` roles, BRAND.md's `wordmark`, or `--headline` and `--kicker` patched in; the brand's mark from BRAND.md `logoUrl` fetched into `<take>/brand/` for `stage-mark`), its rest lean, its trailing freeze. What could not follow is said in words.

**The cut's motion is the document's, in one vocabulary.** Every visual thing carries `anim` (`enter`, `exit`, `idle`; a kind, or a step with its seconds and, for words, `unit`, `direction`, `stagger`): the card (`frame.anim`, entering by `tilt-in`, `pull-out`, `rise`, `fade` or `slide` and leaving by `recede` or `fade`), a text, image or video clip, a prop, and a FOOTAGE clip at its boundaries (`segments[].anim`: `exit` is how it leaves at the boundary after it, `enter` how it arrives at the one before, by `slide`, `fade` or `scale`; a slide names its `side`, a step its `seconds`, never longer than half the shorter clip). An exit and the next clip's enter at one boundary run together as a push: the incoming clip plays live while the outgoing, frozen on its last frame, moves away, the camera rests through the window, and one cursor dot crosses from the outgoing card's last point to the incoming's. A page change inside one recording is the same primitive: two clips of one media, the load between them cut. The output lasts until the last clip ends; the card is on screen exactly while its clip runs (the footage, freezes included) and leaves at its end, so its `exit` plays over the clip's last seconds like every clip's; past the footage the clips play over the ground alone. A FREEZE (`freeze: [{id, at, seconds}]`, a source moment held for output seconds, beside the speed spans on the retime lane) freezes the footage anywhere, the middle of the take included; a segment's older `hold` is read as a freeze at its end. **The frame that STANDS for a take** is `still` (output seconds; `vos plan --still <t>`, LAUNCH.md `still:`), else the take's own last freeze (a poster's rest; a template's freezes, stamped `from`, never count), else the hero moment after the card and the opening clips have entered: the shelf's cover, the kit's card stills and `vos frames --at-still` all read that one derivation, and a plan never moves a still the author set. There is no end-card field and no entrance field. A COMPONENT is a TEMPLATE: a plain take on a shelf whose clips carry stable ids, laid onto a take at an anchor and stamped `from` with where its clips came from. A fresh `vos plan` proposes the card's enter, the templates the recipe names (`LAUNCH.md` `with: <ref>[@end|@start|@step:<id>|@<seconds>], …` or `--with`, repeatable; `endCard: <ref>` names one at the end), the END CARD when `endCard` is on or absent: the official `End card` template on vos.so (the platform's `Templates` project, promoted; any official template resolves by its title, `--with "End card"`, `--style "Split cover, landscape"`), laid at the end with the release's words and BRAND.md's mark, stamped `from: endcard`; offline, the house clips stand in (a freeze of the last frame for the card's seconds, the card receding over it, the headline, the release line, the wordmark and the mark as clips over the freeze), a caption per `actions.json` step, a music bed and click sounds, a transition at every page change the recorder marked (`meta.steps[].navigated`: the outgoing clip ends on the frame before the change, the incoming begins once the page has settled; `transitions: slide|fade|scale|none`, slide by default), from LAUNCH.md's `entrance`, `transitions`, `endCard`, `with`, `captions`, `music` and `clicks` roles (or the flags), as data in doc.json with stable ids (`bed`, `click-<n>`, `caption-<step>`), so the studio shows what the kit will render; a refresh never re-proposes (a deleted clip stays deleted) and `--motion` re-proposes on purpose, replacing only its own work. A document written in the older spellings (`frame.entrance`, `endCard`, a clip's `enter`/`exit`/`fx`, a prop's `animation`) is read into the vocabulary and `vos validate` says so.

**A fresh take opens on a backdrop.** `create`, `record` and `plan` put the first ready loop from `GET /api/backdrops` behind the card (its ground colour as `frame.background`); `--background <slug|url|none>` overrides it, and offline the frame stays bare with a note.

**The human handoff.** `vos open <take>` serves the take directory (CORS-open, ephemeral port) and opens the studio at `?take=<server>`. `doc.json` hydrates directly, so an agent's edits arrive intact and every span is draggable; it keeps serving until Ctrl-C. Inside the studio, `window.__vos` (`openTake`, `getDoc`, `edit`, `undo`, `redo`, `setSelection`) is the sanctioned scripting surface; edits go through the patch store, undoable like any user edit.

**Render time** (measured on an M-series laptop, 1080p): about 1.5x real time single-flight, of which several seconds are fixed browser launch and CDN module cost, so short takes are overhead-dominated and `--parallel` pays off on takes past roughly 30 s. 2K roughly doubles per-frame cost. Recording is real time plus a few seconds of encode.

## The take directory

```
take/
  recording.webm   encoded footage (30 fps CFR WebM; `recording.mp4` when a
                   pull brought the footage home in that container)
  frames/          raw screencast JPEGs, indexed by frames.json (kept for re-encode)
  cursor.json      the synthesized CursorTrack: exact coordinates, element rects
  meta.json        RecordingMeta (producer: "cli", per-step source extents)
  actions.json     the script that produced it, with the resolved url
  doc.json         ProjectDoc, the editable cut
  doc.prev.json    the previous cut, kept by a re-record for `vos plan --reuse`
  vos.json         hosted tracking (vos id + base version), written by push, fetch and pull
  stills/          `vos frames` output + stills.json
  digest/          `vos digest` output: digest.json, <id>.full.png, <id>.crop.png, sheet.png
  kit/             `vos deliver` output: kit.json + the assets
  mic.webm, cam.webm   sidecar tracks, present on takes pulled from vos.so with --media
```

A take's own media is named after what it IS, not after a convention: a pull
reads the first bytes of each file it downloads and writes `recording.mp4` when
the footage is mp4, whatever the hosted asset was called or its Content-Type
claimed. Every verb resolves the name, and a push declares the container it
finds in the bytes, so a file never reaches vos.so under the wrong type.
`vos validate <take>` warns when an existing take holds one that does.

A re-record replaces the footage, the cursor track, the frames and everything derived from them, moves `doc.json` to `doc.prev.json`, and keeps `actions.json` and `vos.json`.

## actions.json

```json
{
  "url": "https://your-app.example",
  "viewport": { "width": 1280, "height": 720 },
  "steps": [
    { "do": "wait", "ms": 700 },
    { "do": "hover", "selector": "a[href='/pricing']", "ms": 700 },
    { "id": "signup", "do": "click", "selector": "#signup" },
    {
      "do": "type",
      "selector": "input[name=email]",
      "text": "demo@example.com"
    },
    { "do": "scroll", "dy": 400 },
    { "do": "move", "x": 640, "y": 320 },
    { "do": "drag", "selector": ".knob", "tx": 300, "ty": 0, "ms": 700 }
  ]
}
```

Seven verbs: `wait`, `hover` (`ms` 700, the dwell), `click` (`ms` the settle after the press, 150), `type` (`delayMs` 40 per key, paced by the clock; `focus: false` skips the focusing click, for a submitting Enter; `ms` the settle after, 150), `scroll` (`ms` the settle, 200), `move`, `drag` (press, move, release: a range input, a canvas element, a timeline clip; `ms` the travel, 700). The recorder's pace is the script's: a gesture is driven by the clock, so a page that answers each pointer sample slowly costs samples, never seconds, and the only pauses are the ones the script names (`wait`, a hover's dwell, a settle). `vos record` ends with a pace line, what the script asked, what the gestures added, what the page cost, and the steps that ran slow, and the `--json` done event carries it as `pace`. Every step takes an optional unique `id`; give steps ids so a span anchored to a step survives script edits and `vos plan --reuse` can follow it, and so a layer can name the element a step touched (`overlays[].pin.step`; the recorder keeps each hover, click, type and drag step's element rect on `meta.steps[].rect`). Because the CLI issues every input itself, the cursor track is synthesized with exact coordinates, exact timing and fresh element rects, which is what powers element-aware auto-zoom and click effects downstream. The schema is [`schema/actions.schema.json`](./schema/actions.schema.json); `vos validate actions.json` checks a script without running anything.

Verified the flow in agent-browser already? `vos actions from-agent-browser steps.jsonl [--out actions.json] [--url] [--viewport WxH]` writes the script from that walk (each command kept beside its `--json` result, the batch record shape; refs resolve through the last `snapshot -i`), and names every step the recorder cannot follow rather than dropping it.

## doc.json

`doc.json` is a `ProjectDoc` from [`@vosjs/studio-core`](../studio-core), all plain JSON. Zoom is `zoom: [{ id, in, out, level, cx, cy, source }]`, trims are `segments`, pacing is `speed`. Edit and re-render; nothing re-runs the browser. The full shape ships as a JSON Schema at [`schema/doc.schema.json`](./schema/doc.schema.json) (a `oneOf`: the recording document and the program document, sharing the layer definitions), and `vos validate <dir>` lints the semantics of either (span overlap, footage bounds, coordinate ranges, export honesty) before you spend a render.

**Contracts that bite.** Time is source seconds in `zoom`, `segments`, `speed` and `tilt`, and output seconds in `overlays` and `audio`. Zoom `cx`/`cy`, overlay `transform.x`/`y` and a pin's `rect` are normalized fractions of the frame in `[0, 1]` (`0.5, 0.5` is the centre), never pixels. `level` is 1..5. The planners write `source: "auto"`; spans you add or edit carry `source: "manual"`, which a re-plan never touches, and a deleted automatic span is recorded in `doc.rejected` so a re-plan does not bring it back.

**Camera styles.** `doc.zoomStyle` is one of `glide` (default: one steady zoom that travels between clicks), `focus` (a zoom per click, framed and released), `cinema` (slow moves and long holds), `snappy` (quick cycles), `cut` (instant zoom-ins) or `none`. Every style times the tilt track to its own zoom tempo, so a lean lands with its zoom; how far the card leans is `tiltStyle` (`off` | `subtle` | `medium` | `strong`), which the studio stamps when a style is picked and `doc.json` sets itself, with `tilt` spans. `keynote` and `drift` are retired names that still read: `glide` + `tiltStyle: medium` and `cinema` + `tiltStyle: subtle`.

**Tilt.** `doc.tilt`: source-anchored, non-overlapping spans where the card leans to a pose and returns to rest: `[{ "id": "u0", "in": 4, "out": 8, "rx": 6, "ry": -9, "source": "manual" }]`. `rx`/`ry` are degrees (±45 hard limit; ±5..18 reads well); `+rx` brings the top edge toward the camera, `+ry` the left edge, so a lean toward a right-side focus is a negative `ry`. Rest is flat. `doc.tiltStyle` (`off`, `subtle`, `medium`, `strong`) is the intensity the planner derives automatic spans from.

**Text overlays.** `doc.overlays`: screen-space clips above the card, outside the zoom, output-anchored. `{ "id": "t0", "kind": "text", "start": 1, "duration": 3, "text": "Ship it", "preset": "title", "transform": { "x": 0.5, "y": 0.82, "scale": 1, "rotation": 0 }, "enter": "rise", "exit": "fade" }`. Presets `title`, `caption`, `label`, overridable with `size` (12..200 design px) and `color`; `\n` breaks lines; a caption (a layer with no referent) is a lower third at `y` ≈ 0.82. Enter and exit: `rise`, `fade`, `none`. Fonts load at render start, fail-open to system stacks.

**Callouts in the grammar.** `vos callout <take> note --step copy --kicker "index.css" --title "Every token you tuned, as CSS variables." --mark ring` writes a callout in the house grammar (three shapes a viewer learns once: `note`, a kicker, a title and a line; `tag`, one label on the accent; `code`, the payload block) from the product's REGISTER: `BRAND.md` beside the take (`bgA` the ground, `accent`, `fontBody`; a kit whose accent is RESERVED, a recorder's red that marks time and nothing else, names a `callout` role and the notes speak in that hue instead) or `--ground #hex --accent #hex --font "…"`. The card inverts the app's value in the product's hue (a light app gets a dark card, a dark app a light one), keeps the accent for the kicker, sets its title at 1.35× the app's body AS SEEN ON SCREEN at the layer's start (the camera's level is read from the document; `--body-px <n>` instead sets the body size on the DELIVERED frame and is never rescaled, which is the flag a rich capture needs, since a 2560-wide take on a padded frame sits near scale 0.6 and lands every default on the grammar's floor; the verb prints the three sizes and the scale it measured), lifts on a real shadow and a hairline, rises in and fades out, opens a beat after the step's press lands and closes before the next scroll or navigation, and is pinned to the step (`--side`, `--mark`, `--leader`, `--color` refine the pin; `--color` paints the mark and the leader, never the kicker, which is the accent). `--at <s> --seconds <n>` places one without a step; `--print` prints the clip instead of writing it. `vos validate <take> --picture` renders the footage under every html layer at its start and reports the ΔE between the card's ground and what it covers: under 8 is a problem (the card reads as one more panel), under 16 a warning. An unpinned html or media layer whose window holds a step with an element gets the pin named in a warning.

**Pinned layers.** A layer ABOUT something on the page names it, and the lowering keeps the two together: `"pin": { "step": "copy", "side": "auto", "mark": "ring", "leader": true }` on any overlay kind places the layer a gap off one side of that step's element and carries it with the element as the camera moves (the layer keeps its screen size; only its place follows). One of `step` (a recorder step's `id`, else its index), `press` (SOURCE seconds; the nearest press names the element, for a human recording) or `rect` (video fractions) names the referent. `side` is `auto` (the first of right, left, below, above whose box fits inside the frame through the layer's life) or a side by name; `gap` is design px (24); `mark` is `ring` or `underline`, a standing highlight on the referent for the layer's life; `leader` draws a hairline from the layer to the referent; `color` is their ink. `transform.x/y` stay the fallback for a pin that cannot resolve, and `vos validate` says why (an unknown step, a step that touched nothing, a scroll inside the layer's window). A layer that cannot name its referent is a caption: place it in the margin, never over the app.

**Image and video overlays.** Media kinds on the same lane: `{ "id": "m0", "kind": "image" | "video", "start": 2, "duration": 4, "key": "/logo.png", "width": 0.35, "radius": 12, "opacity": 1, "loop": false, "transform": { … } }`. `key` is a file inside the take directory (`"/logo.png"`) or a URL; `width` is a fraction of the frame width, height follows the media's aspect; corners in design px. Video time is clip-local and muted by design; soundtracks belong to `doc.audio`.

**HTML layers.** A UI component authored as DOM on the same lane, sharp at any export size because it is rasterized from source, not magnified from the footage: `{ "id": "h0", "kind": "html", "start": 2, "duration": 4, "html": "<div class=\"card\">Open Code</div>", "css": ".card{font-family:'Inter';background:#0b0b0d;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.45)}", "box": { "width": 452, "height": 132 }, "transform": { … } }`. The markup is well-formed XML (`<br />`, `&amp;`, quoted attributes; `vos validate` refuses the rest in words, because a malformed layer decodes to nothing and says nothing). `box` is the design box in 1080p px; `width` defaults to the design size. The CSS is the chrome (shadow, radius, border; `bleed` is derived from the shadows, or stated), a `font-family` it names resolves against the hosted catalog at every `font-weight` it names (a face outside the catalog rides `fonts: [{ family, url }]`), and an image inside is inlined for you when its URL is on `https://assets.vos.so/` (`vos asset upload` puts it there; any other host paints blank, so inline it as a `data:` URI). A still layer's `animation` runs on the wall clock rather than the timeline, so animate the layer with `anim` and `motion`; a LIVE layer (`"live": true`) is re-rasterized per frame at clip-local time: its `@keyframes` are scrubbed to `t` (paused, delayed by `-t`; fold any `animation-delay` into the keyframes) and `{{t}}` / `{{data.<name>}}` placeholders in the markup and CSS fill from the clock and the clip's `data`, so a counter, a progress bar or a typed line come out on the timeline's clock in the preview and in every export chunk alike. It is never re-hosted and never an upload.

**3D props.** `doc.objects`: world-space props between the card and the overlays. `{ "id": "p0", "asset": { "kind": "primitive", "shape": "knot", "color": "#ffb03a" }, "span": { "start": 1, "duration": 3 }, "transform3d": { "x": 0.8, "y": 0.28, "z": 0.5, "rx": 0, "ry": 40, "rz": 0, "scale": 0.18 }, "animation": "spin" }`. Shapes `cube`, `sphere`, `torus`, `knot`; `kind: "gltf"` with `key` loads a GLB (bounding-box normalized so `scale` means the same for every model; a bad model fails open). `x`/`y` are frame fractions, `z` world units toward the camera from the card plane, `scale` a fraction of the frame height; `animation` is `spin` or `float`, deterministic.

**Audio.** `doc.audio` clips (music, effects, `key` a take-directory file or a URL) are mixed with gain, fade and loop envelopes and muxed into every full render: Opus for webm, AAC (Opus fallback) for mp4. Audio forces single-flight (`--parallel` is ignored with a note); a `--range` render keeps its audio.

**Background.** `doc.frame.backgroundMedia` puts a looping video or a still behind the card: `{ "kind": "video", "key": "<url or /file>", "duration": 10, "dim": 0.2 }`. Time is output-anchored modulo `duration`, so trims and speed never retime the ambience; `dim` is a black scrim for legibility; `frame.parallax` (0..1, 0.6 reads well) counter-pans it with the zoom and `backgroundMedia.blur` softens it in design px. The hand-picked set is `GET https://vos.so/api/backdrops` (no auth): copy `key` from a row's `urls["1080p"]`, `duration` from the row, and `frame.background` from its `ground`. Drawn under the card, outside the zoom, fail-open to the CSS `frame.background`.

## Overrides on render and frames

Check any presentation from the command line without hand-editing `doc.json`. The file on disk is untouched; the patched document is lint-gated, so a bad override fails exactly like a bad `doc.json`.

- `--set <path>=<value>` (repeatable) patches any field. The value is JSON when it parses (numbers, booleans, `null`, objects, arrays), else a string; array indices work: `--set zoom[0].level=3`, `--set frame.padding=120`, `--set 'frame.backgroundMedia={"kind":"video","key":"…","duration":10}'`.
- `--frame <kind>` on `render` sets the browser chrome: `macos` (`mac`, `mac-light`), `mac-dark`, `windows` (`windows-light`), `windows-dark`, `minimal`, `none` (`hidden`). On `frames`, `--frame <t>` is the still's time; set the chrome there with `--set frame.browserBar.kind=…`.
- `--background <slug|url|none>`: a slug is resolved against `GET /api/backdrops` (its 1080p loop and duration); a URL or take-directory path is used as is, an image extension meaning a still and anything else a video looping every 10 s; `none` clears it.

So `vos frames take --frame 2.0 --set frame.browserBar.kind=mac-light --set tilt[0].rx=8` previews a macOS-framed, tilted card as a still, and `vos render take out.webm --frame macos --background soft-beams` renders it on a loop from the set. Verifying a document field and offering it as a feature are the same act here: reach for a flag, not a bespoke harness.

## Delivering a release

```bash
vos deliver take --to cws,producthunt,og --release v2.1        # stills at each spec's pixels, video cuts, everything verified into kit.json
vos plan take/poster/landscape --style <poster vosId> --headline "Ship it"   # a poster is a take: copy a shelf poster's layout, type the words
vos validate take/kit/kit.json                                 # re-measure every asset from its bytes against the channel specs
vos brand https://your.app --out BRAND.md                      # the brand kit, witnessed: /design.md, /llms.txt, then the page
```

[`schema/channel-specs.json`](./schema/channel-specs.json) holds per-channel launch-asset specs: dimensions, byte and duration ceilings, and a genre per image destination (`screenshot` is the real page from the take, full bleed; `card` is a composed cover). Channels: `cws`, `producthunt` (`ph`), `x`, `linkedin` (`li`), `og`, `github` (`gh`), `youtube` (`yt`), `shorts-linkedin` (`shorts`), or `all`. `vos deliver <take> --to <channels>` loops them in one pass and writes `kit.json`, the manifest the `launch-kit` skill builds the rest of the release around; an asset that misses its spec lands in `skipped[]` with the reason, and the verb exits 1 when nothing was produced. Flags: `--release <tag>`, `--out <take>/kit`, `--times`, `--range`, `--parallel`, `--launch LAUNCH.md`, `--look`, `--brand`, `--composed` (keep the cut's camera and chrome on screenshot stills instead of the full-bleed page), `--set`, `--background`. `vos validate` reads a kit back from its bytes (a `.png` that is WebP, a lying size or duration, a set under its count, a byte ceiling).

**A poster is a document, and deliver renders it.** A card-genre destination (OG, LinkedIn, X, the YouTube thumbnail, the CWS tile and marquee, the GitHub social preview) renders from the poster document of its aspect class (`landscape`, `square`, `portrait`, `tile`), found beside the take as `poster/<class>/doc.json` (`poster/doc.json` serves every class) or named in LAUNCH.md (`poster: <path>`, `poster-<class>: <path>`, a path to a doc.json or to a pulled poster take), at the document's REST (where its last freeze begins, the composed frame before nothing moves). The poster is a plain take document: the card placed by `frame.inset`, leaned by the tilt track, the words and the mark as `stage-*` clips, a trailing freeze; an agent writes it with `vos plan --style <poster>` from a poster on a shelf, or by hand, and pushes it like any take. `kit.json` records `source: "poster"`, the class, the file, the vos it tracks, the shot rect and the text boxes read from the document. A class with no document is the take's own frame, said once. Deliver composes nothing; it applies each video destination's mechanics (the README loop drops the card's motion, every clip a template placed, the captions and the sound; a channel that autoplays muted drops the bed; the 9:16 cut reframes and follows the camera) and verifies.

`vos brand <url>` reads the site's `/design.md` first (the convention beside `/llms.txt`), then `/llms.txt`, then witnesses one page, and writes `BRAND.md`: the palette, faces, marks and the avoid list, with the provenance of every value, so a brand is resolved before any asset is authored.

## The vos.so loop

Everything that runs on your machine is open source; [vos.so](https://vos.so) is the hosted platform: a studio for the human half of an edit, version history with a typed changelog, a shelf of projects and recipes. All vos.so traffic lives behind one client: one origin (`VOS_ORIGIN`, default `https://vos.so`; `--origin` per call), one credential ladder (`--key`, then `VOS_API_KEY`, then `~/.config/vos/credentials`, written by `vos login`; a `vos_rg_` remix grant is just a key), one tracking file (`vos.json` beside the artifact). Credentials are never printed. Keys can never publish: pushes are private, and humans publish on vos.so.

```bash
vos login [--key <k>] [--label <name>] [--no-browser]   # browser sign-in: a code and a vos.so/cli/auth URL, a human approves, the key stores itself
vos fetch <vosId|url> [--out <slug>] [--media]         # a program writes config.json + vos.json; a take writes doc.json (+ the recording with --media)
vos check bright-loop/config.json                      # full local validation
vos push bright-loop/config.json                       # untracked: create a PRIVATE vos. Tracked (vos.json): add a version to it
vos push bright-loop/config.json --vos <id>            # add a version to a vos this directory does not track
vos push bright-loop/config.json --remix-of <id>       # create a SEPARATE vos from this config, with that lineage
vos push bright-loop/config.json --claimable           # no credential: a 72 h claim link instead (programs only)
vos push take --yes --label "first pass" --note "…"    # host a take: private vos + version history (the recording uploads once)
vos pull bright-loop [--since <versionId>] [--check]   # what changed on vos.so since your base; syncs config.json (backup kept), or doc.json for a take
                                                       # --check reports without writing; --since walks from a base you name
vos duplicate <vosId>                                  # a private sibling of your OWN vos (someone else's is remixed: fetch, then push --remix-of)
vos folder list | create <name> [--parent] [--desc] | move <ids…> --to <folder|none> | pull <ref> [--media]
vos asset push <file…> [--folder <slug>] | rename <id> <name.ext>
vos recipe push <FILE.md> --folder <slug> | --asset <id>   # the one recipe write: create, or replace in place
```

`push` is polymorphic by a deterministic sniff, never a flag: a take directory (a `doc.json` carrying `source`) pushes recording and document through the take pipeline; a `config.json` (or a directory holding one) pushes the program, and a `doc.json` beside it that carries `program` (a program document: overlays, objects, audio, speed, tween edits, its own length; `program.config` omitted on disk) rides along, lint-gated. `fetch` and `pull` write a program document back the same way. `pull` takes `--since <versionId>` (walk the changelog from that base instead of the tracked one) and `--check` (print what changed and stop: nothing on disk moves) on both paths. A program push LANDS where `vos.json` says: a directory that tracks a vos iterates it, so the fetch, edit, check, push, pull loop needs no flags, and making something separate from the same config is the explicit `--remix-of` door. Program pushes take `--vos`, `--title`, `--slug`, `--desc`, `--tags`, `--folder`, `--remix-of`, `--base`, `--label`, `--note`, `--override <id>` (repeatable) and `--claimable`; take pushes take `--title`, `--label`, `--note`, `--folder`, `--override` and `--yes`.

Both paths share the same base tracking and the same two 409 shapes. `stale_base` replays the platform's typed changelog: run `vos pull`, re-apply, push again. `protected_conflict` lists nodes a human edited in the studio: keep their values, or re-push with `--override <id>` only when the user asked for that exact change. The first push of a take asks before uploading (`--yes` for headless); agents never upload unprompted. The take's duration rides the upload, and the platform refuses a take over the hosted recording cap. Every push should carry `--label` (what changed, one line) and `--note` (why: the user's ask); the version history reads as a conversation, and an unlabelled push is a turn the human cannot read.

`--claimable` is the credential-free rung, programs only: no key is resolved, no `vos.json` is written, and the response is a claim URL (72 h; unclaimed work is deleted, which is deliberate cleanup). Hand the link to the user and nowhere else: it is the only reference and the only credential. Claiming moves the vos into the user's library, and iteration after claim rides their key (`vos push --vos <id>`). Limits are the platform's: config ≤ 200 KB, 5 pushes per day per network.

`vos folder pull <ref>` writes a folder's context package to disk (its recipes, the inherited ones, the exemplar programs and assets), which is what an agent reads to create in the owner's style. Recipes are `.md` files named in capitals (`CUT.md`, `BRAND.md`): the server uppercases an agent-filed name.

## CI

Everything above is headless, so a tag push can produce the release's media. Keep the source in the repo (`media/actions.json`, the signed-off `media/doc.json`, `media/vos.json`, `LAUNCH.md`), then on each tag:

```bash
vos record --actions media/actions.json --out /tmp/take --strict --json
vos plan /tmp/take --reuse --from media/doc.json --json     # the committed cut re-times onto the new footage; the flagged list is the release's to-do
vos deliver /tmp/take --to <channels> --release "$TAG" --json
vos push /tmp/take --label "$TAG launch" --yes --json       # VOS_API_KEY as a repository secret
```

[vosjs/action](https://github.com/vosjs/action) runs that loop as one step and keeps a comment on the pull request with the watch page and the kit; the hand-written workflow is on the docs page [vos.so/docs/guides/every-release](https://vos.so/docs/guides/every-release). GitHub's `ubuntu-latest` ships Google Chrome, which mp4 renders need. A stale-base push fails with the shelf's changelog rather than resolving a human race silently. Cloud render jobs (`POST /api/render/jobs`) take a `callbackUrl` that is POSTed the job JSON once at completed or failed: a doorbell, not the truth (poll the job for that).

## For scripts and agents

- **Output.** Logs on stderr, results on stdout. `--json` turns every verb into NDJSON events ending with `{"event":"done",…}`.
- **`vos <verb> --help`** prints that verb's usage lines and exits 0 (it used to be a usage error).
- **Exit codes.** 0 ok, 1 error, 2 usage (including `--strict` failures), 3 no browser found, 4 the recorder met a wall (a sign-in, or under `--strict` a redirect away from the asked page) and nothing was recorded or cleared. `--json` carries the verdict as a `wall` event (`kind`, `level`, `asked`, `landed`, `refused`).
- **`--strict`** on `record` and `create` (agents: always): a skipped selector, a page that never reaches network idle, or a take that hit `--max-duration` exits 2 and lists `skipped[]` (and `capped`) in the done event. The default is lenient (exit 0, `skipped[]` still reported) for exploratory runs.
- **`--max-duration <s>`** on `record` and `create` defaults to the hosted recording cap, read live from `GET /api/limits` (2 s, fail-open to 30 min when the origin is unreachable): the capture stops there and the done event says so. Cut the flow rather than raising the cap; the platform refuses a longer take.
- **`create`** is the one-shot verb: record, auto-plan and render in one command and one browser session. The take directory still lands on disk, so the full loop (frames, edit `doc.json`, re-render) stays open afterwards.
- **`vos validate <thing>`** takes an `actions.json`, a take directory, a program directory (`config.json`, plus its program document when present), or a `kit.json`; exit 1 on any problem.
- **Environment.** `VOS_ORIGIN` (the platform, and the studio `vos open` opens), `VOS_API_KEY`, `VOS_BROWSER_PATH`, `VOS_CLIENT` (the client string a push self-reports). `vos voila <verb>` is still accepted as an alias of `vos <verb>` and says so.

## Programmatic use

The same functions are available as a library:

```ts
import { launchBrowser, loadVosConfig, renderVideo } from '@vosjs/cli'

const browser = await launchBrowser()
const { config } = await loadVosConfig('animation.json')
const { bytes } = await renderVideo(browser, {
  config,
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 5,
  format: 'webm',
})
```

Also exported: `renderStill`, `previewPages`, `configDuration`, `BrowserUnavailableError`; the take pipeline (`recordTake`, `encodeRecording`, `planTake`, `digestTake`, `parseTranscript`, `renderTake`, `renderAnimation`, `pullMedia`, `loadTake`, `takePaths`, `startTakeServer`, `validateActions`, `convertAgentBrowser`, `parseAgentBrowserLog`); the vos.so client helpers (`resolveCredential`, `platformOrigin`, `parseVosId`, `readSyncState`, `writeSyncState`, `apiJson`, `apiError`); `manifest`, the verb list `vos help` prints; and `run(argv)`, which dispatches any take or platform verb.

## License

[MIT](https://github.com/vosjs/vos/blob/main/LICENSE) © vosso
