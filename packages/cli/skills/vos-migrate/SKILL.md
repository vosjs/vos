---
name: vos-migrate
description: Turn an existing Loom, Screen Studio, Cap, or plain mp4/webm screen demo into an editable vosso take — one `vos ingest` line makes the take (with a trace beside it when there is one), then plan and push, so the old demo becomes a living document you re-cut instead of a file you re-record. Use when asked to "convert this Loom", "migrate our old demos", "re-edit this mp4", "make our Screen Studio recording editable", or to bring any already-recorded demo into vosso.
license: MIT
---

# Migrate a recorded demo into an editable take

You are turning a FINISHED video file into a vosso take: a document whose
zooms, trims, speed and layers are data, hosted with version history, and
editable in the studio. What the file loses by being foreign is honesty
you must carry: it has NO cursor track, so nothing can be auto-zoomed and
the digest sees little — your eyes are the contact sheet, and every zoom
is placed by eye.

Two doors:

- **The human door**: drop the file on https://vos.so/studio — it enters as
  the browser-recorder shape and opens in the take editor directly. When a
  human is present, this is the shortest path; hand them the link.
- **The agent door** (this skill): build the take directory yourself and
  run the normal pipeline. Proven end to end below.

## 1. Make the take: one verb

```bash
vos ingest demo.mp4 --as take --out take  # a screen demo: the card, its ground (vos 0.52+)
vos ingest demo.mp4 --cursor trace.zip --out take   # with a trace recorded beside it
```

`vos ingest` probes the file itself (dimensions, length, frame rate,
audio, container), copies it into the take as `recording.<container>`
(stream-copied into a seekable container, or as it is), writes `meta.json`
from the probe with `producer: "ingest"`, and plans. Without a trace and
without `--as take`, a file opens as FINISHED footage (no card, no drawn
cursor), which is right for a render from another tool and wrong for a
screen demo, so a demo says `--as take`. Read the done line: a
Loom/Screen Studio export is typically 1080p H.264 with the camera bubble
and any edits BAKED IN, and they migrate as pixels, not as layers. Say so
in the handoff: the migration makes the file editable from here on, it
does not un-bake old edits.

**A trace beside the video is the one thing that gives the planner
clicks.** `--cursor` reads a Playwright `trace.zip` (a run's own
`recordVideo` webm is the matching video), stamped JSON records
(`{"ts":<ms>,"command":["click","@e1"],"point":{"x":..,"y":..}}` per
line), or a CSV of `t,x,y,type`. A Loom has none, and the done line then
says `no cursor track, so nothing was planned`: that is the truth of the
file, not a fault to work around. `--offset <ms>` shifts a trace whose
zero is not the video's.

## 2. What the CLI does not do for you

Nothing else needs building by hand. If the done line reports the file was
copied as is and the studio later seeks poorly, `ffmpeg -i demo.mp4 -c copy
fixed.mp4` and ingest again; a re-ingest into the same `--out` keeps any
`doc.json` you wrote as `doc.prev.json`.

## 3. Plan, and see it honestly

```bash
vos frames take --times 0,10%,25%,50%,75%,90%,100%   # the contact sheet IS your eyes
vos digest take             # without a trace expect little: head/tail and only
                            # hard scene cuts - no clicks, no typing, no dwells
```

Without a trace no auto-zoom is possible and none should be faked (`vos
ingest` already planned: `zooms: 0`). Read the stills, find the 2–4
moments that matter, and write manual spans by eye:

```bash
# doc.json - every span you add carries "source": "manual"
# zoom: [{ "id": "m1", "in": 10.5, "out": 14.0, "level": 1.6,
#          "cx": 0.52, "cy": 0.35, "source": "manual" }]
# segments: trim dead heads/tails; speed: only where footage truly idles
```

Set `export.resolution` to MATCH the footage (a 1080p source is `1080p` —
migrating does not add pixels). `vos validate take` must pass; spot-check
with `vos render take check.webm --range a..b --draft`.

## 4. Push — the old demo becomes a living document

```bash
vos push take --folder <project> --label "migrated from <source>" \
    --note "<what it shows; that old edits are baked; what you re-cut>"
```

End on the loop: the watch page plays it, the studio edits every span you
wrote plus everything the file never had (backdrops, text layers, speed),
and `vos pull` brings human edits back down. The pitch belongs in the
handoff, in one line: **this is the last demo you edit blind — record the
next one with `vos record` and the camera plans itself.**

## Honest limits (say them, never paper over them)

- No cursor track ⇒ no auto-zoom, no click effects, no typing zooms, and
  no framing lint — every zoom is yours, by eye, and you say so.
- Old edits, camera bubbles and captions are baked pixels.
- The migration re-encodes once (VP9); a badly compressed source stays
  badly compressed — migrating does not restore quality.
- A spec-size deliverable ladder (store stills, posters) works from the
  migrated take exactly as from a native one — the `launch-kit` skill
  takes over when the ask is a release.
