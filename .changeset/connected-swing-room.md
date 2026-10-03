---
'@vosjs/studio-core': patch
---

A connected transition now runs at its full length however short the gap between its two spans. The tilt swing, the zoom pan and the cam morph between connected spans used to be confined to the gap, so two leans 0.1 s apart swung the card 37° in 0.14 s (8° in one frame) whatever their transition speed said. The transition now borrows the time from the outgoing hold (`connectedWindow`), never leaving before the outgoing state has landed and spilling at most halfway into the next span. Spans whose gap already held the transition lower exactly as before, and `instant` cam moves stay a jump cut.

A span already under way when the card's entrance ends now ramps in from that moment at its full ramp (`TrackOptions.notBefore`), instead of losing its ramp to the entrance and creeping in a straight line to the span's end.
