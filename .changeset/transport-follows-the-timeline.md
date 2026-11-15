---
'@vosjs/core': patch
---

The player's transport is read off the timeline, so it cannot disagree with the clock. Three things a program was told wrongly are now right:

- **A `LOAD` with `autoplay` plays.** The timeline started and `isPaused` stayed `true`, so every video and sound in the program was stepped frame by frame, paused, for as long as it ran. `vos preview` played a take that way.
- **A warm `LOAD` of a playing timeline is playing.** A program with elements resets `isPaused` on the way in, and nothing put it back.
- **A seek moves the playhead and nothing else.** `SEEK` and `SEEK_TIME` set `isPaused` and left the timeline running, so a seek during playback dropped the program's media into paused stepping while the clock ran on. A playing timeline now plays on from the new moment and a paused one stays paused, as an `HTMLMediaElement` does. A host that wants a still frame sends `PAUSE` first.

A program reads `window.__vos__.transport` (`VosTransport`, exported from `@vosjs/core/runtime`): `playing`, `speed` (what `PLAY_SPEED` set, kept across a warm load) and `epoch`, a counter that ticks when the clock jumps (a seek, a loop's wrap, a load). `isPaused` is its mirror, so a program compiled before this reads the corrected state. A timeline that does not loop and reaches its end reads as stopped. The message set is unchanged and the protocol number stays 11.
