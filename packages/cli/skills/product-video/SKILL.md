---
name: product-video
description: Record and produce the demo video of a website, app, or feature with the vos CLI — the agent scripts the click path (actions.json), the recording auto-plans zooms, and every editing decision is data in doc.json, so fixes are edits and re-renders, never re-recordings. Renders are deterministic; export is free up to 4K with no watermark. Use when asked to make a product video, demo video, screen recording of a URL or feature, or a marketing clip, including a product behind a login (the session ladder: mint one from the project's own test auth before asking anyone), or when a feature was verified in agent-browser and that walk should become a take. A whole release's asset set (store listing, Product Hunt gallery, social cuts) is the launch-kit skill, which records through this one.
license: MIT
---

# Product video (and the assets around it), end to end

You are producing a shippable product asset — a polished video, a set of
exact-size stills, or both — from a live web page, with the `vos` CLI.
Everything is data: you write a flow script, the CLI records and plans, you
tune JSON, you re-render. **Never re-record to fix pacing or zooms — edit
`doc.json` and render again.** Quality bar: `references/taste.md` — follow
its quality loop and judge stills multimodally.

## Setup

```bash
npm i -D @vosjs/cli
```

One command, one package: `@vosjs/cli` is the open source (MIT) `vos`
binary with the engine verbs, the take pipeline used here (record / plan /
frames / render on screen recordings) and the vos.so platform verbs. (Until
0.9 the take pipeline shipped separately as `@vosso/vos-plugin`; a project
that still lists it can drop it.) Requirements:

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
| **Launch-kit stills** (store screenshots, tiles, OG) | sized to the asset | `frames --frame <t> --size WxH` PNGs from the same take | one take → every asset |
| **Quick demo** (issue, PR, chat) | 1280×720 | webm, defaults | speed over polish; drafts acceptable here ONLY |

Per-channel dimensions and byte budgets: `references/destinations.md`.

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
   `--strict` always: skipped selector / networkidle timeout → exit 2 with
   `skipped[]` in the done event. A skip means the flow is broken — fix it,
   never ship around it. The take auto-encodes and auto-plans.
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
     take dir (`"/music.mp3"`); gain/fades/loop. Muxed on full renders
     (Opus/AAC); `--range` stays silent; forces single-flight.
   - export: `{"resolution": "720p|1080p|2k|4k", "fps": 30}` — never above
     the footage (validate warns).
   Then `vos validate take --json` — lints must pass.

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

7. **Package for the destination**: `references/destinations.md`.

## Launch kit (one take → every store asset)

The `launch-kit` skill owns this destination: it establishes the release,
loops every channel against `channel-specs.json`, verifies each artifact
against its spec, writes the `kit.json` manifest and pushes labelled for
the release. The mechanics it loops are this skill's:
`vos frames take --frame <t> --size WxH` per still spec, the mp4 render for
video. Follow it when the ask is a release, not one video.

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
- A frozen opening: a static landing page records as freeze-then-bang;
  trim it or speed it, the story opens near the money shot.
- A store screenshot cut from the composed frame: real UX is the page, full
  bleed (`deliver` does this; a text-heavy page also wants a store-size take).
- A sign-in in `steps`: every step there is in the footage and a typed
  value is logged. It goes in `setup`, with the password from the shell
  (`references/sessions.md`).
- A real customer's account on screen: addresses, names and keys ship in
  the video. Record from a demo or seeded account, read the rehearsal's
  `EXPOSED` list, and `mask` what is left.
- A `mask` with `as: "text"` over product copy or a number: that is no
  longer a recording of the product.
- A `.png` name on `vos still`: it writes WebP; convert, and `vos validate
  <kit.json>` reads the bytes.
