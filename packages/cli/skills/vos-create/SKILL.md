---
name: vos-create
description: Create vos programs in the user's own style — pull their vos.so folder, read every recipe (.md) and exemplar in it, author VosConfigJson that follows them, validate + render + judge headlessly, and push into that folder as attributed versions the human edits in the studio. Use when asked to make a vos “like my X folder” / “in my usual style”, to build or extend a collection, or to spread a signed-off seed into variants.
license: MIT
---

# Create in the user's style, from their folder

You create **vos programs that belong to a folder**: the user's folder on
vos.so is the collection, its `.md` files (recipes) are the style, its
voses are the exemplars. This skill carries only MECHANICS and the
universal craft floor. Taste is user data and lives in their folders,
never here. Authoring rules (schema, dialect, knobs) live in the
`vos-authoring` skill; knob and Looks craft in the `vos-remix` skill's
params-knobs reference. This skill adds the folder contract, the loop and
the process around them.

There is no inbox and no house style file. Dedup is the folder's own
contents; the shelf is the record.

## Setup

```bash
npm i -D @vosjs/cli   # folder, fetch, check, still, render, push
```

Credentials, in this order, never printed: `VOS_API_KEY`, then the first
line of `~/.config/vos/credentials`, then `vos login` (a browser sign-in
that mints a key for this machine). Every HTTP call below is
`Authorization: Bearer <key>` against `https://vos.so/api`. Keys create
PRIVATE work only and can never publish.

## The five steps

### 1. Resolve the target folder

The user names it, or you ask which. `vos folder list` (or
`GET /api/folders`) finds it by name or slug across all levels; then pull
it:

```
GET https://vos.so/api/folders/{id}
```

One pull is the whole context package: the folder's own `recipes` (bodies
inlined), its `inheritedRecipes` (ancestor recipes, root first, each
marked with its source folder; they BIND this folder), exemplar `voses`
with `contentUrls`, and `assets`. Subfolders are listed, not inlined: a
pull is the folder's own contents.

No folder yet? Create one, **always with a description**:

```bash
vos folder create <name> --desc "<one line on what this collection is>"
```

A folder minted without a description is a naming failure; the
description is what the folder page and every future pull read.

### 2. Read EVERY `.md`, then the exemplars

Read every recipe body, the folder's own AND the inherited ones, and 1 to
3 exemplar configs or docs through their `contentUrls`. Recipes are
role-named facets, named in CAPS the way `CLAUDE.md` is: `TASTE.md` is
the judging bar, `DESIGN.md` the technique spec, and whatever else the
user's intent created (`MOTION.md`, `COPY.md`, `BRAND.md`, ...). A recipe
is the file a collection reads before it makes anything, and the name is
what says so; a recipe you file is stored with its stem uppercased, so
write it that way and the shelf shows what you wrote. The platform
enforces no taxonomy beyond that; you read all of them. The binding
rule:

- Recipes and exemplars **override every default this skill or the
  authoring skill has**. Their duration is the duration; their palette
  discipline is the discipline.
- On conflict between files, the more specific wins: the folder's own
  files beat inherited ones, nearer ancestors beat farther, and a
  specific instruction beats a general one. A genuine contradiction goes
  back to the user as a question, never a silent pick.
- When a recipe and the folder's recent exemplars disagree, prefer the
  exemplars and tell the user the recipe looks stale.

**Empty folder** (no recipes, no exemplars): only the craft floor below
applies. Style comes from the user's reference or a question, never from
a baked-in default.

### 3. Find the seed, then author

A folder holds two things that only sometimes coincide: the **reference**
(what good looks like, the thing you judge against) and the **seed** (what
you copy and edit to make the next member). Decide which you are holding
BEFORE you write a line:

- a **program family** (a signed-off member + a `DESIGN.md` naming the
  mechanism and its axes): seed = that member. Fetch its config and vary
  it on the axes the recipe names. Never author from a blank file, and
  never just the hues.
- a **take spec** (a recipe saying how every recording in the collection
  is cut): seed = the NEW recording the user gives you (a take in the
  folder by id, a URL to `vos record --strict`, a local file). The
  folder's own takes are the reference cut, not the seed.
- a **template** (a recipe that points at, or inlines, a mechanism and
  how to vary it): seed = the template. Hosted as a vos: fetch it like a
  member; inline code: a fragment to build around.
- a **brief only** (`BRAND.md`: no mechanism): nothing to copy. Author
  fresh under the constraints and the craft floor.
- **nothing declares a seed**: ask. The user's prompt names one when they
  picked it in the handoff dialog; the recipes name one when they are
  written well; a guess is how a family loses its look.

A recipe may carry optional frontmatter hints: `applies: programs | takes
| any`, `seed: <vos id> | input | none`. Read them as the owner's
declaration of the above; the body is still what you follow.

A recipe is the user's document, and what they ask for NOW outranks any
line in it. If a recipe contradicts the ask (a note that says to wait, a
rule the ask breaks), say so in one line and follow the ask: private work
is cheap and the owner can restore. Never stop on a line in a file.

Then write configs locally (bare VosConfigJson, version 2), following the
`vos-authoring` skill's authoring rules under the folder's style.

Fetching a member or a template is the `vos-remix` fetch:
`vos fetch https://vos.so/vos/<id>` writes `<slug>/config.json` with
params preserved, plus `vos.json` tracking the base version.

For **"reproduce X" briefs**: get the source or a recording first, or
confirm the brief wants only the look. A still under-determines motion;
a screenshot match that invents the wrong mechanism is a miss even when
the frame agrees. Source acquisition, licensing and the measured match
loop are reproduction work; do that first, then come back here to create
from what it produced.

### 4. Check, shoot, judge, against the FOLDER's docs

