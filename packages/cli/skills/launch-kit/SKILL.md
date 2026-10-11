---
name: launch-kit
description: Ship the video with the release. One take of the real product becomes the launch demo video and its social cuts (the X feed cut, the Shorts and LinkedIn vertical, the GitHub README loop), each cut to its channel's spec in the brand's look with the motion as data in the document, verified, and pushed as a version labelled for the release so the next release is a re-render, not a re-shoot. Use when asked "we're launching / shipping vN", "make the launch video", "cut a changelog / what's-new clip", "PR to video", "refresh the demo for the new version", "make the social cuts for the launch", or to produce a launch week's batch of clips in one style.
license: MIT
---

# Launch kit: ship the video with the release

You are producing a RELEASE's video, not one clip: one take of the shipped
feature becomes every cut the release needs, sized and verified per
channel, kept as an editable document so the NEXT release is a re-render,
not a re-shoot. Everything is data; the preview is the render; export is
free at every resolution up to 4K, no watermark; the engine is MIT.

The kit is RENDERED in one verb, `vos deliver`, from a document that
carries the taste: every cut plays the motion `vos plan` proposed into it
(an entrance, an end card, captions, a bed), and `vos validate` says what
is wrong in words. `deliver` composes nothing. Your judgment goes into
three files (`BRAND.md`, `LAUNCH.md`, `actions.json`) and the cut itself,
never into hand-editing a video file.

## Setup

```bash
npm i -D @vosjs/cli    # the vos CLI (take pipeline included)
```

`ffmpeg` on PATH lets `vos validate --picture` read a cut's first and last
frame. MP4 renders need system Chrome (`--format mp4`).

## 1. Establish the release

Five facts before any recording:

- **What shipped**: the feature, the version string, the URL where it runs.
- **Which cuts**: the per-channel spec table ships as data:
  `node_modules/@vosjs/cli/schema/channel-specs.json` (the YouTube main
  demo, the X feed cut, the Shorts and LinkedIn vertical cut, the GitHub
  README loop; sizes, duration and byte ceilings, the word policy and the
  safe rect per cut; `references/channel-specs.md` is the same data as a
  table). **Loop over it, never hand-type dimensions.** Ask which channels
  this release ships to; default to last release's set.
