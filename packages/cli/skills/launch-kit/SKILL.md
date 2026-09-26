---
name: launch-kit
description: Ship the media with the release — one take of the real product becomes the demo video, the store listing (Chrome Web Store screenshots, tile, marquee), the Product Hunt gallery, the social cuts and the OG card, each a frame of a poster document in the brand's look, verified against per-channel specs and against the picture itself, judged beside a reference set, and pushed as a version labelled for the release. Use when asked "we're launching / shipping vN", "update the Chrome Web Store (Play, Shopify) listing", "make the launch video", "cut a changelog / what's-new clip", "PR to video", "refresh the demo for the new version", "make the Product Hunt gallery", or to produce a launch week's batch of clips in one style.
license: MIT
---

# Launch kit — ship the media with the release

You are producing a RELEASE's media, not a video: one take of the shipped
feature becomes every asset the release needs, composed, sized and verified
per destination, kept as editable documents so the NEXT release is a
re-render, not a re-shoot. Everything is data; the preview is the render;
export is free at every resolution up to 4K, no watermark; the engine is MIT.

The kit is RENDERED in one verb, `vos deliver`, from documents that carry
the taste: every card is a frame of a POSTER document (a plain take whose
card sits where the poster wants it, with the words and the mark as clips),
every cut plays the motion `vos plan` proposed into its document (an
entrance, an end card, captions, a bed), the still moments come from the
story, and two verifiers say what is wrong in words. `deliver` composes
nothing. Your judgment goes into three files (`BRAND.md`, `LAUNCH.md`,
`actions.json`), one pick (which poster on the shelf the cards follow) and
one decision (which moments are the story), never into hand-cropping.

## Setup

```bash
npm i -D @vosjs/cli    # the vos CLI (take pipeline included)
```

`ffmpeg` on PATH covers what the CLI does not emit (the PH hover-GIF) and
lets `vos validate --picture` read a video's first and last frame. MP4
renders need system Chrome (`--format mp4`).

## 1. Establish the release

Five facts before any recording:

- **What shipped** — the feature, the version string, the URL where it runs.
- **Which destinations** — the per-channel spec table ships as data:
  `node_modules/@vosjs/cli/schema/channel-specs.json` (CWS, Product Hunt,
  X, LinkedIn, GitHub, OG, YouTube; sizes, counts, byte and duration
  ceilings, the word policy and the safe rect per destination, and each
  image's GENRE: `screenshot` is the real page, `card` is a frame of a
  poster document; `references/channel-specs.md` is the same data as a
  table). **Loop over it, never hand-type dimensions.** Ask which channels
  this release ships to; default to last release's set. The JSON carries a
  `verified` date; if it is more than a quarter old, spot-check the channel
  docs before shipping.
