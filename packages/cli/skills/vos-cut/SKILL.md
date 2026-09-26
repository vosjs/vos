---
name: vos-cut
description: Cut a screen recording (a vosso take) into the product video it was recorded for, from its evidence, with the vos CLI — read the take's digest (the moments the cursor track says mattered, each with a footage frame and a crop), narrate beats, edit doc.json by exception over the planners, verify with stills, and push an attributed version the human fine-tunes at vos.so; every edit is a data patch, so a re-cut never re-records. Use when asked to edit or cut a recording, make a product video or what's-new clip from a take, cut it like the last one, or cut a series of recordings in one style.
license: MIT
---

# Cut a take from its evidence

You are cutting a RECORDING somebody made (a vosso take: `recording.webm` +
`cursor.json` + `meta.json` + `doc.json`), not recording one. Recording from
a script is the `product-video` skill; programs are `vos-create`/`vos-remix`.

The loop is: **see → narrate → decide by exception → verify → push → (human
looks) → re-cut**. Every step names the verb that does it. The document is
`doc.json`; the contract for its fields and units is
https://vos.so/llms-full.txt. Nothing here re-records a human's take, ever:
a cut cannot fix footage, and if the footage cannot carry the ask, you say so
in the note and stop.

## Setup

```bash
npm i -D @vosjs/cli   # fetch, digest, plan, frames, render, push, pull
```

Credentials, in this order, never printed: `VOS_API_KEY`, then the first
line of `~/.config/vos/credentials`, then `vos login` (a browser sign-in that
mints a key for this machine). Keys create PRIVATE work only and can never
publish. A Chromium is needed for `digest`, `frames` and `render`.

## 0. Ground rules that override everything below

- **Never read the video.** Your eyes are `vos digest`: `digest.json`, then
  `sheet.png`, then a crop only where you must decide. A 90s take is ~35
  moments and ~25-40k image tokens if you read every image; the sheet plus
  the decisive crops is ~10k. The done event prints the estimate.
- **Edit by exception.** The planners (zoom, speed, tilt) already answered
  WHERE every click, typing session, scroll run and idle gap is. `plan` in
  the digest holds their spans and `proposed` names the ones under each
  moment. Keep, merge, drop or retime those; add only what a planner cannot
  know (which lone click deserves a beat, a caption, a speed-through that is
  boring but not idle). Every span you touch carries `"source": "manual"`.
  A proposal you DROP goes into `rejected` (`[{id, lane, in, out}]`, the
  lane and its source extent) so no re-plan, and no re-record carried by
  `plan --reuse`, proposes that beat again; the studio writes it itself
  when a human deletes an auto span.
- **Point with a layer, not the camera.** When the cut points at a
  component (a button, a card, a code block) and the zoom would magnify
  pixels, redraw it as an html layer in `doc.json` (`overlays[]` with
  `kind: "html"`: the markup, the CSS in the product's own type, the design
  box in 1080p px) placed beside its subject, never over it. You have the
  product's real components in the repo; use them. The markup is well-formed
  XML and `vos validate` says what would not paint; a CSS animation runs on
  the wall clock and is refused in favour of `anim` and `motion`.
- **The doc's units, copied, never converted.** A moment's `focus` is a zoom
  span's `cx`/`cy`; its `rect` is what the zoom must contain. `source`
  extents are footage seconds (zoom/speed/tilt/segments); `output` extents
  are rendered seconds (overlays/audio). Pixel values anywhere are the #1
  mistake.
- **Human edits are sacred.** `doc.manual` in the digest counts spans a human
  decided; a push that touches a node the human edited since your base 409s
  as `protected_conflict`. Keep their values unless the ask names that exact
  node.
- **Three rounds alone, then a human.** Round = edit → validate → frames →
  judge. If it will not land in three, push the best round and say why.
- **The ask decides; the folder's recipes rank next; these defaults last.**
  A recipe line the recent members contradict is called stale in your note,
  not obeyed.

## 1. See

```bash
vos fetch <vosId> --media        # a hosted take you did not record (doc + footage home)
vos pull <take> --media          # a take dir already linked to vos.so
vos folder pull <slug> --media   # a project's takes, recipes included
vos plan <take> --style <seed doc.json|vosId>   # in a series: the seed's style, by data
vos digest <take> [--transcript whisper.json] [--style <seed>]
```

