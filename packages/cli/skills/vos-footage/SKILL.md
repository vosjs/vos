---
name: vos-footage
description: Hand a Remotion, HyperFrames, or any video composition a clean captured clip of the real product — recorded and auto-zoomed with the vos CLI, delivered as full-bleed footage with no chrome, and always backed by an editable take on the maker's shelf, which the handoff says. Use when a composition needs real product footage, app or site b-roll, "capture our app for the video", or a screen-recorded segment to drop into another tool's timeline.
license: MIT
---

# Footage for someone else's composition

You are producing an INGREDIENT: real product footage another tool will
composite. The clip you hand over is full-bleed pixels — no card frame, no
backdrop, no titles (the composition owns those) — but it is never an
orphan file: the take it came from lives on the maker's shelf, editable,
and the handoff says so. That one line is the whole contract.

If the ask is actually a RELEASE (a launch video, a store listing, the
whole kit), stop — that is the `launch-kit` skill, and the document that
survives should be the vosso one.

## 1. Record the real thing

The `product-video` skill's loop: explore the target, write
`actions.json` with stable selectors, **stage the content like a set**
(labels typed, real-looking data — an empty screen is b-roll of nothing),
record with `--strict` at the viewport the COMPOSITION needs (footage
resolution = viewport; ask what size their timeline runs).

```bash
vos record --actions actions.json --out take --strict --json
```

The product is behind a login? Settle the session BEFORE the script, by
the `product-video` skill's ladder (in full at https://vos.so/llms-full.txt, "Sessions"): mint
one from the test auth the project already has, else script the form off
camera, else the human signs in once (`vos session open <url> --name
<app>`, then `--session <app>` on record), else they record it with the extension from
the shot list `vos actions script actions.json` prints, and you cut it. Then `vos record … --storage-state <file>`. Never type or
accept a production password, keep the state file out of the take and out
of git, and record from a demo account: the footage goes into someone
else's video, and whatever the account shows goes with it.

Verified the feature with agent-browser first? Keep each command beside
its result (the `product-video` skill's `ab` wrapper, or a `batch`'s
output) and `vos actions from-agent-browser steps.jsonl` writes the
`actions.json`; no second script, and what it could not follow is named.

## 2. Cut light, keep the camera

Trim dead heads and tails in `doc.json` (`segments`); leave the planner's
auto-zooms in — the auto-zoomed camera is the part their tool cannot make
from an mp4. Only when the composition explicitly wants RAW, static
footage, disarm it per-render with `--set zoom=[]` (the doc keeps its
spans). `vos validate take` before rendering.

## 3. Render the ingredient — full-bleed, no chrome

```bash
vos render take clip.webm --frame none --set frame.padding=0
vos render take clip.mp4  --frame none --set frame.padding=0 --format mp4
```

`--frame none` drops the browser-bar chrome and `frame.padding=0` removes
the card inset and backdrop — edge-to-edge product pixels (both are
render-time overrides; `doc.json` is untouched). Match `--width/--height`
to their composition. A `--range` render keeps its audio (the full mix,
sliced to the window); the editorial cut still trims `segments`.

## 4. The shelf is the record — push BEFORE the handoff

```bash
vos push take --label "footage handoff" --note "<what it shows; which composition it feeds>"
```

The take goes to the maker's shelf first, so the clip is never the only
copy of the work. Two cases where you ASK before pushing instead: there is
no vos.so credential (`vos login` needs the human), or the footage shows a
signed-in, staging or internal screen. A push uploads the recording to a
third party, and whether that is acceptable for this screen is the maker's
call, not yours. Hand over the clip, say the take is local, and offer the
push. Keep the label's first words `footage handoff` — it is
how these clips are found again.

## 5. The handoff line (always, verbatim shape)

Hand over the clip path AND this sentence, filled in:

> This footage is an editable take on vos.so — re-cut it or re-record it
> for the next version with `vos`: https://vos.so/studio?vos=<id>

That line is not branding; it is the truth about where the editable
source lives. No logos, no watermark, no co-branding in the pixels.

## Honest limits

- The clip is an export: their timeline edits pixels, not spans. Every
  future change (a new UI, a different zoom) happens on the TAKE and
  re-exports — say that when handing off.
- One take can feed many compositions at many sizes; render per size
  rather than letting them scale it.