- **The brand** — resolve it BEFORE authoring any asset, and never default
  to a layout's own palette. The project folder's `BRAND.md` is the brand
  kit (frontmatter carries the colour roles `bgA bgB bgC ink accent`, the
  face roles `fontDisplay fontBody`, `logoUrl` (a bare mark, never a tiled
  icon), `wordmark`, and `look`, the presentation the site's own ground
  asks for: `plate` for a paper site, `dark` for a dark one, else
  `gradient`). Absent one, `vos brand <url>` witnesses it from the site's
  `/design.md`, `/llms.txt` and the page itself, and writes every role with
  its provenance; read it, correct what a page cannot say, and file it with
  `vos recipe push BRAND.md --folder <slug>`. Place it BESIDE the take (or
  in the take's parent folder): `plan` and `deliver` read it there with no
  flag.
- **The words** — `LAUNCH.md` beside the take carries the release's roles
  in its frontmatter, read with no flag:

  ```yaml
  headline: "Two to six words\nover up to three lines"   # the posters and the end card
  kicker: "PRODUCT  V2.1"       # absent = the wordmark plus --release
  music: upbeat                 # a catalog slug or mood; none = silent
  entrance: tilt-in             # tilt-in | pull-out | rise | none
  endCard: on                   # the official End card template; none switches it off; a title, vos id or doc.json names another
  with: "Split cover, landscape@end"   # optional: any template laid at an anchor (@end | @start | @step:<id> | @<seconds>)
  captions: on                  # none switches the beat captions off
  poster: poster/landscape      # optional: the document every card renders from
  poster-tile: poster/tile      # optional: one class named on its own
  ```

  A headline is the ONE line the release says; write it over its lines with
  `\n`. `vos plan` reads the motion roles when it proposes the cut's motion
  and `plan --style` types the words into a poster; `deliver` reads only
  the `poster` roles, and with none it looks for `poster/<class>/doc.json`
  beside the take.
- **The layout** — a poster the cards will follow, on a shelf. The official
  `Poster families` project on vos.so holds one exemplar per aspect class
  (landscape, square, portrait, tile) beside its `POSTER.md`, which says
  when each class is the one; a maker's own project is the same shape.
  `vos folder pull poster-families` lists them with their vos ids. There is
  no layout name and no `--layout` flag: the exemplar IS the layout, copied
  by data.

The destinations decide the VIEWPORT, before anything records: footage
resolution = viewport, and a 1280×720 take cannot honestly fill a 1920×1080
video spec. Record at 1920×1080 for a 1080p kit, 2560×1440 when a
destination is larger.

If the work lands in a vos.so project (folder), pull it first and read every
`.md` recipe in it — `LAUNCH.md` binds this loop the way `CUT.md` binds a
cut, and a `POSTER.md` binds the posters. Recipes override this skill's
defaults.

## 2. Source: one take of the real thing

The kit is made FROM the product, never from a mockup (store policy agrees:
misleading listing images are a removal-grade violation).

**Stage the content like a set before recording.** Half of what separates a
premium launch image from a screen grab is what is ON the screen. The
actions.json must leave the product in the state a proud screenshot would
show — labels typed, real-looking data, the feature mid-story — before any
poster or store still is cut. `deliver` drops a blank moment (a wallpaper,
an empty canvas) and says so, but it cannot stage the set for you.

**Write the story into `actions.json`.** Give steps an `id` (the moments
and the re-render loop address them by it) and a `caption` where a beat
deserves one (two to eight words; `plan` proposes it as a lower-third at
that step's moment on the cuts that take words). After a click that
navigates, put a `wait` for the load: the still is read at the END of that
wait, so the frame shows the page, never the spinner.

- **Fresh recording**: the `product-video` skill's loop (explore →
  `actions.json` → `vos record --strict` → tune `doc.json`). Keep
  `actions.json` in the repo — it is the next release's script.
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
  store listing showing a real customer's data is a removal-grade mistake.
- **Existing take**: cut it with the `vos-cut` skill. A hosted take comes
  home with `vos fetch <vosId|watch-url> --out dir --media`.
- **New version of a shot product**: re-record with `vos record` into the
  SAME take (the footage is replaced, the cut survives as `doc.prev.json`),
  then `vos plan take --reuse` re-times the cut onto the new recording and
  names what could not follow. Never start from scratch; every fix is an
  edit to `doc.json`.

A motion-graphic segment rendered elsewhere is an INPUT: it drops in as a
media overlay clip or a backdrop in the document, never the other way round.

## 3. The posters and the motion, as documents

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
official shelf (`"End card"`, `"Split cover, square"`), a vos id, or a
document on disk. Open the take in the studio and what you see is what the
kit renders.

```bash
vos plan take --motion --release v2.1
```

**A poster is a DOCUMENT, a plain take**: the card placed by `frame.inset`
(a negative side bleeds it off the edge), leaned by the tilt track's rest
pose, the words and the mark as overlay clips with stable ids
(`stage-title`, `stage-kicker`, `stage-brand`, `stage-mark`), and a
trailing `hold` on the last segment whose START is the still. Make one per
aspect class the release needs (landscape, square, portrait, tile), each
from the take's own footage:

```bash
cp -r take poster/landscape            # or vos duplicate <take vosId>, then fetch --media
vos plan poster/landscape --style <poster vosId|doc.json> --headline "…" --kicker "…"
vos frames poster/landscape --frame <rest>; vos validate poster/landscape
vos push poster/landscape --folder <project-slug> --label "poster, landscape"
```

`plan --style <poster>` copies the LAYOUT (the card's placement and
presentation, the stage clips with the release's words patched in from
`LAUNCH.md` or the flags, the rest lean, the hold) onto the take and keeps
the take's own aspect, chrome and cut; the brand's mark from `BRAND.md`
`logoUrl` is fetched into `brand/` for `stage-mark`, and what could not
follow is said. Narrow the segments to the moment (a zoom apex, the settled
response after a click) so the rest is the feature, never the cold open;
the product may keep PLAYING inside the card until the hold. Then look at
the rest frame: a poster is judged by eye before it is pushed. A human
opens it in the studio and drags the card, retypes the words in place,
moves the hold; `vos pull --media` brings that back down, and the next
release re-words it with the same `plan --style` from its own pushed
document.

## 4. Deliver

```bash
vos deliver take --to cws,producthunt,x,linkedin,og,github,youtube --release v2.1
```

One pass, and the verb decides what you used to decide by hand:

- **The moments.** Still times come from the STORY: every step's end plus a
  settle (the end of the wait that follows a click), then the zoom apexes,
  then a spread. Each candidate is read once as the real page; blanks are
  dropped, two of one frame collapse to one, every drop said in
  `skipped[]`. `--times step:<id>[+offset]` names one.
- **Screenshots** are the real page, full bleed: the store still and the
  gallery drop the cut's zoom, tilt and chrome by default (`--composed`
  keeps them, and the picture pass refuses it for the store).