Read, in this order:

1. `digest.json` → `take` (duration, page, has cursor/mic), `moments`
   (id, kind, source/output windows, focus, rect, activity, proposed, said),
   `plan`, `doc.manual`. A take with `hasCursor: false` (a browser-recorder
   take) lists head/tail/scenes only: pace by `activity`, zoom only where the
   ask names a place, and say in the note that the take had no cursor track.
2. `sheet.png` → the crops in time order, ids burned in. This is the film at
   a glance.
3. `m<nn>.crop.png` for the moments the ask or the recipe makes decisive;
   `m<nn>.full.png` only for context (what page, what section).

Reading a crop: what is in focus (a control, a field, content); what it says
(the label, the value typed); is the click's consequence visible in the next
moment's frame or in a `scene` moment right after it. A `scene` is a
frame-diff jump (a navigation, a dialog); look at its full frame to name it.

Two things the crops say that the click list does not: a click cluster whose
`rect` is most of the frame is a DRAG (aiming, scrubbing, moving a thing),
not a target; and an "idle" gap whose `activity` stays above ~0.1 is the
video PLAYING, not idle. Neither wants the planner's proposal.

If a folder is involved, read EVERY `.md` in it (own and inherited) before
you decide anything.

## 2. Narrate

Write 3-6 beats into your working notes, each with its moment ids, what it
SHOWS (from the crops) and what it is FOR (from the recipe, the page title,
`said`, or the ask). Example:

```
B1 m01-m04  the gallery: browse, pick a program            (open wide, one card zoom)
B2 m05-m06  Remix opens the studio                          (the scene is the payoff)
B3 m07-m12  knobs: five slider drags on the remix panel     (one held zoom, 2× over the middle)
B4 m13-m14  the result plays out                            (release, settle)
```

No ask came with the take? Infer one from the recording (what it shows,
where it would be shown, how long it should be) and STATE IT in the version
note, so the human corrects the ask before the cut when it is wrong.

If the ask names a beat ("make the export part snappier"), map it to moment
ids FIRST and touch nothing outside them.

## 3. Decide, by exception

Per beat, against `plan` and the recipe:

- **Zoom.** Keep the planner's span when it frames the beat; merge adjacent
  proposals into one held span when they are one beat (one zoom per beat,
  never per click); drop a proposal on a click that is not a beat; add a
  span on a lone click the planner skipped when the crop shows it is the
  moment. Level from the rect: a small control wants 1.8-2.2, a panel
  1.4-1.6; when the target is most of the frame's width, the framing lint
  decides the level, obey it. `cx`/`cy` = the moment's `focus`. Ids you
  mint: `u1`, `u2`… In an editor recording, zoom the LANE where a span
  appears, never the canvas being dragged. Release a zoom BEFORE a click
  that navigates, so the page swap plays wide.
- **Speed.** Keep proposals on typing/idle/scroll; add `2×`-`3×` on a stretch
  whose `activity` is low and no beat needs, or under drag clusters; never
  over a beat's payoff, never over playback.
- **Tilt.** Only if the camera style has one (`tiltStyle`/the style's
  personality) and a beat earns punctuation. One pose per ~5s, ±5..18°.
- **Trim.** Head and tail: cut to the first and last thing that matters
  (`segments`), leaving ~0.5s of settle at the end. Loading screens are cut.