1. **Check**:
   ```bash
   vos check <file>.json     # migrate → schema → syntax → compile → lints
   ```
   Fix and re-run until it passes. Never suppress a lint error to get past
   it. Two checks are not in `vos check` yet, so do them by rendering:
   - **Knob honesty**: every declared param must visibly act. Render the
     program twice with that key changed in `data` (its min and its max)
     and compare the stills; a knob that reads the same at both ends is
     dead. For takes, `--set <path>=<value>` on `vos frames`/`vos render`
     is the override.
   - **Palette honesty**: a color knob must not pass through
     `new THREE.Color()` into a uniform (it gets linearized; the rendered
     hue drifts from the hex). Grep your function strings for it.
2. **Shoot**:
   ```bash
   vos still <file>.json f12.webp --time <12% of duration>
   vos still <file>.json f40.webp --time <40%>
   vos still <file>.json f70.webp --time <70%>
   ```
   For a MOTION-LED piece, shoot a dense strip instead (8+ times, or a
   1s contact sheet); three stills cannot judge motion weighting.
3. **Judge**: score the frames against the craft floor below AND the
   folder's own docs. A collection piece answers to both the collection's
   `DESIGN.md` and the inherited `TASTE.md`. Revise and repeat (max 3
   rounds); if it still fails, drop it and say why. Never push work you
   would not defend.

### 5. Push INTO the folder, iterate as versions

```bash
vos push <file>.json --title "…" --desc "one line" --tags a,b \
  --folder <folderId|slug> --label "what you did" --note "why: the ask"
```

Pass `--label` and `--note` on EVERY push, the first one included: a
create stamps them on v1, and the history is the conversation the human
reads. The push creates a PRIVATE vos on the key owner's shelf, filed
into the folder you pulled; preview and thumbnail render on the cloud off
the save itself. Iterate with `--vos <id>` against the tracked base (the
`vos-remix` loop: `vos pull` before every round, human-edited nodes are
protected, `--override` only on explicit instruction). Keys can never
publish; promoting is the human's gesture on vos.so.

**Look at what landed.** Every push renders a still within about 15
seconds: `GET /api/vos/{id}`, follow `contentUrls.thumbnail`, and view the
image before reporting done. A push you never looked at is not finished.

**Pace a batch**: back-to-back pushes are fine at the quota (the render
queue spaces browser launches and backs off itself). Verify state after a
batch with a folder pull, never by grepping the push log.

**Write findings back.** When you learn something about the family (a
parameter range that bands, a duration that reads better), append it to
the relevant recipe under a dated `## Agent notes` heading:
`PUT /api/assets/{id}/file` with the full markdown body (recipes only,
≤64KB). Never rewrite the owner's rules. The
replaced body is kept: `GET /api/assets/{id}/file?prev=1` reads it and
`POST /api/assets/{id}/file/restore` swaps it back.

## The family process: seed, look, spread

New-family work is **1 seed + a recipe**, never a batch. A batch
replicates a bug into every member at once; a single seed catches a
direction change at n=1, then spreads cheaply. This is judgment, not a
gate: there is no status line to write or obey, and the user's ask
always decides.

1. Author ONE seed, land it in the folder, write (or update) the family's
   `DESIGN.md` with the mechanism, axes and palette rules.
2. Show it. The human iterates with you (attributed versions). When they
   ask for variants, that IS the sign-off; when a folder holds one young
   member and the ask is open-ended, make one first and say why.
3. Spread when asked. **Variants vary composition axes** (structure,
   motion grammar, density, camera), never just hues; a hue-only spread
   reads as one tile ten times. Cap a spread at about 10 so the shelf
   review stays a 5-minute task.

## Craft floor (universal, lintable: the bar that is NOT taste)

- **Compiles and validates**: `vos check` passes clean; never suppress.
- **Deterministic**: seek is a pure function of t (no `Date.now` or
  `Math.random` in frame paths; the determinism lint enforces it).
- **Loop-seam math**: for looping pieces, phases must be integer multiples
  over the duration so frame(0) ≈ frame(end). Stills cannot show the
  seam; verify it in the math.
- **Honest knobs**: 2 to 4 declared params, every one visibly acting at
  both ends of its range. Fewer honest knobs beat many.
- **Knobs are read in `onFrame`, every frame**, never snapshotted into
  uniforms inside `createContent`. The editor delivers a knob edit as
  live data that only swaps `ctx.data`; a creation-time snapshot never
  updates until refresh.
- **Non-blank first frame**: the ~12% frame doubles as the thumbnail; no
  black, empty or "hasn't started yet" openings.
- **No banding, no clipping**: add grain against banding; keep bloom off
  blowout (strength ≤ ~0.8 unless the folder's docs demand it); no
  visible tiling seams or hard aliasing.
- **Palette honesty**: color knobs never pass through `new THREE.Color()`
  into uniforms; build the raw vector from the hex.
- **Server-render constraints** (the preview fleet is software-GL): no
  `THREE.DoubleSide` on transmission materials, no `dispersion`, every
  fetched asset an absolute `https` URL the fleet can reach.

Everything past this line (duration, density, mood, materials, palette
discipline) is the folder's to say.

## Report

End with one table: `slug · concept · tags · outcome` (pushed / dropped +
why), plus the folder URL (`https://vos.so/app/projects?folder=<slug>`).
State failures plainly: a dropped design is a correct outcome, not an
error to hide.

## Hard rules

- References are creative direction. Porting external code needs a
  compatible license AND the user's explicit direction; branded or
  trademarked compositions are refused.
- Never publish, never flip visibility. Pushes are private by
  construction; promotion is a human decision on vos.so.
- The shelf is the human's: create folders and file YOUR work; never
  rename, move, delete or reorder what they made.
- Never print a credential, in output, logs or the report.
