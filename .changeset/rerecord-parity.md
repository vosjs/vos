---
'@vosjs/cli': minor
'@vosjs/studio-core': patch
---

The re-record loop keeps the cut where the page moved. `vos plan --reuse` re-times a manual span against the step it was made on (the gesture whose window held it, or the one just before it), keeping its offset exactly, and only a span between steps goes through the interpolated map; a span whose step is missing or skipped in the new recording is dropped and named with what it framed, never re-timed to a place with nothing under it. A layer pinned to a step or a press follows that step's new output time, so a callout about a press plays when the press plays; an unpinned layer that sat over a step which moved is named with the step's new time, with the pin to write. Rejected proposals are never trimmed against each other. The take's `actions.json` rides the document (`source.script`): `vos push` embeds it and `vos fetch --media` and `vos pull --media` write it back beside the recording, so a take fetched from vos.so can be recorded again.
