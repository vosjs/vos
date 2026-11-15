---
'@vosjs/elements': patch
---

A playing `video` or `audio` element is kept on the clock by the player document's follower (`window.__vos__.media`, `@vosjs/core`), when the document has one. Before this a playing element ran free: it was placed once when it started and never again.

Where it should be is what the program last said, carried forward on the player's clock (`transport.time`): one output second per second for an element left to run, or the rate the program animates `currentTime` at, measured from its writes. So an element now:

- **comes back from a stall**, where it stayed as far behind as it fell;
- **goes with a seek of the player and with the program's loop**, where it played on from wherever it was;
- **resumes where it paused**, where an element left to run started over;
- **runs at the player's speed**, where it stayed at 1×.

A time the program holds still or moves backward is not followed, an element past its own end is left alone, and with no follower in the document (an older player, a page of your own) everything is as it was. The paused frame is unchanged: a capture steps an element exactly and takes nothing from this. A browser that refuses an unmuted `play()` with no gesture now gets muted playback until the viewer has acted, where the element stayed paused.

Because the player supplies the element code, a stored program gets this without being saved again.
