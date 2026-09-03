# @vosjs/cli

> The `vos` binary. Render vos configs to video and stills, record the real product from a scripted browser flow, plan zooms and pacing from the cursor track, cut as data, deliver a release's media per channel spec, and sync with vos.so. One package, every verb, MIT.

[![npm](https://img.shields.io/npm/v/@vosjs/cli)](https://www.npmjs.com/package/@vosjs/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/vosjs/vos/blob/main/LICENSE)

Part of [vos](https://github.com/vosjs/vos), the open programmatic video engine behind [vos.so](https://vos.so). Designed to be driven by coding agents (Claude Code, Codex, Cursor) as well as by hand: logs on stderr, results on stdout, `--json` everywhere, and every editing decision in a JSON file.

```bash
npm i -g @vosjs/cli          # or: npm i -D @vosjs/cli && npx vos …
vos render animation.json out.webm
```

Deterministic: the preview is the render, and every edit is a data patch to `doc.json`, never a re-record. Rendering is local and free at every resolution up to 4K, no watermark. The workflow skills for agents install with `npx skills add vosjs/skills` (`product-video` records and cuts one video, `vos-cut` cuts an existing recording, `launch-kit` ships the media with a release).

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

Node 18 or newer and a Chromium-family browser. A system Chrome is used when present; otherwise `npx playwright install chromium` once, or set `VOS_BROWSER_PATH`. mp4 output needs Chrome (Chromium ships no AVC encoder). Render pages load `three`, `gsap` and mediabunny from a CDN, so rendering needs network access.

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

Configs can be local files or URLs; a platform `{ "config": … }` envelope is unwrapped. Rendering compiles the config with `@vosjs/core`, wraps it in the engine's capture template, and encodes frame by frame (WebCodecs) in headless Chromium. Same input, same video: locally, in CI, or on a server. `vos render` tells a take from a config by a deterministic sniff, never a flag: a directory holding `doc.json` is a take.

## The take pipeline

A **take** is a directory: the recording of a scripted browser flow, its exact cursor track, and `doc.json`, the editable cut.

```bash
vos create --actions actions.json out.webm --strict     # one shot: record, auto-plan, render
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

| Verb     | Flags                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `record` | `--actions <file>` (or positional) `--url` `--out take` `--strict` `--max-duration <s>` `--background <slug\|url\|none>`                                                                                                         |
| `create` | The `record` flags plus the render flags (`--width` `--height` `--fps` `--format` `--parallel` `--draft` `--frame` `--set`), no `--range`. With `--strict` an incomplete recording exits 2 before anything is rendered           |
| `plan`   | `--fresh` (discard the current plan) `--reuse` `--from <doc.json>` (defaults to `<take>/doc.prev.json`) `--style <doc.json\|take\|vosId>` `--background`                                                                         |
| `digest` | `--out <take>/digest` `--full 960` `--crop 640` (image long edges, the token budget) `--no-frames` `--transcript <file>` (Whisper-shaped segments merged as `said`) `--style <ref>` (report a reference document's style fields) |
| `frames` | `--times 0,25%,50%,75%,100%` (the default selector, output seconds or percent) `--frame <t>` `--at-zooms` `--at-moments` `--size WxH` `--out <take>/stills` `--background` `--set …`; writes `stills.json`                       |
| `render` | `--width` `--height` `--fps` `--format webm\|mp4` `--parallel N` (1..16 sessions) `--range a..b` (output seconds; keeps its audio) `--draft` `--frame <kind>` `--background` `--set …`; `out` defaults to `<take>/out.<format>`  |
| `open`   | `--studio http://localhost:6060` `--print` (print the URL, do not launch a browser)                                                                                                                                              |

**Digest first.** `vos digest <take>` is how an agent sees a recording without reading the video. It writes `digest/digest.json`: one moment per thing the cursor track says mattered (click clusters, typing sessions, scroll runs, dwells, idle gaps, head, tail, and frame-diff scene changes), each with source and output extents, a normalized `focus` and `rect` you can copy into a zoom span, per-second `activity`, and the planners' `proposed` span ids; plus one footage frame and a crop around the target per moment, and `sheet.png`, the contact sheet. Read the JSON, then the sheet, then a crop only where you must decide. `vos validate` then warns when a zoom does not contain what was clicked under it, and `vos frames --at-moments` renders the composed output at every moment so a still and its footage crop share an id.

**A series shares its look by data.** `vos plan <take> --style <seed doc.json | vosId>` copies the seed's `zoomStyle`, `zoomParams`, `speedParams`, `tiltStyle`, `frame`, `cursor`, `cam` and `export` onto a new take (never its spans, overlays or audio) and re-plans the automatic spans under them.

**A fresh take opens on a backdrop.** `create`, `record` and `plan` put the first ready loop from `GET /api/backdrops` behind the card (its ground colour as `frame.background`); `--background <slug|url|none>` overrides it, and offline the frame stays bare with a note.

**The human handoff.** `vos open <take>` serves the take directory (CORS-open, ephemeral port) and opens the studio at `?take=<server>`. `doc.json` hydrates directly, so an agent's edits arrive intact and every span is draggable; it keeps serving until Ctrl-C. Inside the studio, `window.__vos` (`openTake`, `getDoc`, `edit`, `undo`, `redo`, `setSelection`) is the sanctioned scripting surface; edits go through the patch store, undoable like any user edit.

**Render time** (measured on an M-series laptop, 1080p): about 1.5x real time single-flight, of which several seconds are fixed browser launch and CDN module cost, so short takes are overhead-dominated and `--parallel` pays off on takes past roughly 30 s. 2K roughly doubles per-frame cost. Recording is real time plus a few seconds of encode.

## The take directory

```
take/
  recording.webm   encoded footage (30 fps CFR WebM)
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

Seven verbs: `wait`, `hover` (`ms` 700), `click`, `type` (`delayMs` 40 per key; `focus: false` skips the focusing click, for a submitting Enter), `scroll`, `move`, `drag` (press, move, release: a range input, a canvas element, a timeline clip). Every step takes an optional unique `id`; give steps ids so a span anchored to a step survives script edits and `vos plan --reuse` can follow it. Because the CLI issues every input itself, the cursor track is synthesized with exact coordinates, exact timing and fresh element rects, which is what powers element-aware auto-zoom and click effects downstream. The schema is [`schema/actions.schema.json`](./schema/actions.schema.json); `vos validate actions.json` checks a script without running anything.

Verified the flow in agent-browser already? `vos actions from-agent-browser steps.jsonl [--out actions.json] [--url] [--viewport WxH]` writes the script from that walk (each command kept beside its `--json` result, the batch record shape; refs resolve through the last `snapshot -i`), and names every step the recorder cannot follow rather than dropping it.

## doc.json

`doc.json` is a `ProjectDoc` from [`@vosjs/studio-core`](../studio-core), all plain JSON. Zoom is `zoom: [{ id, in, out, level, cx, cy, source }]`, trims are `segments`, pacing is `speed`. Edit and re-render; nothing re-runs the browser. The full shape ships as a JSON Schema at [`schema/doc.schema.json`](./schema/doc.schema.json) (a `oneOf`: the recording document and the program document, sharing the layer definitions), and `vos validate <dir>` lints the semantics of either (span overlap, footage bounds, coordinate ranges, export honesty) before you spend a render.

**Contracts that bite.** Time is source seconds in `zoom`, `segments`, `speed` and `tilt`, and output seconds in `overlays` and `audio`. Zoom `cx`/`cy` and overlay `transform.x`/`y` are normalized fractions of the frame in `[0, 1]` (`0.5, 0.5` is the centre), never pixels. `level` is 1..5. The planners write `source: "auto"`; spans you add or edit carry `source: "manual"`, which a re-plan never touches, and a deleted automatic span is recorded in `doc.rejected` so a re-plan does not bring it back.

**Camera styles.** `doc.zoomStyle` is one of `glide` (default), `focus`, `cinema`, `snappy`, `cut`, `keynote` (gliding zooms plus a medium lean toward each focus, the launch-film register), `drift` (slow ambient zooms with a subtle lean) or `none`. In the studio, picking a style also stamps `tiltStyle` and plans the tilt spans; in `doc.json` set `tiltStyle` and `tilt` yourself.

**Tilt.** `doc.tilt`: source-anchored, non-overlapping spans where the card leans to a pose and returns to rest: `[{ "id": "u0", "in": 4, "out": 8, "rx": 6, "ry": -9, "source": "manual" }]`. `rx`/`ry` are degrees (±45 hard limit; ±5..18 reads well); `+rx` brings the top edge toward the camera, `+ry` the left edge, so a lean toward a right-side focus is a negative `ry`. Rest is flat. `doc.tiltStyle` (`off`, `subtle`, `medium`, `strong`) is the intensity the planner derives automatic spans from.

**Text overlays.** `doc.overlays`: screen-space clips above the card, outside the zoom, output-anchored. `{ "id": "t0", "kind": "text", "start": 1, "duration": 3, "text": "Ship it", "preset": "title", "transform": { "x": 0.5, "y": 0.82, "scale": 1, "rotation": 0 }, "enter": "rise", "exit": "fade" }`. Presets `title`, `caption`, `label`, overridable with `size` (12..200 design px) and `color`; `\n` breaks lines; a lower third sits at `y` ≈ 0.82. Enter and exit: `rise`, `fade`, `none`. Fonts load at render start, fail-open to system stacks.

**Image and video overlays.** Media kinds on the same lane: `{ "id": "m0", "kind": "image" | "video", "start": 2, "duration": 4, "key": "/logo.png", "width": 0.35, "radius": 12, "opacity": 1, "loop": false, "transform": { … } }`. `key` is a file inside the take directory (`"/logo.png"`) or a URL; `width` is a fraction of the frame width, height follows the media's aspect; corners in design px. Video time is clip-local and muted by design; soundtracks belong to `doc.audio`.

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
vos deliver take --to cws,og,linkedin --poster poster.json     # the card half: covers composed by your poster program with this release's shot baked in
vos validate take/kit/kit.json                                 # re-measure every asset from its bytes against the channel specs
vos brand https://your.app --out BRAND.md                      # the brand kit, witnessed: /design.md, /llms.txt, then the page
```

[`schema/channel-specs.json`](./schema/channel-specs.json) holds per-channel launch-asset specs: dimensions, byte and duration ceilings, and a genre per image destination (`screenshot` is the real page from the take, full bleed; `card` is a composed cover). Channels: `cws`, `producthunt` (`ph`), `x`, `linkedin` (`li`), `og`, `github` (`gh`), `youtube` (`yt`), `shorts-linkedin` (`shorts`), or `all`. `vos deliver <take> --to <channels>` loops them in one pass and writes `kit.json`, the manifest the `launch-kit` skill builds the rest of the release around; an asset that misses its spec lands in `skipped[]` with the reason, and the verb exits 1 when nothing was produced. Flags: `--release <tag>`, `--out <take>/kit`, `--times`, `--range`, `--parallel`, `--poster <config.json|vosId>`, `--shot-time <t>` (the take moment baked into the poster), `--poster-time <t>` (the poster's own clock), `--composed` (keep the cut's camera and chrome on screenshot stills instead of the full-bleed page), `--set`, `--background`. `vos validate` reads a kit back from its bytes (a `.png` that is WebP, a lying size or duration, a set under its count, a byte ceiling).

`vos brand <url>` reads the site's `/design.md` first (the convention beside `/llms.txt`), then `/llms.txt`, then witnesses one page, and writes `BRAND.md`: the palette, faces, marks and the avoid list, with the provenance of every value, so a brand is resolved before any asset is authored.

## The vos.so loop

Everything that runs on your machine is open source; [vos.so](https://vos.so) is the hosted platform: a studio for the human half of an edit, version history with a typed changelog, a shelf of projects and recipes. All vos.so traffic lives behind one client: one origin (`VOS_ORIGIN`, default `https://vos.so`; `--origin` per call), one credential ladder (`--key`, then `VOS_API_KEY`, then `~/.config/vos/credentials`, written by `vos login`; a `vos_rg_` remix grant is just a key), one tracking file (`vos.json` beside the artifact). Credentials are never printed. Keys can never publish: pushes are private, and humans publish on vos.so.

```bash
vos login [--key <k>] [--label <name>] [--no-browser]   # browser sign-in: a code and a vos.so/cli/auth URL, a human approves, the key stores itself
vos fetch <vosId|url> [--out <slug>] [--media]         # a program writes config.json + vos.json; a take writes doc.json (+ the recording with --media)
vos check bright-loop/config.json                      # full local validation
vos push bright-loop/config.json                       # create a PRIVATE vos (lineage from vos.json or --remix-of)
vos push bright-loop/config.json --vos <id>            # add a version against your tracked base
vos push bright-loop/config.json --claimable           # no credential: a 72 h claim link instead (programs only)
vos push take --yes --label "first pass" --note "…"    # host a take: private vos + version history (the recording uploads once)
vos pull bright-loop                                   # what changed on vos.so; syncs config.json (backup kept); take dirs get a fresh doc.json
vos duplicate <vosId>                                  # a private sibling of your OWN vos (someone else's is remixed: fetch, then push --remix-of)
vos folder list | create <name> [--parent] [--desc] | move <ids…> --to <folder|none> | pull <ref> [--media]
vos asset push <file…> [--folder <slug>] | rename <id> <name.ext>
vos recipe push <FILE.md> --folder <slug> | --asset <id>   # the one recipe write: create, or replace in place
```

`push` is polymorphic by a deterministic sniff, never a flag: a take directory (a `doc.json` carrying `source`) pushes recording and document through the take pipeline; a `config.json` (or a directory holding one) pushes the program, and a `doc.json` beside it that carries `program` (a program document: overlays, objects, audio, speed, tween edits, its own length; `program.config` omitted on disk) rides along, lint-gated. `fetch` and `pull` write a program document back the same way. Program pushes take `--vos`, `--title`, `--slug`, `--desc`, `--tags`, `--folder`, `--remix-of`, `--base`, `--label`, `--note`, `--override <id>` (repeatable) and `--claimable`; take pushes take `--title`, `--label`, `--note`, `--folder`, `--override` and `--yes`.

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
- **Exit codes.** 0 ok, 1 error, 2 usage (including `--strict` failures), 3 no browser found.
- **`--strict`** on `record` and `create` (agents: always): a skipped selector, a page that never reaches network idle, or a take that hit `--max-duration` exits 2 and lists `skipped[]` (and `capped`) in the done event. The default is lenient (exit 0, `skipped[]` still reported) for exploratory runs.
- **`--max-duration <s>`** on `record` and `create` defaults to the hosted recording cap, read live from `GET /api/limits` (2 s, fail-open to 30 min when the origin is unreachable): the capture stops there and the done event says so. Cut the flow rather than raising the cap; the platform refuses a longer take.
- **`create`** is the one-shot verb: record, auto-plan and render in one command and one browser session. The take directory still lands on disk, so the full loop (frames, edit `doc.json`, re-render) stays open afterwards.
- **`vos validate <thing>`** takes an `actions.json`, a take directory, a program directory (`config.json`, plus its program document when present), or a `kit.json`; exit 1 on any problem.
- **Environment.** `VOS_ORIGIN`, `VOS_API_KEY`, `VOS_BROWSER_PATH`, `VOS_CLIENT` (the client string a push self-reports). `vos voila <verb>` is still accepted as an alias of `vos <verb>` and says so.

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
