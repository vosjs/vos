---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

A segment may keep the camera at rest through its pass: `segments[].camera: 'rest'`. There no zoom, tilt, cam move or follow recenter applies, even over seconds another pass zooms on, so a cold open shows the settled whole while the main play zooms; the cursor, the click effects, the speed spans and the freezes still play. A span running into or out of the clip ramps at its edge, and no connected move pans across it. `cameraSpanExtents` and `cameraRestWindows` say where the camera plays and rests; the lanes and `vos frames --at-zooms` read the camera's passes, and `vos validate` warns of a camera span that plays only in resting clips. A step anchor now resolves to the pass where its step plays the LONGEST (the first on a tie), not the first: a caption about a step lands in the main play rather than a short cold open, and so do the still, digest steps and moments, callout windows and a step's settled frame (`stepMomentToOutput`, `longestOutputExtent`). A cut with no resting clip, and one that plays each media's seconds in order, lowers byte for byte as before.
