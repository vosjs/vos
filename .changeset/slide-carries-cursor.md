---
'@vosjs/studio-core': patch
---

Across a `slide` transition the cursor dot rides the card that holds more of the frame, moved with it, instead of travelling the straight line between the two cards' points, which crossed the bare ground between them. Fade and scale transitions keep the single dot that eases from the outgoing card's point to the incoming's.
