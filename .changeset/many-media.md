---
'@vosjs/studio-core': minor
---

Many media in one take (concat): `doc.media` holds a take's other media (the `source` shape with an `id`), a segment and every source-anchored span (zoom, tilt, speed, freeze, cam move, a rejected proposal) name their media by that id, and an absent `media` is the primary, `doc.source`. The rated list keeps each piece's media (a segment is rated by its own media's speed spans, a freeze lands on the media it names), the span-to-track mappers and the lanes map a span through its media's pieces only, the lanes stamp a new span with the media under the playhead, the lowering hands every media to setup (one element each, decoded like the primary) with its own cursor, space and clicks, and ON_FRAME drives the element under the playhead and rests the others. A document with one media lowers byte-identically.
