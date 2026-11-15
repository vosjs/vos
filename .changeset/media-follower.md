---
'@vosjs/core': patch
---

The playback document installs a media follower at `window.__vos__.media`: the one rule for keeping a playing `<video>` or `<audio>` on the clock, where a program used to carry its own. `media.follow(el, { at, rate, piece, end, loop, unlocked, lead })`, called once a frame while playing, is then the only thing that seeks the element, sets its rate or plays it.

- One seek in flight. Only a cut re-aims it: another piece under the playhead, or the clock itself jumped (`transport.epoch`).
- The allowance is output time (0.3 output seconds for a sped-up piece, 0.12 source seconds in slow motion, 0.3 at 1×) and never under what one seek measurably costs on that element.
- A step is aimed where the playhead will be when it lands, by the element's own measured seek time, and never onto a piece's last frames.
- A landing is checked once, and re-aimed once when it missed by more than half the allowance.

It carries the player's speed (`transport.speed`), measures a loop around its wrap, lets one caller lead when two drive one element, and owns the muted-autoplay fallback. The paused frame stays the caller's, so a capture takes nothing from it, and a capture page does not install it.

Exported from `@vosjs/core/runtime`: `MEDIA_FOLLOWER_SRC` (the script, for a page of your own) and the `VosMedia` and `MediaFollowTarget` types. Because it lives in the document, a fix to it reaches every program that calls it the day the player ships.
