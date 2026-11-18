---
'@vosjs/studio-core': patch
---

A media whose file cannot be read never borrows another clip's picture. A take's lowered setup used to warn and leave that media without an element, and the frame code then drew the PRIMARY footage through the media's whole stretch, driven by the media's own times, zooms, captions and click marks: a film that looked edited wrong, with no word that a file was missing.

The media's own card now stands in, empty, with one line on it ("This clip's footage did not load"), the way an editor shows offline media. It is a still the compositor draws like any shot, sized as the footage was recorded, so the crop, the zooms, the card and the film's timing are unchanged and the gap is plain to see, live and in a render. No pointer and no click marks are drawn over it.

The reason is kept for a host at `window.__vos__.mediaErrors[id]` (the media's id, the error in words), beside `htmlErrors`, and is cleared on the next load once the file reads. A take whose media all load is drawn exactly as before.
