---
'@vosjs/cli': minor
'@vosjs/studio-core': minor
---

The recorder looks at what a signed-in take shows. After the page opens and after every step it reads the text visible in the viewport and reports the KIND of sensitive-looking thing it saw and where, never the string: an email address (demo domains excepted), something shaped like an API key or a JWT, a card number that passes the Luhn check, a masked card's tail. They land in `meta.exposures[]`, the `record` and `create` done events, the end of a rehearsal, `vos validate <take>` and the digest's `take.exposures`, as warnings.

`actions.json` gains `mask: [{ selector, as?: "blur" | "text", text? }]`: hidden before the first frame is captured and kept hidden across navigations and re-renders, so the real value is never in a frame, never in the recording, never pushed. A mask whose selector reached nothing fails `--strict` and a rehearsal. `meta.masks[]` records each mask's hits.
