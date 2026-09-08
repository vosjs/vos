---
'@vosjs/cli': minor
---

Many media in one take: `doc.json` carries `media[]` (the take's other recordings, each the `source` shape with an `id`) and `media` on a segment and on every source-anchored span; the schema and the lints know them (a span is measured against its own media's length, an unknown id is a problem), `vos plan` proposes zoom and speed spans on every media from its own cursor track, and `vos push` and `vos pull --media` carry every media's recording and sidecars through the recording door.
