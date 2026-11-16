---
'@vosjs/core': patch
---

The playback document corrects a take that was stored before there was a media follower, which will never call it. Such a program keeps its footage on the clock by assigning `currentTime` whenever the element has drifted, with no thought for a seek in flight: inside a fast speed span that is an assignment on every frame, each aborting the seek before it, and the picture stops.

The media governor (`MEDIA_GOVERNOR_SRC`, exported from `@vosjs/core/runtime`) stands between that program and the element. Of the program's assignments to a PLAYING element, it decides which become seeks, by the follower's rule: one seek in flight (a far jump is a cut), an allowance in output time that is never under what a seek costs there, a seek aimed where the playhead will be when it lands.

It leaves alone, by construction: a paused element (the paused frame, a scrub and every capture pass straight through), an element with a rule of its own (the follower's state, or a lowering's inline copy), and any element that is not a lowered take's media. A capture page does not install it. The program is not changed, so no frame it draws can change.