- **The cards render from the posters.** Each card destination (the OG
  card, the LinkedIn and X images, the YouTube thumbnail, the CWS tile and
  marquee, the GitHub social preview, the PH thumbnail) renders from the
  poster document of its aspect class beside the take
  (`poster/<class>/doc.json`, or the document `LAUNCH.md`'s `poster` roles
  name) at that document's rest, at the destination's exact pixels. A
  class with no document is the take's own frame, said once in
  `skipped[]`. Nothing is composed in memory.
- **The cuts play the document.** `deliver` keeps only each destination's
  MECHANICS: a loop drops the entrance, the end card, the captions and the
  sound; a silent channel mutes the bed; the 9:16 cut is a reframe whose
  crop follows the camera, not a letterbox; a loop destination the take
  outruns takes the take's first seconds up to its cap; a byte ceiling
  becomes a bitrate budget.
- **The manifest.** `kit.json` beside the assets records every asset with
  its destination, the moment it came from, and for every card the poster
  it is a frame of (`source: "poster"`, the class, the file, the vos it
  tracks, the shot rect and the text boxes read FROM the document), and
  `skipped[]` with every reason.

## 5. Verify: the specs, then the picture

```bash
vos validate kit/kit.json --picture
```

The spec pass re-measures every asset from its bytes (px, bytes, duration,
count, a WebP under a `.png` name). The picture pass says what each asset
LOOKS like, every finding with a code, a severity, a fix hint and a box:

| code | what fires |
| --- | --- |
| `blank` | a card whose subject is under the ink floor: a wallpaper, an empty canvas |
| `duplicate` | cards of one frame (two is a note; three or more fails) |
| `subject` | a card off the 60 to 92% band, or a crop where a card was asked for |
| `separation` | a light card on a light ground with no shadow and no drawn edge |
| `halfsize` | a tile that loses its edges when the store shrinks it |
| `sliced` | a headline crossing the frame edge |
| `safe` | words outside the destination's safe rect, or words where none are wanted |
| `contrast` | a text box under APCA Lc 60 (headline) or 75 (body) |
| `firstlast` | a cut that opens or ends on nothing, or bled on all four sides |

A problem is redone by fixing the INPUT (a moment, a word, the set, the
poster document, a recipe line), never by hand-editing a PNG. Self-check by
these names before you render: a cold-open hero is `blank`, eight crops of
one frame is `duplicate`, white words on a paper ground is `contrast`. A
poster's card is judged by the shot rect the document carries, so a card
you dragged off the band is `subject` before anyone posts it.

