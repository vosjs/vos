---
'@vosjs/cli': minor
---

A take's media is named and declared by its bytes, never by its name

`vos fetch --media` wrote every recording to `recording.webm`, and `vos push`
then declared that file `video/webm` whatever it held. A hosted take whose
footage is mp4 under a `.webm` name (the in-page recorder remuxes to mp4 and
keeps the name) therefore round-tripped into an asset typed webm holding mp4
bytes, and every render of the new version died in the video element with a
format error.

The bytes now decide, at each place a claim used to be believed:

- A pull sniffs the container it downloaded and names the file for it
  (`recording.mp4`, `mic.m4a`, `media/<id>.png`), so the take directory never
  holds a file whose extension lies. Files are streamed to a `.part` sibling
  and renamed, so a failed transfer leaves nothing behind.
- A take directory tolerates any container: `takePaths().recording` resolves
  what is on disk, and render, frames, digest, plan, open and push all read the
  resolved name. `record` still writes WebM.
- A push declares the type it finds in the bytes and corrects the uploaded
  filename to match, saying so.
- The local take server serves by signature, so a page can decode a take
  whatever it is called.
- `vos validate <take>` warns when a take's footage and its name disagree, and
  names the rename that fixes it.

A name or a Content-Type is only ever the fallback for bytes that say nothing
(an SVG, a recipe), so a name is corrected only on positive evidence.
