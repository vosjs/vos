---
'@vosjs/studio-core': minor
'@vosjs/cli': minor
---

Transitions at a boundary. A footage clip's `anim` says how it meets the clip beside it (`exit` at the boundary after it, `enter` at the one before: `slide`, `fade`, `scale` or `none`; a slide names its `side`, a step its `seconds`), and the card's own enter gains `slide`. The lowering turns every boundary that moves into a record in output seconds; the incoming clip plays live while the outgoing card, frozen on its last frame, moves away on a second plane fed by a ghost element (so a cold seek in an export chunk decodes it like any frame, and one recording can be both cards at a page change); the camera rests through the window; one cursor dot crosses in frame space. The recorder marks steps that changed the page's URL, `vos plan` proposes a transition at each (`transitions:` in LAUNCH.md or `--transitions`), and `vos validate` lints the kinds and refuses a transition longer than half the shorter clip.
