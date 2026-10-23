---
'@vosjs/studio-core': patch
---

A text layer's box arrives with its words: under a per-unit entrance (`unit: 'word'`, `'line'` or `'char'`) the box follows the earliest unit's delay, seconds and ease instead of standing empty at full strength until the first word shows. A typewriter's box is still there from its first frame, and a block entrance fades the box with the block as before.