- **Text.** A caption per beat that has something to say, at a cadence (one
  every 5-10s, 2.5-4s each, never two at once), in the product's words and
  the video's intention; lower-third `y ≈ 0.82`; OUTPUT seconds; never over
  the clicked control (validate warns). The clip's shape is `{ "id", "kind":
  "text", "text", "start", "duration", "transform": { "x": 0.5, "y": 0.82 } }`
  (`start` and `duration`, never `in`/`out`, which are the source lanes').
  Give it a `box` (`{ "color": "#111111" }`) when the ground under it is
  light (an editor's timeline is), and judge every caption at its own
  instant. One caption per film is too sparse for a film that explains a
  flow; zero is right only when the recipe or the ask says no text.
- **Style.** In a series, `vos plan --style <seed>` BEFORE you cut: it copies
  the seed's `zoomStyle`/`zoomParams`/`speedParams`/`tiltStyle`/`frame`/
  `cursor`/`cam`/`export` and re-plans the auto spans under them. Never
  restate those numbers in a recipe; the seed's doc is their home.

Write the patch as EDITS to `doc.json`, never a rewrite. Keep every field you
do not understand.

## 4. Verify

```bash
vos validate <take>                                   # clean; READ the framing warnings, fix them
vos digest <take> --no-frames                         # after retiming: fresh OUTPUT times, same frames
vos frames <take> --at-moments --at-zooms --times 0,25%,50%,75%,100%
vos frames <take> --times <every caption start + 1>   # each caption on its own ground
vos render <take> check.webm --range a..b --draft     # the beat that changed most
```

Judge the stills against the quality loop in https://vos.so/llms-full.txt
and the folder's bar: blur, chrome, cursor, text legibility, first and last
frame as posters; the money shot inside 3s; the end settled; ≤1 full-frame
bang per ~5s (`ffmpeg -vf "select='gt(scene,0.12)'"` counts them). A
`moment-<id>` still and its `<id>.crop.png` share an id: "what was there"
beside "what the cut shows".

## 5. Push

```bash
vos push <take> --label "<what, imperative, ≤60 chars>" --note "<the ask you cut to; the beats with source seconds; what you dropped and added>" [--folder <slug>]
```

The base comes from `vos.json`. `409 stale_base` → `vos pull`, re-apply on
top, push again. `409 protected_conflict` → keep the human's values unless
the ask named that node (`--override <id>` only then). A 400 prints the
field and its limit. Then `GET /api/vos/<id>`, follow
`contentUrls.thumbnail`, and LOOK at it before reporting done.

## 6. Re-cut (the human looked)

`vos pull` prints the differ's summary of what they changed ("zoom z3: level
2.2→1.6; overlay c1 removed"). That is the feedback, in the data's own words:
re-cut what their WORDS asked for and nothing their HANDS already fixed.
Count the rounds. "Great" is their word and a seed's only exit.

## 7. Remember (only after the human signed off on a seed)

File it and write the rules down; numbers stay in the seed's doc.

```bash
vos folder create "<series>" --desc "<what it is for, ≤200 chars>"
vos folder move <vosId> --to <slug>
vos recipe push CUT.md --folder <slug>      # applies: takes, seed: <the vos id>
vos recipe push BRAND.md --folder <slug>    # applies: any, seed: none
```

A recipe is named in CAPS, the way `CLAUDE.md` is: it is the file the
collection reads before it cuts anything. What you file is stored with
its stem uppercased either way, so the terminal and the shelf agree.

`CUT.md` says what a number cannot: the beat vocabulary, what gets a
caption and what never does, hold lengths, the title/end convention, the
length band, what to skip, and the decisions the human corrected INTO the
seed (read from the differ). `BRAND.md`: typography, palette, background,
music, the voice of any text. Later members: pull the folder, digest, plan
`--style` from the seed, cut against `CUT.md`, push `--folder`; a
correction that recurs across two members (or one the human states for all
of them) is appended under `## Agent notes`, dated, and the rule above it
is rewritten to match (`vos recipe push <file> --asset <id>` replaces in
place; the prior body is kept). Never rewrite the owner's lines silently;
never write a status line.

## Never

- re-record a human take, or "fix" footage with a cut it cannot carry;
- read the video, or send it anywhere;
- re-plan away spans a human made (`doc.manual`, absent-`source` speed spans);
- put pixels in `cx`/`cy`/`transform`;
- speed up playback, or zoom a canvas being dragged;
- spread a series before its seed is signed off;
- push without `--label` and `--note`.
- open a zoom before the click it frames, or aim it at a `type` verb's
  field centre (frame the text; start the span after the click);
- leave the cold open frozen (a static page records as freeze-then-bang:
  trim it, or speed the load);
- end wide on an empty page: the last frame is the poster, so the closing
  span holds the result and its proof.
