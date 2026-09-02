# @vosso/vos-plugin

The vosso platform layer of the **vos CLI** — record a scripted browser flow into a **take**, plan zoom/cursor effects with the same planner the vosso studio uses, render a polished video headlessly, and sync your work with [vos.so](https://vos.so) (fetch, push, pull, login). Designed to be driven by AI agents (Claude Code, Codex) as well as humans. This package ships **no binary of its own**: every verb surfaces through the `vos` bin, whose MIT host ([`@vosjs/cli`](https://www.npmjs.com/package/@vosjs/cli)) delegates every non-engine verb here. (Previously published as `@vosso/cli` and, before that, `@vosso/voila-cli`; both names are deprecated on npm and still forward here, so older `vos` versions keep working.)

```bash
npm i -D @vosjs/cli @vosso/vos-plugin
```

Deterministic: the preview is the render, and every edit is a data patch to `doc.json`, never a re-record. Export is free at every resolution up to 4K, no watermark. MIT, like the engine: everything that runs on your machine is open source; vos.so, the hosted platform, is the product. Workflow skills for coding agents: `npx skills add vosjs/skills` (`launch-kit` ships the media with a release; `product-video` and `vos-cut` make and cut one video).

One CLI, two packages: [`@vosjs/cli`](https://www.npmjs.com/package/@vosjs/cli) (MIT, from the open source [vos engine repo](https://github.com/vosjs/vos)) owns the `vos` binary and the engine verbs (`render`/`still`/`info`/`preview`/`check` on configs — local, no account, no vos.so knowledge); this plugin adds everything else — the take pipeline **and every verb that talks to vos.so**. Both are [MIT](./LICENSE).

```bash
vos create --actions actions.json out.webm --strict     # one-shot: record + auto-plan + render
vos record --actions actions.json --out take --strict   # drive the page, synthesize the cursor track, encode + plan
# … the product ships a new version: re-record the SAME script, keep the cut …
vos record --actions actions.json --out take --strict   # footage replaced; the cut survives as doc.prev.json
vos plan take --reuse                          # re-time the previous cut onto the new recording (flags what could not follow)
vos digest take                                # SEE the recording before cutting: moments (clicks, typing, scrolls, idle, scenes) + footage frames + crops
# … edit take/doc.json (zoom spans, trims, speed, styling) — or let your agent …
vos frames take --at-zooms --at-moments        # PNG stills: contact sheet, every zoom apex, every moment (the agent's eyes)
vos render take check.webm --range 4..8 --draft # spot-check a doc edit in seconds (half res, low bitrate)
vos render take out.webm                       # deterministic polished render
vos frames take --frame 2.5 --size 1280x800    # exact-size still — posters, OG cards, store screenshots
vos deliver take --to cws,producthunt,og --release "v2.1"  # the release's assets per channel spec + verified kit.json
vos deliver take --to cws,og,linkedin --poster poster.json  # + the CARD half: covers composed by your poster program, this release's shot baked in
vos validate take/kit/kit.json                 # re-measure every kit asset from its bytes against the channel specs
vos brand https://your.app --out BRAND.md      # the brand kit, witnessed: /design.md, /llms.txt, then the page (palette, faces, marks, the avoid list)
vos open take                                  # hand the take to the studio — a human can drag every zoom span
vos push take --yes --note "first pass"        # host it: private vos + version history (recording uploads once)
vos pull take                                  # take the human's studio edits back: typed changelog + fresh doc.json
vos fetch <vosId> --media                      # a take you did not record: doc.json + the recording, ready for digest/frames/render
```

**Digest first.** `vos digest <take>` is how an agent sees a recording without reading the video: it writes `digest/digest.json` (one MOMENT per thing the cursor track says mattered: click clusters, typing sessions, scroll runs, dwells, idle gaps, head, tail and frame-diff scene changes, each with source + output extents, a normalized `focus`/`rect` you can copy into a zoom span, per-second `activity`, and the planners' `proposed` span ids) plus one FOOTAGE frame and a crop around the target per moment and `sheet.png`, the contact sheet. Read the JSON, then the sheet, then a crop only where you must decide; `--full`/`--crop` set the image long edges (the token budget; the done event estimates it). `--transcript` merges Whisper-shaped segments as `said`; `--style` reports a reference doc's style fields. **A series shares its look by data**: `vos plan <take> --style <seed doc.json|vosId>` copies the seed's `zoomStyle`/`zoomParams`/`speedParams`/`tiltStyle`/`frame`/`cursor`/`cam`/`export` onto a new take (never its spans, overlays or audio) and re-plans the auto spans under them, so the folder's `CUT.md` says only what a number cannot. `vos validate` then warns when a zoom does not contain what was clicked under it, and `vos frames --at-moments` renders the composed output at every moment so a still and its footage crop share an id.

## Platform verbs — the vos.so loop

All vos.so traffic lives in this package, behind one client: one origin (`VOS_ORIGIN`, default `https://vos.so`), one credential ladder (`--key` → `VOS_API_KEY` → `~/.config/vos/credentials`, written by `vos login`; a `vos_rg_` remix grant is just a key), one tracking file (`vos.json` beside the artifact; the legacy `push.json`/`meta.json` still read). Credentials are never printed. Keys can never publish — pushes are **private**; humans publish on vos.so.

```bash
vos login                                      # browser sign-in: prints a code + vos.so/cli/auth URL, a human
                                               # approves, the key stores itself (works headless; --key skips it)
vos fetch bright-loop                          # a program: writes config.json + vos.json (public needs no auth)
vos check bright-loop/config.json              # full local validation (engine verb — lives in @vosjs/cli)
vos push bright-loop/config.json               # create a PRIVATE vos (lineage from vos.json / --remix-of)
vos push bright-loop/config.json --vos <id>    # add a version against your tracked base
vos push bright-loop/config.json --claimable   # NO credential: a 72h claim link instead (programs only)
vos pull bright-loop                           # what changed on vos.so; syncs config.json (backup kept)
vos duplicate <vosId>                          # a private sibling of your OWN vos (someone else's is remixed: fetch + push --remix-of)
```

`push` is polymorphic by a deterministic sniff, never a flag: a take **directory** (a `doc.json` carrying `source`) pushes recording + doc through the take pipeline; a `config.json` (or a directory holding one) pushes the program, and a `doc.json` beside it that carries `program` (a program document: overlays, objects, audio, speed, tween edits, its own length; `program.config` omitted on disk) rides along, lint-gated. `fetch`/`pull` write a program document back the same way (config.json from the document's own config, doc.json without it). Both paths share the same base tracking and the same two 409 shapes: `stale_base` replays the platform's typed changelog (run `vos pull`, re-apply, push again); `protected_conflict` lists human-edited nodes — keep their values, or re-push with `--override <id>` ONLY when the user asked for that exact change. The first push of a take asks before uploading (`--yes` for headless): agents never upload unprompted. Every push should carry `--label` (what changed, one line) and `--note` (why: the user's ask) — the version history reads as a conversation, and an unlabelled push is a turn the human cannot read.

`--claimable` is the credential-free rung, programs only: no key is resolved, no `vos.json` is written, and the response is a claim URL (72h; unclaimed work is deleted — deliberate cleanup, not data loss). Hand the link to the user and **nowhere else** — it is the only reference and the only credential. Claiming moves the vos into the user's library; iteration after claim rides their key (`vos push --vos <id>`). Limits: config ≤200KB, 5 pushes per day per network.

## The take directory

```
take/
  recording.webm   encoded footage (CFR WebM)
  frames/          raw screencast JPEGs (kept for re-encode)
  cursor.json      synthesized CursorTrack (exact coords, element rects)
  meta.json        RecordingMeta (producer: "cli")
  actions.json     the script that produced it — the replay recipe
  doc.json         ProjectDoc — the agent-editable surface
  vos.json         hosted tracking (vos id + base version), written by push/pull
```

`doc.json` is the product's superpower: zoom/pan is `zoom: [{in, out, level, cx, cy, source}]`, trims are `segments`, pacing is `speed` — all plain JSON. Edit and re-render; nothing re-runs the browser. `plan` honors the wand contract: `source:"manual"` spans are preserved, only `source:"auto"` suggestions regenerate.

Contracts that bite: time is **SOURCE seconds** everywhere in `zoom`/`segments`/`speed`; zoom `cx`/`cy` are **normalized [0..1] video-frame fractions** (0.5, 0.5 = center), never pixels; `level` is 1..5. The full shape ships as a JSON Schema at [`schema/doc.schema.json`](./schema/doc.schema.json) (a `oneOf`: the recording document and the program document, sharing the layer definitions), and `vos validate <dir>` lints the semantics of either (span overlap, footage bounds, coord ranges, export honesty) before you spend a render.

The package also ships [`schema/channel-specs.json`](./schema/channel-specs.json): per-channel launch-asset specs (store screenshots, social cuts, README loops — dimensions, byte and duration ceilings). `vos deliver <take> --to <channels>` loops them in one pass — stills at each spec's exact pixels, video cuts, every artifact verified (misses land in `skipped[]` with the reason) — and writes `kit.json`, the manifest the `launch-kit` agent skill at [github.com/vosjs/skills](https://github.com/vosjs/skills) builds the rest of the release around.

## Actions

```json
{
  "url": "https://your-app.example",
  "viewport": { "width": 1280, "height": 720 },
  "steps": [
    { "do": "wait", "ms": 700 },
    { "do": "hover", "selector": "a[href='/pricing']", "ms": 700 },
    { "do": "click", "selector": "#signup" },
    {
      "do": "type",
      "selector": "input[name=email]",
      "text": "demo@example.com"
    },
    { "do": "scroll", "dy": 400 },
    { "do": "move", "x": 640, "y": 320 }
  ]
}
```

Verbs: `wait` · `hover` · `click` · `type` · `scroll` · `move` · `drag` (press-move-release — slide a range input, drag a canvas element, move a timeline clip). Because the CLI issues every input itself, the cursor track is synthesized — exact coordinates, exact timing, fresh element rects — which is what powers element-aware auto-zoom and click effects downstream. `vos validate` checks a script (or a take) without running anything.

## CI: the release loop on every tag

Everything above is headless, so a tag push can produce the release's media. Keep the source in the repo (`media/actions.json` + the signed-off `media/doc.json` + `media/vos.json` tracking + `LAUNCH.md`), then on each tag: `vos record --actions media/actions.json --out /tmp/take --strict --json` → `vos plan /tmp/take --reuse --from media/doc.json --json` (the committed cut re-times onto the new footage; the flagged list in the job log is the release's real to-do) → `vos deliver /tmp/take --to <channels> --release "$TAG" --json` → `vos push /tmp/take --label "$TAG launch" --yes --json` with `VOS_API_KEY` as a repository secret. The full workflow YAML lives on the docs page: [vos.so/docs/guides/every-release](https://vos.so/docs/guides/every-release). GitHub's `ubuntu-latest` ships Google Chrome, which mp4 renders need; a stale-base push fails with the shelf's changelog rather than resolving a human race silently. Cloud render jobs (`POST /api/render/jobs`) take a `callbackUrl` POSTed the job JSON once at completed/failed — a doorbell, not the truth (poll the job for that).

## For scripts and agents

Logs on stderr, results on stdout; `--json` = NDJSON events ending with `{"event":"done",…}`; exit codes 0/1/2/3 (3 = no browser). Requires a Chromium-family browser (system Chrome is used automatically; `npx playwright install chromium` or `VOS_BROWSER_PATH` otherwise) and network access (render pages load three/mediabunny from the CDN).

Pass `--strict` to `record` (agents: always): a skipped selector or a page that never reaches networkidle exits 2 and lists `skipped[]` in the done event — the default is lenient (exit 0, `skipped[]` still reported) for exploratory runs.

`record` and `create` take `--max-duration <seconds>` (default `1800`, the hosted 30 min cap): the capture stops there and the done event says so (`capped: true`, the remaining steps did not run); with `--strict` that exits 2. `vos push` refuses a take over 30 min (413), so cut the flow rather than raising the cap.

`create` is the one-shot verb — record, auto-plan, and render in one command and one browser session. The take dir still lands on disk, so the full quality loop (frames → edit `doc.json` → re-render) remains open afterwards. With `--strict` an incomplete recording aborts BEFORE the render (exit 2, nothing spent on a broken flow). It accepts the render flags (`--width/--height/--fps/--format/--parallel/--draft/--frame/--background/--set`); there is no `--range` (a fresh take renders whole).

**Audio**: `doc.audio` clips (music/SFX; `key` may name a file inside the take dir, e.g. `"/music.mp3"`) are mixed with gain/fade/loop envelopes and muxed into full renders — Opus for webm, AAC (Opus fallback) for mp4. Audio forces single-flight (`--parallel` is ignored with a note); a `--range` render keeps its audio (the full-timeline mix is sliced to the range window).

**Background**: `doc.frame.backgroundMedia` puts a vos animation (or a still image) behind the recording card — `{ "kind": "video", "key": "https://assets.vos.so/backgrounds/ember-drift-1080p.webm", "duration": 10, "dim": 0.2 }`. `key` is a media URL or a take-dir file (`"/bg.webm"`); a video needs `duration` (the loop length — time is OUTPUT-anchored modulo it, so trims/speed never retime the ambience), `dim` (0..1) is a black scrim for legibility. The hand-picked set is `GET https://vos.so/api/backdrops` (no auth): write `key` from `urls["1080p"]`, `duration` from the row and `frame.background` from its `ground`; `--background <slug>` on `render`/`frames` does exactly that. Drawn under the card, outside the zoom transform; fail-open (the CSS `frame.background` still shows if it can't load). Take-dir video backgrounds seek via the server's Range support. Depth dials: `frame.parallax` 0..1 (the media counter-pans with the zoom — 0.6 reads well) and `frame.backgroundMedia.blur` in design px.

**Tilt-forward camera styles**: `doc.zoomStyle: "keynote" | "drift"` bundle zoom AND lean into one camera sentence — `keynote` (the launch-film register: gliding session zooms + a medium lean toward each zoom's focus, tilt ramps matched to the zoom ramps) and `drift` (calm ambient depth: slow fluid zooms + a subtle lean over 1.6s ramps, long chains). In the studio, picking one stamps `tiltStyle` and plans the auto tilt spans; in doc.json set `tiltStyle` + `tilt` spans yourself — the style still shapes tilt motion at render.

**Tilt moments** (tilt spans): `doc.tilt` — SOURCE-anchored, non-overlapping regions where the 3D card leans to a pose and returns to rest: `[{ "id": "u0", "in": 4, "out": 8, "rx": 6, "ry": -9, "source": "manual" }]`. `rx`/`ry` are DEGREES (±45 hard; ±5..18 reads premium): `+rx` brings the TOP edge toward the camera, `+ry` the LEFT edge — lean toward a right-side focus with NEGATIVE `ry`. Rest is FLAT (there is no static card pose). Ramps ~0.9s in / ~0.8s out; spans ≤ ~1.35s apart swing pose-to-pose. `doc.tiltStyle` (`"off"|"subtle"|"medium"|"strong"`) records the Dynamic-tilt wand intensity — the studio derives `source:"auto"` spans from the zoom spans (lean toward each zoom's focus); spans you add or edit should carry `source:"manual"` so a re-plan never touches them. Tilt is punctuation: one pose change per ~5s beat, paired with zoom moments.

**Text overlays** (compositor v2 V1): `doc.overlays` — screen-space text clips ABOVE the card, outside the zoom transform, **OUTPUT-anchored** (trims/speed never retime a title). `{ "id": "t0", "kind": "text", "start": 1, "duration": 3, "text": "Ship it", "preset": "title", "transform": { "x": 0.5, "y": 0.82, "scale": 1, "rotation": 0 }, "enter": "rise", "exit": "fade" }`. Presets: `title` (Lexend 600 · 64px) / `caption` (Lexend 400 · 32px) / `label` (JetBrains Mono · 22px), overridable with `size` (12–200 design px) and `color`; `\n` in `text` breaks lines. **`transform.x/y` are FRACTIONS of the frame [0..1]** — the zoom `cx/cy` convention: `0.5/0.5` = center at ANY aspect ratio, lower-third y ≈ `0.82`; positions survive aspect switches. NOT pixels (validate errors on pixel-looking values, warns off-frame). Enter/exit: `rise` / `fade` / `none` over ~0.35s. Fonts load from the CDN at render start (fail-open to system stacks). Quick check without editing doc.json: `vos frames take --set 'overlays=[…]'`.

**Image/video overlays** (compositor v2 V1b): media kinds on the same `doc.overlays` lane — `{ "id": "m0", "kind": "image"|"video", "start": 2, "duration": 4, "key": "/logo.png", "width": 0.35, "radius": 12, "opacity": 1, "loop": false, "transform": { "x": 0.5, "y": 0.5, "scale": 1, "rotation": 0 } }`. `key` rides the same plumbing as every media key (take-dir file, URL); `width` is a FRACTION of the frame width (height follows the media's aspect, × `transform.scale`); corners in design px (default 12, drawn as a shadowed media card). Video time is CLIP-LOCAL (t − start), muted by design — soundtracks belong to `doc.audio`; `loop: true` loops, else the last frame holds. Same enter/exit transitions as text.

**3D props** (compositor v2 V3): `doc.objects` — world-space props between the card and the overlays. `{ "id": "p0", "asset": { "kind": "primitive", "shape": "knot", "color": "#ffb03a" }, "span": { "start": 1, "duration": 3 }, "transform3d": { "x": 0.8, "y": 0.28, "z": 0.5, "rx": 0, "ry": 40, "rz": 0, "scale": 0.18 }, "animation": "spin" }`. Shapes: `cube | sphere | torus | knot` (curated, fleet-safe). `x/y` are FRACTIONS of the frame; `z` = world units toward the camera from the card plane (0 = on it, 0.5 floats clearly in front — props can overhang the card); `scale` = fraction of the frame height; `animation`: `spin | float` (deterministic). `span` gates visibility with soft fades; absent = whole timeline. `kind: "gltf"` + `key` loads a real GLB (URL or take-dir file like `"/model.glb"`), bbox-NORMALIZED so `scale` means the same as primitives; loads fail-open (a bad model just doesn't render).

**Doc overrides on `render` / `frames`** — check any presentation from the CLI without hand-editing `doc.json` (the disk file is untouched; the patched doc is **lint-gated**, so a bad override fails exactly like a bad `doc.json`). This is deliberate: vos is both producer and consumer, so _verifying_ a doc field and _offering_ it as a feature are the same act — reach for a flag, not a bespoke harness.

- `--set <path>=<value>` (repeatable) — patch any doc field. The value is JSON when it parses (numbers, booleans, `null`, objects, arrays), else a string. Array indices work: `--set zoom[0].level=3`. Examples: `--set tilt[0].rx=8`, `--set frame.padding=120`, `--set frame.browserBar.kind=mac-light`, `--set 'frame.backgroundMedia={"kind":"video","key":"…","duration":10,"dim":0.2}'`.
- `--frame <kind>` (**render** only — `frames --frame <t>` is the still time selector; set the frame kind on `frames` via `--set frame.browserBar.kind=…`): `macos | mac-dark | windows | windows-dark | minimal | none`.
- `--background <url>` — a background media layer; kind inferred from the URL (`.webm`/`.mp4` → video at a 10s loop, image otherwise); `none` clears it.

So `vos frames take --frame 2.0 --set frame.browserBar.kind=mac-light --set tilt[0].rx=8` previews a macOS-framed, tilted card as a still; `vos render take out.webm --frame macos --background soft-beams` renders it on a backdrop from the set.

**The human handoff**: `vos open <take>` serves the take dir (CORS-open, ephemeral port) and opens the studio at `?take=<server>` — `doc.json` hydrates directly, so the agent's zoom/trim/audio edits arrive intact and every span is draggable. Keeps serving until Ctrl-C (`--studio <url>` overrides the default `http://localhost:6060`; `--print` skips the browser launch). In the studio, agents also get a sanctioned scripting surface: `window.__vos` (`openTake / getDoc / edit / undo / redo / setSelection`) — edits go through the patch store, undoable like any user edit.

**Render-time expectations** (M-series laptop, 1080p output, measured): a 12.5s take ≈ 19s single-flight, ≈ 15s with `--parallel 4` — call it **~1.5× real-time at 1080p**, of which several seconds are fixed browser-launch + CDN module cost, so short takes are overhead-dominated and `--parallel` pays off mainly on takes ≳ 30s. 2K roughly doubles per-frame cost. Recording is always real-time (the take's duration) plus a few seconds of encode.
