---
name: vos-migrate
description: Turn an existing Loom, Screen Studio, Cap, or plain mp4/webm screen demo into an editable vosso take — re-encode the file, synthesize the take's metadata, plan, and push, so the old demo becomes a living document you re-cut instead of a file you re-record. Use when asked to "convert this Loom", "migrate our old demos", "re-edit this mp4", "make our Screen Studio recording editable", or to bring any already-recorded demo into vosso.
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

## 1. Probe the source

```bash
ffprobe -v quiet -print_format json -show_streams -show_format demo.mp4
```

Keep: width, height, duration, fps, whether an audio stream exists. A
Loom/Screen Studio export is typically 1080p H.264 with the camera bubble
and any edits BAKED IN — they migrate as pixels, not as layers. Say so in
the handoff: the migration makes the file editable from here on, it does
not un-bake old edits.

## 2. Build the take directory

```bash
mkdir take
ffmpeg -i demo.mp4 -c:v libvpx-vp9 -crf 34 -b:v 0 -row-mt 1 \
       -c:a libopus take/recording.webm     # drop -c:a if no audio stream
```

Then write `take/meta.json` from the probe (every field required; times in
ms; `producer: "migrated"` marks provenance):

```json
{
  "producer": "migrated",
  "dpr": 1, "zoom": 1,
  "t0": 0,
  "durationMs": 36766,
  "width": 1920, "height": 1080,
  "fps": 30,
  "hasAudio": false
}
```

`t0` may be any epoch ms; `width`/`height` are the video pixels (there was
no browser viewport). Set `hasAudio` true only when the webm actually
carries the track.

## 3. Plan, and see it honestly

```bash
vos plan take --fresh       # builds doc.json; cursorKept false, zoomAuto 0
vos frames take --times 0,10%,25%,50%,75%,90%,100%   # the contact sheet IS your eyes
vos digest take             # runs, but expect little: head/tail and only
                            # hard scene cuts - no clicks, no typing, no dwells
```

No auto-zoom is possible and none should be faked. Read the stills, find
the 2–4 moments that matter, and write manual spans by eye:

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