## 6. Judge beside the references

```bash
vos judge kit/kit.json --against <MANIFEST.json>
```

The manifest names the maker's reference set (a private folder: id, file,
role, layout, facts, rule per asset; the public evals reference it by
role). For every still with a reference of its role the verb writes two
sheets (the asset left, then right) and the rubric beside them, and leaves
`judge.json` with a slot per pair. Judge every pair BOTH ways, with the
rubric's numbered rules and the three positive tests (would you post it as
a still; does it read at half size; name three ways it acknowledges THIS
product), and write `win` true, false or null (a tie) with the rule
numbers. Parity with the references is 50%; a kit under 40% is not ready
to market, said in the handoff, never shipped around.

Skip the judge for a re-render whose inputs did not change (the same take,
the same words); run it when a layout, a look, a headline or the set of
moments changed. Do not re-run `validate` or `judge` after a push unless
the human asks.

## 7. Push the release, file the kit

Push the source and every poster labelled for the release, and FILE the
kit's stills into the release's project so the human can retrospect without
a terminal:

```
vos push take --folder <project-slug> --label "v2.1 launch" --note "<what shipped, one line>"
vos push poster/landscape --folder <project-slug> --label "v2.1 poster, landscape"
vos asset push kit/*.png --folder <project-slug>
```

End by handing the human the loop, not the files: the watch page plays the
latest version, the studio edits the cut AND the posters (the card is a
layer you drag; the words are retyped in place), and `vos pull --media`
brings their edits back down. Next release, start at step 2's third bullet
and re-word the posters with `plan --style` from their own pushed
documents.

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
  set, the words, the layout pick, the moments, the verdicts). If you find
  yourself cropping a PNG by hand, the fix is a document, a recipe line or
  a check, and you should say so in the handoff.
- Platform specs drift. The JSON carries a `verified` date; if it is more
  than a quarter old, spot-check the channel docs before shipping.
- A layout is a document on a shelf plus a recipe line, never a name the
  document learns: the official `Templates` project holds the split cover in
  four aspect classes and the end card today (`vos plan take --style "Split
  cover, landscape"` carries a layout; a poster's still is where its
  trailing freeze begins); a maker's own family is a project of their own
  posters beside a `POSTER.md`. Applying one is `plan --style <vosId>`.

## Avoid (the traps that shipped)

- A 720p recording against a 1080p spec: the destinations pick the viewport
  before anything records. Cost a full re-record once.
- A layout's own palette on a deliverable: resolve `BRAND.md` (or witness
  the site) before any asset is authored, and put it beside the take.
- A cold-open hero (`blank`): the first frame is the marketing page's
  headline with the product nowhere; `deliver` reads the steps, but a
  script with no gestures gives it nothing to read.
- A poster whose rest is the cold open: narrow its segments to the moment
  (a zoom apex) and hold there; the still is the hold's start.
- A card that is not a frame of a document: there is no `--poster`, no
  `--shot-time` and no in-memory composition; a card destination with no
  poster document renders the take's own frame and says so.
- Eight crops of one frame (`duplicate`): a script with one moment. Give the
  story steps, and waits after the clicks that navigate.
- A store screenshot under the frame chrome or the camera zoom: the store
  still is the real page, full bleed (deliver's default, and `--composed`
  is refused by the picture pass).
- The loading plane as the hero: a click that navigates settles when the
  wait after it ends; a click with no wait after it is read 0.4 s later,
  mid-load.
- White words on a paper ground (`contrast`): the end card takes the brand's
  ink; a kicker softened too far reads under the floor.
- A card that is WebP under a `.png` name: `vos still` writes WebP; convert,
  then `vos validate` reads the bytes and says so.
- Padding a spec floor: a 36 s story is a skipped 60 s demo, with its reason.
- A hand-typed dimension: every size comes from `channel-specs.json`.
- The save beat on a demo instance that disables writes: say so in
  `skipped`, never fake the click.
