---
'@vosjs/studio-core': patch
---

A take that names one file as two media (the same shot as a teaser and in full), or as a media and the footage, now plays it smoothly. SETUP's by-src element cache handed both names ONE `<video>`, and ON_FRAME's concat rule (pause every media not under the playhead) paused the playing clip every frame under its other name: play/pause churn, the element falling behind the clock, and a drift-guard seek about three times a second that read as a picture holding and then jumping. Every claim on the same bytes now gets its own element, kept in the cache under its own slot so a warm LOAD still reuses it, and the loop never pauses the element under the playhead.
