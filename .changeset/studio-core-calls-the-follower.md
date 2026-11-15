---
'@vosjs/studio-core': patch
---

A take's footage, its backdrop loop and its video layers are kept on the clock by the player document's follower (`window.__vos__.media`, `@vosjs/core`) when the document has one. Each keeps the rule it had as its own copy, which plays the take right in a player with none (an older CLI, a standalone page) and never changes after a save.

What a take gains from the follower:

- **The player's speed.** At speed 2 inside a 3.2× piece the footage ran at 3.2× under a clock running 6.4 and was stepped again and again; it now runs at 6.4× and is not stepped.
- **The backdrop and video layers get the footage's rule.** They had a fixed 0.3 s allowance whatever a seek cost on that element.
- **A fix to the rule reaches the take without a re-save.**

A layer that shows the take's own footage shares one element with the card: the card leads and the layer stands back. A backdrop whose length is not known yet is left to play, and a layer past its own end is held paused, as before. The paused frame, which an export steps to, is unchanged.