- **The brand**: resolve it BEFORE cutting, and never default to a
  template's own palette. The project folder's `BRAND.md` is the brand kit
  (frontmatter carries the colour roles `bgA bgB bgC ink accent`, the face
  roles `fontDisplay fontBody`, `logoUrl` (a bare mark, never a tiled
  icon), `wordmark`, and `look`, the presentation the site's own ground
  asks for: `plate` for a paper site, `dark` for a dark one, else
  `gradient`). Absent one, `vos brand <url>` witnesses it from the site's
  `/design.md`, `/llms.txt` and the page itself, and writes every role with
  its provenance; read it, correct what a page cannot say, and file it with
  `vos recipe push BRAND.md --folder <slug>`. Place it BESIDE the take (or
  in the take's parent folder): `plan` and `deliver` read it there with no
  flag.
- **The words**: `LAUNCH.md` beside the take carries the release's roles
  in its frontmatter, read with no flag:

  ```yaml
  headline: "Two to six words\nover up to three lines"   # the end card
  kicker: "PRODUCT  V2.1"       # absent = the wordmark plus --release
  music: upbeat                 # a catalog slug or mood; none = silent
  entrance: tilt-in             # tilt-in | pull-out | rise | none
  endCard: on                   # the official End card template; none switches it off; a title, vos id or doc.json names another
  with: "<template>@start"      # optional: any template laid at an anchor (@end | @start | @step:<id> | @<seconds>)
  captions: on                  # none switches the beat captions off
  ```

  A headline is the ONE line the release says; write it over its lines with
  `\n`. `vos plan` reads these roles when it proposes the cut's motion.
- **The length**: each cut has a duration band in the specs. A story
  shorter than a cut's floor is that cut skipped with its reason, never
  padded.

The cuts decide the VIEWPORT, before anything records: footage resolution
= viewport, and a 1280×720 take cannot honestly fill a 1920×1080 cut.
Record at 1920×1080 for a 1080p kit, 2560×1440 when a cut is larger.

If the work lands in a vos.so project (folder), pull it first and read every
`.md` recipe in it: `LAUNCH.md` binds this loop the way `CUT.md` binds a
cut. Recipes override this skill's defaults.

## 2. Source: one take of the real thing

The kit is made FROM the product, never from a mockup.

**Stage the content like a set before recording.** Half of what separates
a premium launch video from a screen grab is what is ON the screen. The
actions.json must leave the product in the state a proud demo would show:
labels typed, real-looking data, the feature mid-story.

**Write the story into `actions.json`.** Give steps an `id` (the re-render
loop and the template anchors address them by it) and a `caption` where a
beat deserves one (two to eight words; `plan` proposes it as a lower-third
at that step's moment on the cuts that take words). After a click that
navigates, put a `wait` for the load, so the cut never dwells on a spinner.

- **Fresh recording**: the `product-video` skill's loop (explore →
  `actions.json` → `vos record --strict` → tune `doc.json`). Keep
  `actions.json` in the repo: it is the next release's script.
- **The shipped feature is behind a login**: settle the session before
  the script, by the `product-video` skill's ladder
  (in full at https://vos.so/llms-full.txt, "Sessions"): mint one from the test auth the repo
  already has, else script the form off camera, else the human signs in
  once (`vos session open <url> --name <app>`, then `--session <app>`), else they
  record with the extension and you cut it. Record with
  `--storage-state <file>`. A release re-records every version, so prefer
  the rung that needs no human: it is the one that still works next
  release. Never type or accept a production password; keep the state file
  out of the take and out of git; record from a demo account, because a
  launch video showing a real customer's data is a removal-grade mistake.
- **Existing take**: cut it with the `vos-cut` skill. A hosted take comes
  home with `vos fetch <vosId|watch-url> --out dir --media`.
- **New version of a shot product**: re-record with `vos record` into the
  SAME take (the footage is replaced, the cut survives as `doc.prev.json`),
  then `vos plan take --reuse` re-times the cut onto the new recording and
  names what could not follow. Never start from scratch; every fix is an
  edit to `doc.json`.

A motion-graphic segment rendered elsewhere is an INPUT: it drops in as a
media overlay clip or a backdrop in the document, never the other way round.

## 3. The motion, as data

**The cut moves by data.** A fresh `vos plan` proposes the cut's motion into
`doc.json` from `LAUNCH.md`'s roles: the card's entrance, the END CARD (the
official `End card` template on vos.so, laid at the end: the card recedes
over a one-second freeze of its last frame, then the mark, the headline
arriving word by word, the release line and the URL settle on the ground;
its clips are stamped `from: endcard`), any template `with:` names at its
anchor, a caption per step, a music bed and a click sound on every press
when the take has no mic; every proposal carries a stable id (`bed`,
`click-<n>`, `caption-<step>`). On an existing cut `--motion` re-proposes;
a refresh never does, so a deleted end card stays deleted. A template is a
plain take on a shelf whose clips carry stable ids; a ref is a title on the
official shelf (`"End card"`), a vos id, or a document on disk. Open the
take in the studio and what you see is what the kit renders.

```bash
vos plan take --motion --release v2.1
vos frames take --at-zooms; vos validate take
```

Look at the frames before delivering: the opening beat, the zoom apexes
and the end card are judged by eye.

## 4. Deliver

```bash
vos deliver take --to youtube,x,shorts,github --release v2.1
```

One pass, and the verb keeps only each cut's MECHANICS:

- **The main demo and the feed cut play the document** as planned, with
  its entrance, end card, captions and bed.
- **The vertical cut** is a 9:16 reframe whose crop follows the camera, not
  a letterbox, with the words inside the channel's safe rect.
- **The README loop** drops the entrance, the end card, the captions and
  the sound; a take that outruns its cap gives its first seconds up to the
  cap, and the byte ceiling becomes a bitrate budget.
- **A silent channel** mutes the bed.
- **The manifest.** `kit.json` beside the cuts records every asset with its
  destination, and `skipped[]` with every reason (a cut whose floor the
  story is under, a channel the take cannot serve).

## 5. Verify

```bash
vos validate kit/kit.json --picture
```

The spec pass re-measures every cut from its bytes (px, bytes, duration,
container and codec). The picture pass reads each cut's first and last
frame and fires `firstlast` on a cut that opens or ends on nothing, or one
bled on all four sides; every finding carries a fix hint.

A problem is redone by fixing the INPUT (a step, a word, the set, the cut
in `doc.json`, a recipe line), never by hand-editing a rendered file. Do
not re-run `validate` after a push unless the human asks.

## 6. Push the release

Push the take labelled for the release:

```
vos push take --folder <project-slug> --label "v2.1 launch" --note "<what shipped, one line>" \
  --prompt "<the person's prompt, as they wrote it>"
```

`--prompt` shows the person's prompt on the watch page by default: their words as they wrote them, never yours, with no file path, key or email they did not mean to publish. Say it is shown, and that they can take it off from the watch page.

End by handing the human the loop, not the files: the watch page plays the
latest version, the studio edits the cut (every zoom, caption and the end
card is a layer or a span they can drag), and `vos pull --media` brings
their edits back down. Next release, start at step 2's last bullet.

**Preserve the human's changes.** They edit the take in the studio outside
this conversation. If `vos pull --check` or the differ's `protected` set
shows a change you did not make, assume it was intentional or ask; never
overwrite it, and never re-plan over a manual span.

## Launch week (5-12 clips, one style)

A launch week is a series: cut and sign off ONE seed clip with the human
first, then cut every other feature's take with
`vos plan <take> --style <seed doc.json|vosId>` so the batch shares its look
by data. Never spread before the seed is signed off.

## Notes

- `deliver` is the procedure; this skill is the judgment around it (the
  set, the words, the story, the verdicts). If you find yourself editing a
  rendered file by hand, the fix is the document, a recipe line or a
  check, and you should say so in the handoff.
- Platform specs drift. The JSON carries a `verified` date; if it is more
  than a quarter old, spot-check the channel docs before shipping.
- Stills of the product (a cover, a frame for a post) are not this skill:
  `vos push --still` sets the vos's cover, and `vos frames --frame <t>`
  reads any frame of the take.

## Avoid (the traps that shipped)

- A 720p recording against a 1080p spec: the cuts pick the viewport before
  anything records. Cost a full re-record once.
- A template's own palette on a deliverable: resolve `BRAND.md` (or witness
  the site) before cutting, and put it beside the take.
- A cold open (`firstlast`): the first frame is the marketing page's
  headline with the product nowhere; trim to the story or let the entrance
  carry it.
- The loading plane on screen: a click that navigates needs the `wait`
  after it.
- White words on a paper ground: the end card takes the brand's ink; a
  kicker softened too far reads under the floor.
- Padding a spec floor: a 36 s story is a skipped 60 s demo, with its reason.
- A hand-typed dimension: every size comes from `channel-specs.json`.
- The save beat on a demo instance that disables writes: say so in
  `skipped`, never fake the click.
